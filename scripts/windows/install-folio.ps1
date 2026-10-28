[CmdletBinding()]
param(
    [switch]$NoLaunch,
    [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$message) {
    Write-Host "  $message"
}

try {
    $root = $PSScriptRoot
    $source = Join-Path $root 'app'
    $target = Join-Path $env:LOCALAPPDATA 'Programs\Folio'
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $launcher = Join-Path $target 'Folio.vbs'
    $uninstaller = Join-Path $target 'Uninstall Folio.vbs'
    $icon = Join-Path $target 'Folio.ico'

    if (-not (Test-Path -LiteralPath (Join-Path $source 'FolioApp.exe'))) {
        throw 'The application payload was not found next to this installer. Extract the whole ZIP before installing.'
    }

    $running = @(Get-Process -Name 'FolioApp','Folio' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        $visible = @($running | Where-Object { $_.MainWindowHandle -ne 0 })
        if ($visible.Count -eq 0) {
            Write-Step "Closing $($running.Count) background Folio process(es)..."
        } else {
            $shell = New-Object -ComObject WScript.Shell
            $answer = $shell.Popup(
                'Folio is currently running. Close it and continue? Unsaved changes may be lost.',
                0,
                'Folio Setup',
                4 + 48)
            if ($answer -ne 6) {
                throw 'Close Folio and run the installer again.'
            }
            Write-Step 'Closing Folio...'
        }
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 900
        $stillRunning = @(Get-Process -Name 'FolioApp','Folio' -ErrorAction SilentlyContinue)
        if ($stillRunning.Count -gt 0) {
            $ids = ($stillRunning | ForEach-Object { $_.Id }) -join ', '
            throw "Folio is still running (PID $ids). Close it and run the installer again."
        }
    }

    Write-Host ''
    Write-Host '  Folio 1.0.0' -ForegroundColor DarkYellow
    Write-Host '  A calm PDF reader and annotation app for Windows.' -ForegroundColor DarkGray
    Write-Host ''

    if (Test-Path -LiteralPath $target) {
        Write-Step 'Removing the previous Folio installation...'
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $target | Out-Null

    Write-Step 'Copying application files...'
    & robocopy $source $target /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    $copyCode = $LASTEXITCODE
    if ($copyCode -ge 8) {
        throw "Copying the application failed (robocopy exit code $copyCode)."
    }

    if (-not (Test-Path -LiteralPath (Join-Path $target 'FolioApp.exe'))) {
        throw 'The application files could not be copied correctly.'
    }

    if (-not $NoShortcuts) {
        Write-Step 'Creating shortcuts...'
        $shell = New-Object -ComObject WScript.Shell
        $desktop = [Environment]::GetFolderPath('Desktop')
        $programs = [Environment]::GetFolderPath('Programs')
        $programFolder = Join-Path $programs 'Folio'
        New-Item -ItemType Directory -Force -Path $programFolder | Out-Null

        $shortcut = $shell.CreateShortcut((Join-Path $desktop 'Folio.lnk'))
        $shortcut.TargetPath = $wscript
        $shortcut.Arguments = '"' + $launcher + '"'
        $shortcut.WorkingDirectory = $target
        $shortcut.IconLocation = $icon + ',0'
        $shortcut.Description = 'Folio PDF reader'
        $shortcut.Save()

        $shortcut = $shell.CreateShortcut((Join-Path $programFolder 'Folio.lnk'))
        $shortcut.TargetPath = $wscript
        $shortcut.Arguments = '"' + $launcher + '"'
        $shortcut.WorkingDirectory = $target
        $shortcut.IconLocation = $icon + ',0'
        $shortcut.Description = 'Folio PDF reader'
        $shortcut.Save()

        $shortcut = $shell.CreateShortcut((Join-Path $programFolder 'Uninstall Folio.lnk'))
        $shortcut.TargetPath = $wscript
        $shortcut.Arguments = '"' + $uninstaller + '"'
        $shortcut.WorkingDirectory = $target
        $shortcut.IconLocation = $icon + ',0'
        $shortcut.Description = 'Uninstall Folio'
        $shortcut.Save()
    }

    Write-Step 'Registering Folio...'
    try {
        $classes = 'HKCU:\Software\Classes'
        $command = '"' + $wscript + '" "' + $launcher + '" "%1"'

        foreach ($entry in @(
            @{ Extension = '.pdf'; ProgId = 'Folio.pdf'; Description = 'PDF document' },
            @{ Extension = '.folio'; ProgId = 'Folio.folio'; Description = 'Folio workspace' }
        )) {
            $openWith = Join-Path $classes ($entry.Extension + '\OpenWithProgids')
            New-Item -Path $openWith -Force | Out-Null
            New-ItemProperty -Path $openWith -Name $entry.ProgId -Value ([byte[]]@()) -PropertyType Binary -Force | Out-Null

            $progId = Join-Path $classes $entry.ProgId
            New-Item -Path $progId -Force | Out-Null
            Set-Item -Path $progId -Value $entry.Description
            New-Item -Path (Join-Path $progId 'DefaultIcon') -Force | Out-Null
            Set-Item -Path (Join-Path $progId 'DefaultIcon') -Value ($icon + ',0')
            New-Item -Path (Join-Path $progId 'shell\open\command') -Force | Out-Null
            Set-Item -Path (Join-Path $progId 'shell\open\command') -Value $command
        }

        $application = Join-Path $classes 'Applications\Folio.exe'
        New-Item -Path $application -Force | Out-Null
        New-ItemProperty -Path $application -Name 'FriendlyAppName' -Value 'Folio' -PropertyType String -Force | Out-Null
        New-Item -Path (Join-Path $application 'shell\open\command') -Force | Out-Null
        Set-Item -Path (Join-Path $application 'shell\open\command') -Value $command

        $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Folio'
        New-Item -Path $uninstallKey -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Folio' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value '1.0.0' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Folio' -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $target -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'DisplayIcon' -Value ($icon + ',0') -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value ('"' + $wscript + '" "' + $uninstaller + '"') -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null
    } catch {
        Write-Host '  Note: some optional Windows integration entries could not be written.' -ForegroundColor DarkYellow
        Write-Host ('  ' + $_.Exception.Message) -ForegroundColor DarkGray
    }

    Write-Host ''
    Write-Host '  Folio is installed.' -ForegroundColor Green
    Write-Host ('  ' + $target) -ForegroundColor DarkGray
    Write-Host ''

    if (-not $NoLaunch) {
        $shell = New-Object -ComObject WScript.Shell
        $answer = $shell.Popup('Folio is installed. Launch it now?', 0, 'Folio Setup', 4 + 64)
        if ($answer -eq 6) {
            Start-Process -FilePath $wscript -ArgumentList ('"' + $launcher + '"')
        }
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host '  Installation failed:' -ForegroundColor Red
    Write-Host ('  ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ''
    exit 1
}
