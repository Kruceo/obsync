#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$VaultPath
)

$ErrorActionPreference = "Stop"

$Repo     = "Kruceo/obsidian-s3-sync"
$PluginId = "obsidian-s3-sync"
$ApiUrl   = "https://api.github.com/repos/$Repo/releases/latest"

function Write-Info  { Write-Host "» $args" -ForegroundColor Blue }
function Write-Ok    { Write-Host "✓ $args" -ForegroundColor Green }
function Write-Fail  { Write-Host "✗ $args" -ForegroundColor Red; exit 1 }

# --- valida vault ---
if (-not (Test-Path "$VaultPath\.obsidian")) {
    Write-Fail "'$VaultPath' não parece ser um vault do Obsidian (.obsidian não encontrado)."
}

# --- busca última release ---
Write-Info "Buscando última release em github.com/$Repo..."
try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "obsidian-s3-sync-installer" }
} catch {
    Write-Fail "Falha ao acessar a API do GitHub: $_"
}

$Version = $Release.tag_name
$BaseUrl = "https://github.com/$Repo/releases/download/$Version"

Write-Info "Versão encontrada: $Version"

# --- cria pasta do plugin ---
$PluginDir = "$VaultPath\.obsidian\plugins\$PluginId"
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null

# --- baixa arquivos ---
Write-Info "Baixando arquivos para $PluginDir..."
foreach ($file in @("main.js", "manifest.json", "styles.css")) {
    $url  = "$BaseUrl/$file"
    $dest = "$PluginDir\$file"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Write-Host "  ✓ $file"
    } catch {
        Write-Fail "Falha ao baixar $file`: $_"
    }
}

# --- habilita em community-plugins.json ---
$CommunityFile = "$VaultPath\.obsidian\community-plugins.json"
if (Test-Path $CommunityFile) {
    $plugins = Get-Content $CommunityFile -Raw | ConvertFrom-Json
    if ($plugins -notcontains $PluginId) {
        $plugins += $PluginId
        $plugins | ConvertTo-Json | Set-Content $CommunityFile -Encoding UTF8
        Write-Info "Plugin habilitado em community-plugins.json"
    }
} else {
    ConvertTo-Json @($PluginId) | Set-Content $CommunityFile -Encoding UTF8
    Write-Info "community-plugins.json criado e plugin habilitado"
}

Write-Host ""
Write-Ok "Instalação concluída! Versão $Version instalada em:"
Write-Ok "  $PluginDir"
Write-Host ""
Write-Host "Reinicie o Obsidian e configure o plugin em Configurações → S3 Sync + Plugins."
