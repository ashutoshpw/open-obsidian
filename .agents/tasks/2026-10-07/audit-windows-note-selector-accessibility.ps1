Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$reportDirectory = $env:OBSIDIAN_REPORT_DIRECTORY
if ([string]::IsNullOrWhiteSpace($reportDirectory)) {
    throw "OBSIDIAN_REPORT_DIRECTORY must be set"
}
$null = New-Item -ItemType Directory -Force -Path $reportDirectory

$workDirectory = Join-Path $env:RUNNER_TEMP "openobsidian-c01-2-18"
$vaultPath = Join-Path $workDirectory "note selector vault"
$roamingPath = Join-Path $workDirectory "isolated roaming"
$localPath = Join-Path $workDirectory "isolated local"
$reportPath = Join-Path $reportDirectory "windows-note-selector-accessibility.json"
$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$originalDiagnostics = $env:OPENOBSIDIAN_CI_DIAGNOSTICS
$process = $null
$failure = $null
$beforeVault = $null
$beforeRoaming = $null
$beforeLocal = $null
$report = [ordered]@{
    schema_version = 1
    status = "in_progress"
    source_sha = $env:GITHUB_SHA
    operating_system = [System.Environment]::OSVersion.VersionString
    flow = "Native Windows UI Automation for the Note to inspect ComboBox"
    checks = [ordered]@{}
    accessibility = [ordered]@{
        initial_tree = @()
        expanded_tree = @()
        combo_box = $null
        options = @()
        selected_option = $null
        collapsed_after_selection = $null
    }
    snapshots = [ordered]@{}
    error = $null
}

function Get-SnapshotJson([string]$rootPath) {
    if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) {
        return "[]"
    }

    $rootFullPath = [System.IO.Path]::GetFullPath($rootPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    $prefix = $rootFullPath + [System.IO.Path]::DirectorySeparatorChar
    $entries = [System.Collections.Generic.List[object]]::new()
    $entries.Add([pscustomobject]@{
        path = "."
        kind = "directory"
        sha256 = $null
        reparse_point = $false
    })

    $children = Get-ChildItem -LiteralPath $rootFullPath -Force -Recurse -ErrorAction Stop |
        Sort-Object -Property FullName
    foreach ($child in $children) {
        $relativePath = $child.FullName.Substring($prefix.Length).Replace([string][char]92, "/")
        $isReparsePoint = (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
        if ($child.PSIsContainer) {
            $entries.Add([pscustomobject]@{
                path = $relativePath
                kind = "directory"
                sha256 = $null
                reparse_point = $isReparsePoint
            })
            continue
        }

        $hash = $null
        if (-not $isReparsePoint) {
            $hash = (Get-FileHash -LiteralPath $child.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $entries.Add([pscustomobject]@{
            path = $relativePath
            kind = if ($isReparsePoint) { "reparse_point" } else { "file" }
            sha256 = $hash
            reparse_point = $isReparsePoint
        })
    }

    return ConvertTo-Json -InputObject $entries.ToArray() -Depth 6 -Compress
}

function Get-SnapshotDigest([string]$snapshotJson) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($snapshotJson)
    $digest = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($digest).ToLowerInvariant()
}

function Get-ProcessElements([System.Windows.Automation.AutomationElement]$root, [int]$processId) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $processId
    )
    return @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
}

function Get-ElementSummary([System.Windows.Automation.AutomationElement]$element) {
    $current = $element.Current
    $labelName = ""
    try {
        if ($null -ne $current.LabeledBy) {
            $labelName = $current.LabeledBy.Current.Name
        }
    } catch {
        $labelName = ""
    }

    $hasExpandCollapse = $false
    try {
        $null = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $hasExpandCollapse = $true
    } catch {
        $hasExpandCollapse = $false
    }

    $hasSelectionItem = $false
    try {
        $null = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $hasSelectionItem = $true
    } catch {
        $hasSelectionItem = $false
    }

    return [pscustomobject]@{
        name = $current.Name
        labeled_by = $labelName
        control_type = $current.ControlType.ProgrammaticName
        automation_id = $current.AutomationId
        class_name = $current.ClassName
        enabled = $current.IsEnabled
        offscreen = $current.IsOffscreen
        supports_expand_collapse = $hasExpandCollapse
        supports_selection_item = $hasSelectionItem
    }
}

function Get-ListItems($elements) {
    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($element in $elements) {
        try {
            if ($element.Current.ControlType.ProgrammaticName -eq "ControlType.ListItem") {
                $summary = Get-ElementSummary $element
                $selected = $null
                try {
                    $selection = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                    $selected = $selection.Current.IsSelected
                } catch {
                    $selected = $null
                }
                $items.Add([pscustomobject]@{
                    element = $element
                    summary = $summary
                    selected = $selected
                })
            }
        } catch {
            continue
        }
    }
    return $items.ToArray()
}

function Write-AuditReport {
    $json = ConvertTo-Json -InputObject $report -Depth 16
    [System.IO.File]::WriteAllText(
        $reportPath,
        $json,
        [System.Text.UTF8Encoding]::new($false)
    )
}

