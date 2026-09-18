#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${1:?source URL required}"
SEGMENTS="${2:-}"
TITLE="${3:-clip}"
VOICEOVER="${4:-}"
OUT_DIR="${OUT_DIR:-output}"
VOICE_MODEL="${PIPER_VOICE_MODEL:-voice/ru_RU-dmitri-medium.onnx}"
mkdir -p "$OUT_DIR" work

case "$SOURCE_URL" in
  https://rutube.ru/*|https://www.rutube.ru/*|https://vk.com/video*|https://vkvideo.ru/*)
    ;;
  *)
    echo "Unsupported source domain. Allowed: rutube.ru, vk.com/video*, vkvideo.ru" >&2
    exit 2
    ;;
esac

# Public sources only: no cookies, login or DRM workarounds.
python -m yt_dlp \
  --no-playlist \
  --restrict-filenames \
  --merge-output-format mp4 \
  -f "bv*[height<=1080]+ba/b[height<=1080]/b" \
  -o "work/source.%(ext)s" \
  "$SOURCE_URL"

SOURCE_FILE="$(find work -maxdepth 1 -type f -name 'source.*' | head -n 1)"
if [[ -z "$SOURCE_FILE" ]]; then
  echo "Source video was not downloaded." >&2
  exit 3
fi

FILTER="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30"
safe_title="$(printf '%s' "$TITLE" | tr ' /' '__' | LC_ALL=C tr -cd '[:alnum:]_.-' | cut -c1-80)"
[[ -n "$safe_title" ]] || safe_title="clip"
FINAL="$OUT_DIR/${safe_title}.mp4"

if [[ -z "$SEGMENTS" ]]; then
  ffmpeg -y -ss 0 -t 45 -i "$SOURCE_FILE" \
    -vf "$FILTER" -c:v libx264 -preset veryfast -crf 21 \
    -c:a aac -b:a 128k -movflags +faststart "$FINAL"
else
  IFS=',' read -ra RANGES <<< "$SEGMENTS"
  idx=0
  list_file="work/concat.txt"
  : > "$list_file"
  for range in "${RANGES[@]}"; do
    start="${range%-*}"
    end="${range#*-}"
    if ! [[ "$start" =~ ^[0-9]+([.][0-9]+)?$ && "$end" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
      echo "Invalid segment: $range (expected start-end, e.g. 0-5.5)" >&2
      exit 4
    fi
    duration="$(python - <<PY
s=float('$start'); e=float('$end')
assert e>s
print(e-s)
PY
)"
    part="work/part_${idx}.mp4"
    ffmpeg -y -ss "$start" -t "$duration" -i "$SOURCE_FILE" \
      -vf "$FILTER" -c:v libx264 -preset veryfast -crf 21 \
      -c:a aac -b:a 128k "$part"
    printf "file '%s'\n" "$(basename "$part")" >> "$list_file"
    idx=$((idx+1))
  done
  (cd work && ffmpeg -y -f concat -safe 0 -i concat.txt -c copy ../"$FINAL")
fi

if [[ -n "$VOICEOVER" ]]; then
  if [[ ! -f "$VOICE_MODEL" ]]; then
    echo "Piper voice model is missing: $VOICE_MODEL" >&2
    exit 5
  fi

  python -m piper -m "$VOICE_MODEL" -f work/voice_raw.wav -- "$VOICEOVER"

  video_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$FINAL")"
  voice_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 work/voice_raw.wav)"
  speed="$(python - <<PY
v=float('$video_duration'); a=float('$voice_duration')
target=max(v-0.25, 0.5)
print(max(1.0, a/target))
PY
)"

  if python - <<PY
import sys
sys.exit(0 if float('$speed') <= 2.0 else 1)
PY
  then
    if python - <<PY
import sys
sys.exit(0 if float('$speed') > 1.01 else 1)
PY
    then
      ffmpeg -y -i work/voice_raw.wav -filter:a "atempo=$speed" work/voice.wav
    else
      cp work/voice_raw.wav work/voice.wav
    fi
  else
    echo "Voiceover is too long for the selected clip. Shorten narration or choose longer segments." >&2
    exit 6
  fi

  voice_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 work/voice.wav)"
  python content-factory/scripts/make_srt.py \
    --text "$VOICEOVER" \
    --duration "$voice_duration" \
    --words-per-caption 3 \
    --output work/captions.srt

  ENRICHED="work/${safe_title}_enriched.mp4"
  ffmpeg -y -i "$FINAL" -i work/voice.wav \
    -filter_complex "[0:a]volume=0.16[bg];[1:a]volume=1.15[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=0[aout]" \
    -map 0:v:0 -map "[aout]" \
    -vf "subtitles=work/captions.srt:force_style='FontName=DejaVu Sans,FontSize=28,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=4,Shadow=0,Alignment=2,MarginV=230'" \
    -c:v libx264 -preset veryfast -crf 21 \
    -c:a aac -b:a 160k -movflags +faststart "$ENRICHED"
  mv "$ENRICHED" "$FINAL"
fi

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of json "$FINAL"
echo "OUTPUT_FILE=$FINAL"
