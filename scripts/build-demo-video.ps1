[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$videoRoot = Join-Path $projectRoot "artifacts\video"
$silentVideo = Join-Path $videoRoot "continuum-demo-silent.webm"
$narration = Join-Path $videoRoot "narration-with-ui.wav"
$finalVideo = Join-Path $videoRoot "Continuum-hackathon-demo.mp4"
$captions = Join-Path $videoRoot "captions.srt"
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDirectory "generate-video-audio.ps1")
if ($LASTEXITCODE -ne 0) { throw "Narration generation failed." }

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDirectory "mix-demo-audio.ps1")
if ($LASTEXITCODE -ne 0) { throw "Narration sound mix failed." }

& node (Join-Path $scriptDirectory "record-demo-video.js")
if ($LASTEXITCODE -ne 0) { throw "Demo recording failed." }

if (-not (Test-Path -LiteralPath $silentVideo)) {
  throw "Silent recording missing: $silentVideo"
}

& $ffmpeg -hide_banner -loglevel error -y `
  -i $silentVideo `
  -i $narration `
  -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x10231f,setsar=1,fps=30,format=yuv420p[v]" `
  -map "[v]" -map 1:a `
  -c:v libx264 -preset slow -crf 16 -tune animation `
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709" `
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
  -c:a aac -b:a 192k -ar 48000 -ac 1 `
  -movflags +faststart `
  -shortest `
  $finalVideo
if ($LASTEXITCODE -ne 0) { throw "Final MP4 rendering failed." }

$duration = (& $ffprobe -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $finalVideo).Trim()
$file = Get-Item -LiteralPath $finalVideo
Write-Host "Created $($file.FullName)"
Write-Host "Duration: $duration seconds; size: $([Math]::Round($file.Length / 1MB, 2)) MB"
Write-Host "Captions: $captions"
Write-Host "Disclose on YouTube that narration is AI-generated."
