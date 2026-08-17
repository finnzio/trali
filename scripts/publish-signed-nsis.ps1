$ErrorActionPreference = "Stop"

$workspace = $env:GITHUB_WORKSPACE
if ([string]::IsNullOrWhiteSpace($workspace)) {
  throw "GITHUB_WORKSPACE is not set"
}
Set-Location $workspace

$tag = $env:GITHUB_REF_NAME
if ([string]::IsNullOrWhiteSpace($tag) -or -not $tag.StartsWith("v")) {
  throw "Expected a v* tag in GITHUB_REF_NAME, got '$tag'"
}

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  throw "TAURI_SIGNING_PRIVATE_KEY is not set"
}

if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
  throw "GH_TOKEN is not set"
}

$signedRoot = Join-Path $workspace "signed-nsis"
if (-not (Test-Path $signedRoot)) {
  throw "Signed artifact directory not found: $signedRoot"
}

$signedExes = @(
  Get-ChildItem -Path $signedRoot -Filter "*.exe" -Recurse -File |
    Where-Object { $_.Name -notlike "*.sig" }
)
if ($signedExes.Count -eq 0) {
  throw "Signed NSIS .exe not found under $signedRoot"
}
if ($signedExes.Count -gt 1) {
  $names = $signedExes | ForEach-Object { $_.FullName }
  throw "Expected exactly one signed NSIS .exe under $signedRoot, found: $($names -join ', ')"
}

$releaseDir = Join-Path $workspace "signed-release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$assetName = "Trali-$tag-windows-x64-setup.exe"
$releaseExe = Join-Path $releaseDir $assetName
Copy-Item -LiteralPath $signedExes[0].FullName -Destination $releaseExe -Force
Write-Host "Copied signed installer to $releaseExe"

Write-Host "Re-signing updater payload with the existing Tauri key"
& pnpm tauri signer sign -- $releaseExe
if ($LASTEXITCODE -ne 0) {
  throw "pnpm tauri signer sign failed with exit code $LASTEXITCODE"
}

$releaseSig = "$releaseExe.sig"
if (-not (Test-Path $releaseSig)) {
  throw "Expected updater signature at $releaseSig"
}

$repoArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY)) {
  $repoArgs = @("--repo", $env:GITHUB_REPOSITORY)
}

Write-Host "Uploading $assetName and $assetName.sig to release $tag"
& gh release upload $tag $releaseExe $releaseSig --clobber @repoArgs
if ($LASTEXITCODE -ne 0) {
  throw "gh release upload of signed NSIS assets failed with exit code $LASTEXITCODE"
}

$latestDir = Join-Path $workspace "signed-release-latest"
New-Item -ItemType Directory -Force -Path $latestDir | Out-Null
Write-Host "Downloading latest.json from release $tag"
& gh release download $tag --pattern latest.json --dir $latestDir --clobber @repoArgs
if ($LASTEXITCODE -ne 0) {
  throw "Failed to download latest.json from $tag (exit code $LASTEXITCODE)"
}

$latestPath = Join-Path $latestDir "latest.json"
if (-not (Test-Path $latestPath)) {
  throw "latest.json was not downloaded to $latestPath"
}

$sigText = (Get-Content -LiteralPath $releaseSig -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($sigText)) {
  throw "Updater signature file is empty: $releaseSig"
}

$assetApiUrl = & gh release view $tag --json assets --jq ".assets[] | select(.name==`"$assetName`") | .apiUrl" @repoArgs
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($assetApiUrl)) {
  throw "Could not resolve the release asset URL for $assetName"
}
$assetApiUrl = $assetApiUrl.Trim()

$sigFile = Join-Path $latestDir "windows-nsis.sig"
Set-Content -LiteralPath $sigFile -Value $sigText -NoNewline -Encoding utf8NoBOM

$patchJs = Join-Path $latestDir "patch-latest-nsis.mjs"
@'
import fs from "node:fs";

const latestPath = process.argv[2];
const signature = fs.readFileSync(process.argv[3], "utf8").trim();
const assetUrl = process.argv[4];

const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
const platform = latest?.platforms?.["windows-x86_64-nsis"];
if (!platform || typeof platform !== "object") {
  throw new Error("latest.json is missing platforms.windows-x86_64-nsis");
}

platform.signature = signature;
if (assetUrl) {
  platform.url = assetUrl;
}

fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
'@ | Set-Content -LiteralPath $patchJs -Encoding utf8NoBOM

Write-Host "Updating windows-x86_64-nsis signature in latest.json"
& node $patchJs $latestPath $sigFile $assetApiUrl
if ($LASTEXITCODE -ne 0) {
  throw "Failed to patch latest.json (exit code $LASTEXITCODE)"
}

Write-Host "Uploading refreshed latest.json to release $tag"
& gh release upload $tag $latestPath --clobber @repoArgs
if ($LASTEXITCODE -ne 0) {
  throw "gh release upload of latest.json failed with exit code $LASTEXITCODE"
}

Write-Host "Published signed NSIS installer and refreshed windows-x86_64-nsis updater metadata"
