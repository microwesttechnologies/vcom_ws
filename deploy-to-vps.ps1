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
    "firebase-service-account.json"
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
    Invoke-ExternalChecked -FilePath "tar" -Arguments (@("-czf", $archivePath) + $includePaths)
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
docker compose -f compose.vps.yml up -d --build --force-recreate api-vcom-chat
'@
    $remoteScript = $remoteScript.Replace("__REMOTE_DIR__", $RemoteDir)
}

Write-Host "Extrayendo archivos en la VPS"
Invoke-ExternalChecked -FilePath "ssh" -Arguments ($sshArgs + @("${UserName}@${HostName}", $remoteScript))

Write-Host "Proceso completado."
if ($RestartCompose) {
    Write-Host "La aplicacion se reconstruyo y reinicio (api-vcom-chat) con docker compose."
} else {
    Write-Host "Si quieres reconstruir y levantar la API, ejecuta en la VPS:"
    Write-Host "  cd $RemoteDir && docker compose -f compose.vps.yml up -d --build --force-recreate api-vcom-chat"
}
