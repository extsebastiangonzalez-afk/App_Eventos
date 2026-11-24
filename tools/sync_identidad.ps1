# Trae la identidad visual ISDIN del repositorio del manual y la copia al proyecto.
#   Repositorio: https://github.com/williamcorrea-hash/manual-identidad-visual-ISDIN
#   Copia:  apps-script/identidad.html -> apps-script/Identidad.html   (colores, tipografía, componentes)
#           apps-script/logo.html      -> apps-script/Logo.html        (logotipo SVG en línea)
# Uso (desde la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File tools\sync_identidad.ps1
#   clasp push --force   y luego actualizar la implementación (ver README).
# Solo copia esos dos archivos; no ejecuta nada del repositorio.

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/williamcorrea-hash/manual-identidad-visual-ISDIN.git'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'apps-script'
$tmp  = Join-Path ([IO.Path]::GetTempPath()) ('identidad-isdin-' + [Guid]::NewGuid().ToString('N'))

git clone --quiet --depth 1 $repo $tmp
if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar el repositorio del manual.' }
try {
  $commit = (git -C $tmp rev-parse --short HEAD).Trim()
  $hoy = Get-Date -Format 'yyyy-MM-dd'
  $pares = @(@('apps-script/identidad.html', 'Identidad.html'), @('apps-script/logo.html', 'Logo.html'))
  foreach ($p in $pares) {
    $src = Join-Path $tmp $p[0]
    $txt = [IO.File]::ReadAllText($src, [Text.Encoding]::UTF8)
    # Seguridad: estos archivos deben ser solo CSS / SVG. HtmlService además interpreta "<?" como código.
    if ($txt -match '<script|<\?|\son[a-z]+\s*=|javascript:') { throw "$($p[0]) trae código ejecutable; no se copia. Revísalo a mano." }
    $cab = "<!-- Copiado de $repo ($($p[0]), commit $commit, $hoy) con tools/sync_identidad.ps1. No editar aqui: cambiar en el repositorio del manual. -->`n"
    [IO.File]::WriteAllText((Join-Path $dest $p[1]), $cab + $txt, (New-Object Text.UTF8Encoding($false)))
    Write-Host "OK  $($p[1])  <-  $($p[0]) @ $commit"
  }
} finally {
  Remove-Item -Recurse -Force $tmp
}
