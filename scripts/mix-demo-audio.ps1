[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$videoRoot = Join-Path $projectRoot "artifacts\video"
$audioRoot = Join-Path $videoRoot "audio"
$effectsRoot = Join-Path $audioRoot "effects"
$scenePath = Join-Path $projectRoot "docs\video\narration.json"
$narration = Join-Path $videoRoot "narration.wav"
$mixedNarration = Join-Path $videoRoot "narration-with-ui.wav"
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $effectsRoot -Force | Out-Null
$tapEffect = Join-Path $effectsRoot "tap.wav"
$crashEffect = Join-Path $effectsRoot "crash.wav"
$resumeEffect = Join-Path $effectsRoot "resume.wav"

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=r=48000:d=0.022:c=white:a=0.16,highpass=f=2200,lowpass=f=7500,afade=t=out:st=0:d=0.022,volume=0.38" -ar 48000 -ac 1 -c:a pcm_s16le $tapEffect
if ($LASTEXITCODE -ne 0) { throw "Could not create tap sound." }

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=210:sample_rate=48000:duration=0.14" -af "volume=0.045,afade=t=in:st=0:d=0.01,afade=t=out:st=0.04:d=0.1" -ar 48000 -ac 1 -c:a pcm_s16le $crashEffect
if ($LASTEXITCODE -ne 0) { throw "Could not create crash sound." }

& $ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=640:sample_rate=48000:duration=0.09" -f lavfi -i "sine=frequency=860:sample_rate=48000:duration=0.1" -filter_complex "[0:a]volume=0.04,afade=t=out:st=0.03:d=0.06[first];[1:a]volume=0.032,adelay=55:all=1,afade=t=out:st=0.07:d=0.09[second];[first][second]amix=inputs=2:duration=longest:normalize=0[out]" -map "[out]" -ar 48000 -ac 1 -c:a pcm_s16le $resumeEffect
if ($LASTEXITCODE -ne 0) { throw "Could not create resume sound." }

$scenes = Get-Content -Raw -Encoding utf8 -LiteralPath $scenePath | ConvertFrom-Json
$sceneStarts = @{}
$cursor = 1.0
for ($index = 0; $index -lt $scenes.Count; $index += 1) {
  $sceneStarts[$scenes[$index].id] = $cursor
  $segmentPath = Join-Path $audioRoot ("{0:D2}-{1}.wav" -f $index, $scenes[$index].id)
  $durationText = (& $ffprobe -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $segmentPath).Trim()
  $cursor += [double]::Parse($durationText, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-DelayMilliseconds([string]$sceneId) {
  return [Math]::Round([double]$sceneStarts[$sceneId] * 1000)
}

$clickAnnotationDelay = 400
$crashDelay = (Get-DelayMilliseconds "crash") + $clickAnnotationDelay
$resumeDelay = (Get-DelayMilliseconds "resume") + $clickAnnotationDelay
$mixFilter = "[0:a]loudnorm=I=-16:TP=-2:LRA=11[voice];" +
  "[1:a]adelay=${crashDelay}:all=1[crash];" +
  "[2:a]adelay=${resumeDelay}:all=1[resume];" +
  "[voice][crash][resume]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.84:level=false[mix]"

& $ffmpeg -hide_banner -loglevel error -y -i $narration -i $crashEffect -i $resumeEffect -filter_complex $mixFilter -map "[mix]" -ar 48000 -ac 1 -c:a pcm_s16le $mixedNarration
if ($LASTEXITCODE -ne 0) { throw "Could not mix narration and UI sounds." }

Write-Host "Created UI sound mix at $mixedNarration"
