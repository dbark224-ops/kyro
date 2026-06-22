param(
  [string]$ApkPath = "$PSScriptRoot\..\android\app\build\outputs\apk\debug\app-debug.apk",
  [string]$MergedNativeLibsPath = "$PSScriptRoot\..\android\app\build\intermediates\merged_native_libs\debug\mergeDebugNativeLibs\out\lib"
)

$ErrorActionPreference = "Stop"

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$buildTools = Get-ChildItem -Path (Join-Path $sdkRoot "build-tools") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
$ndk = Get-ChildItem -Path (Join-Path $sdkRoot "ndk") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (!$buildTools) {
  throw "Android build-tools were not found under $sdkRoot."
}

if (!$ndk) {
  throw "Android NDK was not found under $sdkRoot."
}

$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$objdump = Join-Path $ndk.FullName "toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-objdump.exe"

if (!(Test-Path $zipalign)) {
  throw "zipalign.exe was not found at $zipalign."
}

if (!(Test-Path $objdump)) {
  throw "llvm-objdump.exe was not found at $objdump."
}

if (Test-Path $ApkPath) {
  Write-Host "Checking APK ZIP alignment with 16 KB page-size mode:"
  & $zipalign -c -P 16 -v 4 $ApkPath
} else {
  Write-Host "APK not found at $ApkPath. Build the Android app first."
}

if (!(Test-Path $MergedNativeLibsPath)) {
  Write-Host "Merged native libs not found at $MergedNativeLibsPath. Build the Android app first."
  exit 0
}

$badLibs = @()

Get-ChildItem -Path $MergedNativeLibsPath -Recurse -Filter "*.so" |
  Where-Object { $_.FullName -match "\\(arm64-v8a|x86_64)\\" } |
  ForEach-Object {
    $loads = & $objdump -p $_.FullName 2>$null | Select-String -Pattern "LOAD"
    $alignments = @(
      $loads | ForEach-Object {
        if ($_.Line -match "align\s+(\S+)") {
          $matches[1]
        }
      }
    ) | Sort-Object -Unique

    if ($alignments -contains "2**12") {
      $badLibs += [pscustomobject]@{
        Abi = $_.Directory.Name
        Library = $_.Name
        Alignment = ($alignments -join ", ")
        Path = $_.FullName
      }
    }
  }

if ($badLibs.Count -gt 0) {
  Write-Host ""
  Write-Host "Native libraries still using 4 KB alignment:"
  $badLibs | Format-Table -AutoSize
  exit 1
}

Write-Host ""
Write-Host "No arm64-v8a or x86_64 native libraries with 4 KB LOAD alignment were found."
