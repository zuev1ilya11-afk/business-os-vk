#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${1:?source URL required}"
SEGMENTS="${2:-}"
TITLE="${3:-clip}"
OUT_DIR="${OUT_DIR:-output}"
mkdir -p "$OUT_DIR" work

case "$SOURCE_URL" in
  https://rutube.ru/*|https://www.rutube.ru/*|https://vk.com/video*|https://vkvideo.ru/*)
    ;;
  *)
    echo "Unsupported source domain. Allowed: rutube.ru, vk.com/video*, vkvideo.ru" >&2
    exit 2
    ;;
esac

# No cookies, no login and no DRM workarounds are used.
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

# Keep filenames portable across GitHub runners. Put '-' last so tr never treats it as a range.
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

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height -of json "$FINAL"
echo "OUTPUT_FILE=$FINAL"