try {
    if (-not (Test-Path -LiteralPath $env:OPENOBSIDIAN_BINARY -PathType Leaf)) {
        throw "The native OpenObsidian binary is unavailable"
    }

    if (Test-Path -LiteralPath $workDirectory) {
        Remove-Item -LiteralPath $workDirectory -Recurse -Force
    }
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $vaultPath "Notes")
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $vaultPath ".obsidian")
    $null = New-Item -ItemType Directory -Force -Path $roamingPath
    $null = New-Item -ItemType Directory -Force -Path $localPath

    [System.IO.File]::WriteAllText(
        (Join-Path $vaultPath "README.md"),
        "# Accessibility fixture" + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $vaultPath "Notes/Welcome.md"),
        "# Welcome" + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $vaultPath ".obsidian/app.json"),
        '{"unknownOption":true}' + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    $beforeVault = Get-SnapshotJson $vaultPath

    $env:APPDATA = $roamingPath
    $env:LOCALAPPDATA = $localPath
    $env:OPENOBSIDIAN_CI_DIAGNOSTICS = "1"

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:OPENOBSIDIAN_BINARY
    $startInfo.UseShellExecute = $false
    $null = $startInfo.ArgumentList.Add("--open-vault")
    $null = $startInfo.ArgumentList.Add($vaultPath)
    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "OpenObsidian did not start"
    }

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $window = $null
    $windowDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $windowDeadline -and $null -eq $window) {
        $windows = @(Get-ProcessElements $root $process.Id)
        foreach ($candidate in $windows) {
            try {
                if ($candidate.Current.ControlType.ProgrammaticName -eq "ControlType.Window" -and
                    -not $candidate.Current.IsOffscreen) {
                    $window = $candidate
                    break
                }
            } catch {
                continue
            }
        }
        if ($null -eq $window) {
            Start-Sleep -Milliseconds 300
        }
    }
    if ($null -eq $window) {
        throw "Windows UI Automation did not expose an OpenObsidian window for the process"
    }

    $elements = @(Get-ProcessElements $root $process.Id)
    $report.accessibility.initial_tree = @(
        $elements | ForEach-Object { Get-ElementSummary $_ } | Select-Object -First 300
    )

    $combo = $null
    $comboSummary = $null
    foreach ($element in $elements) {
        try {
            $summary = Get-ElementSummary $element
            if ($summary.control_type -eq "ControlType.ComboBox" -and
                (($summary.name -like "*Note to inspect*") -or ($summary.labeled_by -like "*Note to inspect*"))) {
                $combo = $element
                $comboSummary = $summary
                break
            }
        } catch {
            continue
        }
    }
    if ($null -eq $combo) {
        throw "The native accessibility tree did not expose Note to inspect as a labeled ComboBox"
    }
    if (-not $comboSummary.enabled -or $comboSummary.offscreen) {
        throw "The Note to inspect ComboBox is disabled or offscreen"
    }
    if (-not $comboSummary.supports_expand_collapse) {
        throw "The Note to inspect ComboBox does not expose UI Automation expand/collapse"
    }
    $report.accessibility.combo_box = $comboSummary

    $beforeRoaming = Get-SnapshotJson $roamingPath
    $beforeLocal = Get-SnapshotJson $localPath

    $expandCollapse = $combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    $expandCollapse.Expand()

    $expandedItems = @()
    $itemsDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $itemsDeadline) {
        $elements = @(Get-ProcessElements $root $process.Id)
        $expandedItems = @(Get-ListItems $elements)
        $names = @($expandedItems | ForEach-Object { $_.summary.name.Replace([string][char]92, "/") })
        if ($names -contains "README.md" -and $names -contains "Notes/Welcome.md") {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    $report.accessibility.expanded_tree = @(
        $elements | ForEach-Object { Get-ElementSummary $_ } | Select-Object -First 300
    )
    $report.accessibility.options = @($expandedItems | ForEach-Object {
        [pscustomobject]@{
            name = $_.summary.name
            control_type = $_.summary.control_type
            selected = $_.selected
            supports_selection_item = $_.summary.supports_selection_item
        }
    })

    $optionNames = @($expandedItems | ForEach-Object { $_.summary.name.Replace([string][char]92, "/") })
    if ($optionNames -notcontains "README.md" -or $optionNames -notcontains "Notes/Welcome.md") {
        throw "The expanded Note to inspect popup did not expose both expected note options through UI Automation"
    }

    $initiallySelected = @($expandedItems | Where-Object { $_.selected -eq $true })
    if ($initiallySelected.Count -ne 1 -or
        $initiallySelected[0].summary.name.Replace([string][char]92, "/") -ne "README.md") {
        throw "The expanded note selector did not report README.md as its single selected option"
    }

    $targetOption = $expandedItems |
        Where-Object { $_.summary.name.Replace([string][char]92, "/") -eq "Notes/Welcome.md" } |
        Select-Object -First 1
    if ($null -eq $targetOption -or -not $targetOption.summary.supports_selection_item) {
        throw "The Notes/Welcome.md option does not expose UI Automation selection"
    }

    $selectionItem = $targetOption.element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $selectionItem.Select()

    $selected = $false
    $selectionDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $selectionDeadline -and -not $selected) {
        try {
            $selected = $selectionItem.Current.IsSelected
        } catch {
            $selected = $false
        }
        if (-not $selected) {
            Start-Sleep -Milliseconds 150
        }
    }
    if (-not $selected) {
        throw "UI Automation selection did not select Notes/Welcome.md"
    }

    $report.accessibility.selected_option = [pscustomobject]@{
        name = $targetOption.summary.name
        control_type = $targetOption.summary.control_type
        selected = $true
    }
    try {
        $currentExpandState = $expandCollapse.Current.ExpandCollapseState.ToString()
        $report.accessibility.collapsed_after_selection = ($currentExpandState -eq "Collapsed")
    } catch {
        $report.accessibility.collapsed_after_selection = $null
    }

    $afterVault = Get-SnapshotJson $vaultPath
    $afterRoaming = Get-SnapshotJson $roamingPath
    $afterLocal = Get-SnapshotJson $localPath
    $report.snapshots.before_vault_sha256 = Get-SnapshotDigest $beforeVault
    $report.snapshots.during_vault_sha256 = Get-SnapshotDigest $afterVault
    $report.snapshots.before_roaming_sha256 = Get-SnapshotDigest $beforeRoaming
    $report.snapshots.during_roaming_sha256 = Get-SnapshotDigest $afterRoaming
    $report.snapshots.before_local_sha256 = Get-SnapshotDigest $beforeLocal
    $report.snapshots.during_local_sha256 = Get-SnapshotDigest $afterLocal
    if ($beforeVault -ne $afterVault -or $beforeRoaming -ne $afterRoaming -or $beforeLocal -ne $afterLocal) {
        throw "Vault or isolated application data changed during UI Automation expansion and selection"
    }
    $report.checks.vault_and_app_data_unchanged_during_accessibility_actions = $true
} catch {
    $failure = $_.Exception.Message
    $report.error = $_.ToString()
} finally {
    if ($null -ne $process) {
        try {
            $process.Refresh()
            if (-not $process.HasExited) {
                $null = $process.CloseMainWindow()
                if (-not $process.WaitForExit(8000)) {
                    $process.Kill($true)
                    $null = $process.WaitForExit(5000)
                }
            }
        } catch {
            if ($null -eq $failure) {
                $failure = "OpenObsidian teardown failed: $($_.Exception.Message)"
                $report.error = $_.ToString()
            }
        }
    }

    if ($null -ne $beforeVault) {
        try {
            $afterTeardownVault = Get-SnapshotJson $vaultPath
            $report.snapshots.after_teardown_vault_sha256 = Get-SnapshotDigest $afterTeardownVault
            $report.snapshots.vault_unchanged_after_teardown = ($beforeVault -eq $afterTeardownVault)
            if ($beforeVault -ne $afterTeardownVault -and $null -eq $failure) {
                $failure = "The vault changed during application teardown"
            }
        } catch {
            if ($null -eq $failure) {
                $failure = "Could not snapshot the vault after teardown: $($_.Exception.Message)"
            }
        }
    }

    if ($null -ne $beforeRoaming) {
        try {
            $afterTeardownRoaming = Get-SnapshotJson $roamingPath
            $report.snapshots.after_teardown_roaming_sha256 = Get-SnapshotDigest $afterTeardownRoaming
            $report.snapshots.roaming_unchanged_after_teardown = ($beforeRoaming -eq $afterTeardownRoaming)
            if ($beforeRoaming -ne $afterTeardownRoaming -and $null -eq $failure) {
                $failure = "Roaming application data changed during application teardown"
            }
        } catch {
            if ($null -eq $failure) {
                $failure = "Could not snapshot roaming application data after teardown: $($_.Exception.Message)"
            }
        }
    }

    if ($null -ne $beforeLocal) {
        try {
            $afterTeardownLocal = Get-SnapshotJson $localPath
            $report.snapshots.after_teardown_local_sha256 = Get-SnapshotDigest $afterTeardownLocal
            $report.snapshots.local_unchanged_after_teardown = ($beforeLocal -eq $afterTeardownLocal)
            if ($beforeLocal -ne $afterTeardownLocal -and $null -eq $failure) {
                $failure = "Local application data changed during application teardown"
            }
        } catch {
            if ($null -eq $failure) {
                $failure = "Could not snapshot local application data after teardown: $($_.Exception.Message)"
            }
        }
    }

    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
    $env:OPENOBSIDIAN_CI_DIAGNOSTICS = $originalDiagnostics
}

if ($null -eq $failure) {
    $report.status = "passed"
    $report.checks.note_inspector_combo_box_exposed = $true
    $report.checks.popup_lists_both_notes = $true
    $report.checks.ui_automation_selected_nested_note = $true
} else {
    $report.status = "failed"
    if ($null -eq $report.error) {
        $report.error = $failure
    }
}

Write-AuditReport
Write-Host "Windows note-selector accessibility audit: $($report.status)"
Write-Host "Report: $reportPath"
if ($null -ne $failure) {
    throw $failure
}
