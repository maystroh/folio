[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    $target = $PSScriptRoot
    $running = Get-Process -Name 'FolioApp','Folio' -ErrorAction SilentlyContinue
    if ($running -and -not $Force) {
        throw 'Close Folio before uninstalling it.'
    }

    foreach ($shortcutPath in @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio.lnk'),
        (Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio') 'Folio.lnk'),
        (Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio') 'Uninstall Folio.lnk')
    )) {
        try { if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force } } catch { }
    }
    $programFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio'
    try { if (Test-Path -LiteralPath $programFolder) { Remove-Item -LiteralPath $programFolder -Recurse -Force } } catch { }

    $current = 'HKCU:\Software\Classes'
    foreach ($path in @(
        'Folio.pdf',
        'Folio.folio',
        'Applications\Folio.exe'
    )) {
        try { Remove-Item -LiteralPath (Join-Path $current $path) -Recurse -Force } catch { }
    }
    try { Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Folio.exe' -Recurse -Force } catch { }
    try { Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Folio' -Recurse -Force } catch { }

    foreach ($entry in @(
        @{ Extension = '.pdf'; ProgId = 'Folio.pdf' },
        @{ Extension = '.folio'; ProgId = 'Folio.folio' }
    )) {
        try {
            $openWith = Join-Path $current ($entry.Extension + '\OpenWithProgids')
            Remove-ItemProperty -LiteralPath $openWith -Name $entry.ProgId -Force -ErrorAction SilentlyContinue
        } catch { }
    }

    $cmd = $env:ComSpec
    $arguments = '/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q "' + $target + '"'
    Start-Process -FilePath $cmd -ArgumentList $arguments -WorkingDirectory $env:TEMP -WindowStyle Hidden
    exit 0
} catch {
    exit 1
}
