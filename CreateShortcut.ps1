# Creates a Desktop shortcut for NexusPort
$WshShell = New-Object -comObject WScript.Shell

$Desktop = [System.Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$Desktop\NexusPort.lnk")
$Shortcut.TargetPath = "$PSScriptRoot\START.bat"
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "Launch NexusPort Maritime Operations"
$Shortcut.IconLocation = "C:\Windows\System32\imageres.dll,21"
$Shortcut.Save()

Write-Host "Desktop shortcut created!" -ForegroundColor Green
Write-Host "Look for 'NexusPort' on your Desktop." -ForegroundColor Cyan
