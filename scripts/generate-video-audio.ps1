[CmdletBinding()]
param(
  [string]$Voice = "en-US-AndrewMultilingualNeural",
  [string]$Rate = "-2%",
  [string]$Pitch = "-2Hz",
  [double]$PauseAfterSeconds = 0.25
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$scenePath = Join-Path $projectRoot "docs\video\narration.json"
$outputRoot = Join-Path $projectRoot "artifacts\video"
$audioRoot = Join-Path $outputRoot "audio"
$combinedAudio = Join-Path $outputRoot "narration.wav"
$captionsPath = Join-Path $outputRoot "captions.srt"
$concatPath = Join-Path $outputRoot "audio-concat.txt"
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$edgeVenvRoot = Join-Path $projectRoot "artifacts\video-tools\edge-venv"
$edgePython = Join-Path $edgeVenvRoot "Scripts\python.exe"
$edgeTts = Join-Path $edgeVenvRoot "Scripts\edge-tts.exe"

if (-not (Test-Path -LiteralPath $edgeTts)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $edgeVenvRoot) -Force | Out-Null
  & $python -m venv $edgeVenvRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not create the isolated video voice environment." }
  & $edgePython -m pip install --disable-pip-version-check "edge-tts==7.2.8"
  if ($LASTEXITCODE -ne 0) { throw "Could not install the neural text-to-speech dependency." }
}

New-Item -ItemType Directory -Path $audioRoot -Force | Out-Null
$scenes = Get-Content -Raw -Encoding utf8 -LiteralPath $scenePath | ConvertFrom-Json

$sourceSegmentPaths = @()
for ($index = 0; $index -lt $scenes.Count; $index += 1) {
  $sourceSegmentPath = Join-Path $audioRoot ("{0:D2}-{1}-source.mp3" -f $index, $scenes[$index].id)
  & $edgeTts --voice $Voice "--rate=$Rate" "--pitch=$Pitch" --text ([string]$scenes[$index].text) --write-media $sourceSegmentPath
  if ($LASTEXITCODE -ne 0) { throw "Could not synthesize narration scene $($scenes[$index].id)." }
  $sourceSegmentPaths += $sourceSegmentPath
}

$pauseText = $PauseAfterSeconds.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
$segmentPaths = @()
for ($index = 0; $index -lt $scenes.Count; $index += 1) {
  $segmentPath = Join-Path $audioRoot ("{0:D2}-{1}.wav" -f $index, $scenes[$index].id)
  & $ffmpeg -hide_banner -loglevel error -y -i $sourceSegmentPaths[$index] -af "apad=pad_dur=$pauseText" -ar 22050 -ac 1 -c:a pcm_s16le $segmentPath
  if ($LASTEXITCODE -ne 0) { throw "Could not normalize narration scene $($scenes[$index].id)." }
  $segmentPaths += $segmentPath
}

$silencePath = Join-Path $audioRoot "silence.wav"
& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anullsrc=r=22050:cl=mono" -t 1 -c:a pcm_s16le $silencePath
if ($LASTEXITCODE -ne 0) { throw "Could not create the narration lead-in." }

$concatLines = @($silencePath) + $segmentPaths | ForEach-Object {
  "file '$($_.Replace('\', '/').Replace("'", "'\''"))'"
}
[IO.File]::WriteAllLines($concatPath, $concatLines, [Text.UTF8Encoding]::new($false))
& $ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $concatPath -ar 22050 -ac 1 -c:a pcm_s16le $combinedAudio
if ($LASTEXITCODE -ne 0) { throw "Could not concatenate the narration audio." }

function Format-SrtTime([double]$seconds) {
  $time = [TimeSpan]::FromSeconds($seconds)
  return "{0:00}:{1:00}:{2:00},{3:000}" -f [Math]::Floor($time.TotalHours), $time.Minutes, $time.Seconds, $time.Milliseconds
}

function Split-CaptionChunks([string]$text, [int]$maximumLineLength = 38) {
  $chunks = New-Object System.Collections.Generic.List[string]
  $completedLine = ""
  $currentLine = ""
  foreach ($word in ($text -split "\s+")) {
    $candidate = if ($currentLine) { "$currentLine $word" } else { $word }
    if ($currentLine -and $candidate.Length -gt $maximumLineLength) {
      if ($completedLine) {
        $chunks.Add("$completedLine $currentLine")
        $completedLine = ""
      } else {
        $completedLine = $currentLine
      }
      $currentLine = $word
    } else {
      $currentLine = $candidate
    }
  }
  if ($currentLine) {
    $chunks.Add((@($completedLine, $currentLine) | Where-Object { $_ }) -join " ")
  }
  return $chunks.ToArray()
}

function Format-CaptionLines([string]$text, [int]$maximumLineLength = 38) {
  $lines = New-Object System.Collections.Generic.List[string]
  $current = ""
  foreach ($word in ($text -split "\s+")) {
    $candidate = if ($current) { "$current $word" } else { $word }
    if ($current -and $candidate.Length -gt $maximumLineLength) {
      $lines.Add($current)
      $current = $word
    } else {
      $current = $candidate
    }
  }
  if ($current) { $lines.Add($current) }
  return $lines -join "`r`n"
}

$captionBlocks = New-Object System.Collections.Generic.List[string]
$cursor = 1.0
$captionIndex = 1
for ($index = 0; $index -lt $scenes.Count; $index += 1) {
  $durationText = (& $ffprobe -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $segmentPaths[$index]).Trim()
  $duration = [double]::Parse($durationText, [Globalization.CultureInfo]::InvariantCulture)
  $sceneStart = $cursor
  $sceneEnd = $sceneStart + $duration
  $captionSource = if ($scenes[$index].captionText) { [string]$scenes[$index].captionText } else { [string]$scenes[$index].text }
  $chunks = @(Split-CaptionChunks $captionSource)
  $weights = @($chunks | ForEach-Object { ($_ -split "\s+").Count })
  $totalWeight = ($weights | Measure-Object -Sum).Sum
  $usedWeight = 0

  for ($chunkIndex = 0; $chunkIndex -lt $chunks.Count; $chunkIndex += 1) {
    $start = $sceneStart + ($duration * $usedWeight / $totalWeight)
    $usedWeight += $weights[$chunkIndex]
    $end = if ($chunkIndex -eq $chunks.Count - 1) {
      $sceneEnd
    } else {
      $sceneStart + ($duration * $usedWeight / $totalWeight)
    }
    $captionText = Format-CaptionLines $chunks[$chunkIndex]
    $captionBlocks.Add("$captionIndex`r`n$(Format-SrtTime $start) --> $(Format-SrtTime $end)`r`n$captionText`r`n")
    $captionIndex += 1
  }
  $cursor = $sceneEnd
}
[IO.File]::WriteAllText($captionsPath, ($captionBlocks -join "`r`n"), [Text.UTF8Encoding]::new($false))

$totalDuration = (& $ffprobe -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $combinedAudio).Trim()
Write-Host "Created neural narration with ${Voice} at ${Rate}: $totalDuration seconds"
