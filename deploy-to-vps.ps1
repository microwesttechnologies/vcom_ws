param(
    [string]$HostName = "srv1526706.hstgr.cloud",
    [string]$UserName = "root",
    [int]$Port = 22,
    [string]$RemoteDir = "/opt/api-vcom-chat",
    [string]$RemoteArchive = "/opt/api-vcom-chat.tar.gz",
    [bool]$RestartCompose = $true,
    [switch]$SkipHostKeyCheck = $true
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "No se encontro el comando requerido: $Name"
    }
}

Require-Command scp
Require-Command ssh
Require-Command tar

function Invoke-ExternalChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        $joinedArgs = if ($Arguments.Count -gt 0) { $Arguments -join " " } else { "" }
        throw "Command failed ($LASTEXITCODE): $FilePath $joinedArgs"
    }
}

$isWindows = $false
try {
    $isWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Windows
    )
} catch {
    $isWindows = $true
}

$nullKnownHostsPath = if ($isWindows) { "NUL" } else { "/dev/null" }
$sshArgs = @("-p", "$Port")
$scpArgs = @("-P", "$Port")
if ($SkipHostKeyCheck) {
    $sshArgs += @("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=$nullKnownHostsPath")
    $scpArgs += @("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=$nullKnownHostsPath")
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectName = Split-Path -Leaf $projectRoot
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("{0}-deploy" -f $projectName)
$archivePath = Join-Path $tempRoot ("{0}.tar.gz" -f $projectName)

Write-Host "Preparando paquete desde: $projectRoot"

if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $tempRoot | Out-Null

$includePaths = @(
    "src",
    "db",
    "package.json",
    "package-lock.json",
    "Dockerfile",
    ".dockerignore",
    ".env.example",
    "README.md",
    "compose.vps.yml",
    "firebase-service-account.json",
    "fix-nginx-wschat.sh"
) | Where-Object {
    Test-Path (Join-Path $projectRoot $_)
}

if ($includePaths.Count -eq 0) {
    throw "No se encontraron archivos para empaquetar."
}

Write-Host "Incluyendo:"
$includePaths | ForEach-Object { Write-Host " - $_" }

Push-Location $projectRoot
try {
    # Asegurar que src local tiene swagger antes de empaquetar
    $swaggerLocal = Join-Path $projectRoot "src\docs\swagger.js"
    if (-not (Test-Path $swaggerLocal)) {
        throw "Falta archivo local: src/docs/swagger.js"
    }
    Invoke-ExternalChecked -FilePath "tar" -Arguments (@("-czf", $archivePath) + $includePaths)
    # Verificar contenido del tar
    $tarList = & tar -tzf $archivePath
    if ($LASTEXITCODE -ne 0) { throw "No se pudo listar el tar" }
    $hasSwagger = $tarList | Where-Object { $_ -match 'src/docs/swagger\.js$|src\\docs\\swagger\.js$' }
    $hasApp = $tarList | Where-Object { $_ -match 'src/app\.js$|src\\app\.js$' }
    if (-not $hasSwagger) { throw "El tar no contiene src/docs/swagger.js. Contenido parcial:`n$($tarList | Select-Object -First 40 | Out-String)" }
    if (-not $hasApp) { throw "El tar no contiene src/app.js" }
    Write-Host "Tar OK: incluye src/app.js y src/docs/swagger.js ($($tarList.Count) entradas)"
}
finally {
    Pop-Location
}

Write-Host ("Subiendo paquete a {0}@{1}:{2}" -f $UserName, $HostName, $RemoteArchive)
Invoke-ExternalChecked -FilePath "scp" -Arguments ($scpArgs + @($archivePath, "${UserName}@${HostName}:$RemoteArchive"))

$remoteScript = @'
set -e
mkdir -p '__REMOTE_DIR__'
tar -xzf '__REMOTE_ARCHIVE__' -C '__REMOTE_DIR__'
rm -f '__REMOTE_ARCHIVE__'
ls -la '__REMOTE_DIR__'
'@

$remoteScript = $remoteScript.Replace("__REMOTE_DIR__", $RemoteDir)
$remoteScript = $remoteScript.Replace("__REMOTE_ARCHIVE__", $RemoteArchive)

if ($RestartCompose) {
    $remoteScript = $remoteScript.TrimEnd() + "`n"
    $remoteScript += @'
cd '__REMOTE_DIR__'
echo "=== contenido desplegado ==="
ls -la
rm -f compose.override.yml
echo "=== src ==="
du -sh src
find src -type f | wc -l
test -f src/docs/swagger.js || { echo "ERROR: falta src/docs/swagger.js"; find src -maxdepth 2 -type d; exit 1; }
grep -q mountSwagger src/app.js || { echo "ERROR: src/app.js sin mountSwagger"; exit 1; }
grep -q buildId src/app.js || { echo "ERROR: src/app.js sin buildId"; exit 1; }
docker compose -f compose.vps.yml build --no-cache api-vcom-chat
docker compose -f compose.vps.yml up -d --force-recreate api-vcom-chat
sleep 3
echo "=== dentro del contenedor /app ==="
docker exec api-vcom-chat ls -la /app
echo "=== health INSIDE container (8081) ==="
docker exec api-vcom-chat node -e "require('http').get('http://127.0.0.1:8081/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))}).on('error',e=>{console.error(e);process.exit(1)})"
echo "=== health HOST localhost:8081 ==="
curl -sS http://127.0.0.1:8081/health || true
echo
echo "=== docs HOST localhost:8081 ==="
curl -sS -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1:8081/docs || true
echo "=== puertos en escucha ==="
ss -lntp | grep -E '8081|80|443|3000|4000|5000|8080' || netstat -lntp | grep -E '8081|80|443|3000|4000|5000|8080' || true
echo "=== nginx wschat ==="
grep -RIn "wschat\|8081\|proxy_pass" /etc/nginx 2>/dev/null | head -n 80 || true
echo "=== INTENTANDO FIX NGINX ==="
chmod +x fix-nginx-wschat.sh 2>/dev/null || true
bash fix-nginx-wschat.sh || echo "fix-nginx termino con codigo $?"
echo "=== health PUBLICO tras fix (Host header) ==="
curl -sS -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/health || true
echo
curl -sS -o /dev/null -w "docs via nginx HTTP:%{http_code}\n" -H "Host: wschat.vcommunity.cloud" http://127.0.0.1/docs || true
'@
    $remoteScript = $remoteScript.Replace("__REMOTE_DIR__", $RemoteDir)
}

# Bash rechaza CRLF: 'set -e\r' se interpreta como opcion invalida.
$remoteScript = $remoteScript -replace "`r`n", "`n" -replace "`r", "`n"

Write-Host "Extrayendo archivos en la VPS"
Invoke-ExternalChecked -FilePath "ssh" -Arguments ($sshArgs + @("${UserName}@${HostName}", $remoteScript))

Write-Host "Proceso completado."
if ($RestartCompose) {
    Write-Host "La aplicacion se reconstruyo y reinicio (api-vcom-chat) con docker compose."
} else {
    Write-Host "Si quieres reconstruir y levantar la API, ejecuta en la VPS:"
    Write-Host "  cd $RemoteDir && docker compose -f compose.vps.yml up -d --build --force-recreate api-vcom-chat"
}
