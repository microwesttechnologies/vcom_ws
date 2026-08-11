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

$isWindows = $true
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

# Normalizar scripts bash a LF antes de empaquetar
foreach ($bashFile in @("remote-deploy.sh", "fix-traefik-wschat.sh")) {
    $full = Join-Path $projectRoot $bashFile
    if (Test-Path $full) {
        $text = [System.IO.File]::ReadAllText($full) -replace "`r`n", "`n" -replace "`r", "`n"
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($full, $text, $utf8NoBom)
    }
}

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
    "fix-traefik-wschat.sh",
    "remote-deploy.sh"
) | Where-Object { Test-Path (Join-Path $projectRoot $_) }

if ($includePaths.Count -eq 0) {
    throw "No se encontraron archivos para empaquetar."
}

Write-Host "Incluyendo:"
$includePaths | ForEach-Object { Write-Host " - $_" }

Push-Location $projectRoot
try {
    $swaggerLocal = Join-Path $projectRoot "src\docs\swagger.js"
    if (-not (Test-Path $swaggerLocal)) {
        throw "Falta archivo local: src/docs/swagger.js"
    }
    Invoke-ExternalChecked -FilePath "tar" -Arguments (@("-czf", $archivePath) + $includePaths)
    $tarList = & tar -tzf $archivePath
    if ($LASTEXITCODE -ne 0) { throw "No se pudo listar el tar" }
    $hasSwagger = $tarList | Where-Object { $_ -match 'src/docs/swagger\.js$' }
    $hasApp = $tarList | Where-Object { $_ -match 'src/app\.js$' }
    if (-not $hasSwagger) { throw "El tar no contiene src/docs/swagger.js" }
    if (-not $hasApp) { throw "El tar no contiene src/app.js" }
    Write-Host "Tar OK: $($tarList.Count) entradas"
}
finally {
    Pop-Location
}

Write-Host ("Subiendo paquete a {0}@{1}:{2}" -f $UserName, $HostName, $RemoteArchive)
Invoke-ExternalChecked -FilePath "scp" -Arguments ($scpArgs + @($archivePath, "${UserName}@${HostName}:$RemoteArchive"))

$extractScript = @"
set -e
mkdir -p '$RemoteDir'
tar -xzf '$RemoteArchive' -C '$RemoteDir'
rm -f '$RemoteArchive'
ls -la '$RemoteDir'
"@
$extractScript = $extractScript -replace "`r`n", "`n" -replace "`r", "`n"

Write-Host "Extrayendo archivos en la VPS"
Invoke-ExternalChecked -FilePath "ssh" -Arguments ($sshArgs + @("${UserName}@${HostName}", $extractScript))

if ($RestartCompose) {
    Write-Host "Ejecutando remote-deploy.sh en la VPS"
    $runScript = "set -e; cd '$RemoteDir'; sed -i 's/\r$//' remote-deploy.sh fix-traefik-wschat.sh; chmod +x remote-deploy.sh fix-traefik-wschat.sh; bash remote-deploy.sh '$RemoteDir'"
    $runScript = $runScript -replace "`r`n", "`n" -replace "`r", "`n"
    Invoke-ExternalChecked -FilePath "ssh" -Arguments ($sshArgs + @("${UserName}@${HostName}", $runScript))
    Write-Host "Proceso completado."
    Write-Host "Swagger: https://wschat.vcommunity.cloud/docs/"
    Write-Host "Health debe incluir buildId: https://wschat.vcommunity.cloud/health"
} else {
    Write-Host "Proceso completado (sin rebuild)."
}
