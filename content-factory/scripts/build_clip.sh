#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${1:?source URL required}"
SEGMENTS="${2:-}"
TITLE="${3:-gaming-clip}"
VOICEOVER="${4:-}"
OUT_DIR="${OUT_DIR:-output}"
VOICE_MODEL="${PIPER_VOICE_MODEL:-voice/ru_RU-dmitri-medium.onnx}"
HOOK_TEXT="${HOOK_TEXT:-}"
MUSIC_ENABLED="${MUSIC_ENABLED:-1}"
MUSIC_VOLUME="${MUSIC_VOLUME:-0.075}"
MUSIC_STYLE="${MUSIC_STYLE:-auto}"
AD_ENABLED="${AD_ENABLED:-0}"
ADVERTISER_NAME="${ADVERTISER_NAME:-}"
AD_TEXT="${AD_TEXT:-}"
AD_ERID="${AD_ERID:-}"
AD_START="${AD_START:-6}"
AD_DURATION="${AD_DURATION:-5}"
mkdir -p "$OUT_DIR" work

case "$SOURCE_URL" in
  https://clips.twitch.tv/*|https://www.twitch.tv/*|https://twitch.tv/*|https://www.youtube.com/*|https://youtube.com/*|https://youtu.be/*|https://vk.com/video*|https://vkvideo.ru/*)
    ;;
  *)
    echo "Unsupported source domain. Allowed: Twitch, YouTube, VK Video." >&2
    exit 2
    ;;
esac

python -m yt_dlp --no-playlist --restrict-filenames --merge-output-format mp4 \
  -f "bv*[height<=1080]+ba/b[height<=1080]/b" \
  -o "work/source.%(ext)s" "$SOURCE_URL"

SOURCE_FILE="$(find work -maxdepth 1 -type f -name 'source.*' | head -n 1)"
if [[ -z "$SOURCE_FILE" ]]; then
  echo "Source video was not downloaded." >&2
  exit 3
fi

SOURCE_DURATION="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$SOURCE_FILE")"
if [[ -z "$SOURCE_DURATION" ]]; then
  echo "Could not determine source duration." >&2
  exit 11
fi

FILTER="split=2[fg][bg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:8[bgv];[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fgv];[bgv][fgv]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30"
safe_title="$(python - "$TITLE" <<'PY'
import re,sys
s=re.sub(r'[^A-Za-z0-9_.-]+','-',sys.argv[1]).strip('-')[:80]
print(s or 'gaming-clip')
PY
)"
FINAL="$OUT_DIR/${safe_title}.mp4"

render_range() {
  local start="$1"
  local duration="$2"
  local out="$3"
  ffmpeg -y -ss "$start" -t "$duration" -i "$SOURCE_FILE" \
    -filter_complex "$FILTER" -c:v libx264 -preset veryfast -crf 21 \
    -af "loudnorm=I=-16:LRA=11:TP=-1.5" \
    -c:a aac -b:a 160k -movflags +faststart "$out"
}

if [[ -z "$SEGMENTS" ]]; then
  # Default to the complete source clip. Never cut a gameplay moment at an arbitrary time limit.
  render_range 0 "$SOURCE_DURATION" "$FINAL"
else
  IFS=',' read -ra RANGES <<< "$SEGMENTS"
  idx=0
  list_file="work/concat.txt"
  : > "$list_file"
  for range in "${RANGES[@]}"; do
    start="${range%-*}"
    end="${range#*-}"
    if ! [[ "$start" =~ ^[0-9]+([.][0-9]+)?$ && "$end" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
      echo "Invalid segment: $range" >&2
      exit 4
    fi
    duration="$(python - <<PY
s=float('$start'); e=float('$end')
assert e>s
print(e-s)
PY
)"
    part="work/part_${idx}.mp4"
    render_range "$start" "$duration" "$part"
    printf "file '%s'\n" "$(basename "$part")" >> "$list_file"
    idx=$((idx+1))
  done
  (cd work && ffmpeg -y -f concat -safe 0 -i concat.txt -c copy ../"$FINAL")
fi

if [[ -n "$HOOK_TEXT" ]]; then
  hook_meta="$(python - "$HOOK_TEXT" <<'PY'
import sys,textwrap
text=' '.join(sys.argv[1].split())
if len(text) <= 30:
    width, size = 30, 42
elif len(text) <= 56:
    width, size = 28, 36
else:
    width, size = 25, 31
lines=textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False)
lines=lines[:3]
with open('work/hook.txt','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print(f"{len(lines)} {size}")
PY
)"
  hook_lines="${hook_meta%% *}"
  hook_size="${hook_meta##* }"
  hook_box_h=$((105 + 58 * hook_lines))
  hook_text_y=$((95 + (hook_box_h - hook_lines * (hook_size + 9)) / 2))
  HOOKED="work/${safe_title}_hook.mp4"
  ffmpeg -y -i "$FINAL" \
    -vf "drawbox=x=40:y=65:w=1000:h=${hook_box_h}:color=black@0.62:t=fill:enable='between(t,0,3.2)',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=work/hook.txt:fontcolor=white:fontsize=${hook_size}:line_spacing=9:x=(w-text_w)/2:y=${hook_text_y}:enable='between(t,0,3.2)'" \
    -c:v libx264 -preset veryfast -crf 21 -c:a copy -movflags +faststart "$HOOKED"
  mv "$HOOKED" "$FINAL"
fi

if [[ "$MUSIC_ENABLED" == "1" || "$MUSIC_ENABLED" == "true" ]]; then
  if ! [[ "$MUSIC_VOLUME" =~ ^0([.][0-9]+)?$|^1([.]0+)?$ ]]; then
    echo "MUSIC_VOLUME must be between 0 and 1." >&2
    exit 9
  fi
  if [[ "$MUSIC_STYLE" == "auto" ]]; then
    lower_title="$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lower_title" == *dota* ]]; then
      MUSIC_STYLE="ambient"
    elif [[ "$lower_title" == *cs2* || "$lower_title" == *counter* ]]; then
      MUSIC_STYLE="pulse"
    else
      style_pick="$(python - "$safe_title" <<'PY'
import hashlib,sys
print(int(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:2],16)%3)
PY
)"
      case "$style_pick" in
        0) MUSIC_STYLE="pulse" ;;
        1) MUSIC_STYLE="ambient" ;;
        *) MUSIC_STYLE="bounce" ;;
      esac
    fi
  fi
  video_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$FINAL")"
  fade_out_start="$(python - <<PY
v=float('$video_duration')
print(max(0.0, v-0.55))
PY
)"
  case "$MUSIC_STYLE" in
    pulse)
      MUSIC_EXPR='0.15*sin(2*PI*98*t)*(0.25+0.75*(sin(2*PI*2.15*t)*sin(2*PI*2.15*t)))+0.035*sin(2*PI*196*t)+0.018*sin(2*PI*392*t)'
      MUSIC_FILTER='lowpass=f=2200,highpass=f=75'
      ;;
    ambient)
      MUSIC_EXPR='0.10*sin(2*PI*82.41*t)+0.055*sin(2*PI*123.47*t)+0.035*sin(2*PI*164.81*t)+0.018*sin(2*PI*246.94*t)'
      MUSIC_FILTER='lowpass=f=1350,highpass=f=55,aecho=0.7:0.45:90|180:0.16|0.08'
      ;;
    bounce)
      MUSIC_EXPR='0.12*sin(2*PI*110*t)*(0.4+0.6*(sin(2*PI*1.65*t)*sin(2*PI*1.65*t)))+0.045*sin(2*PI*165*t)+0.025*sin(2*PI*220*t)'
      MUSIC_FILTER='lowpass=f=1900,highpass=f=70'
      ;;
    *) echo "Unknown MUSIC_STYLE: $MUSIC_STYLE" >&2; exit 10 ;;
  esac
  ffmpeg -y -f lavfi -i "aevalsrc=$MUSIC_EXPR:s=48000:d=$video_duration" \
    -af "$MUSIC_FILTER,afade=t=in:st=0:d=0.35,afade=t=out:st=$fade_out_start:d=0.55" \
    -c:a pcm_s16le work/music.wav
  MUSICAL="work/${safe_title}_music.mp4"
  ffmpeg -y -i "$FINAL" -i work/music.wav \
    -filter_complex "[0:a]volume=1.0[src];[1:a]volume=$MUSIC_VOLUME[music];[src][music]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-16:LRA=11:TP=-1.5[aout]" \
    -map 0:v:0 -map "[aout]" -c:v copy -c:a aac -b:a 160k -movflags +faststart "$MUSICAL"
  mv "$MUSICAL" "$FINAL"
fi

if [[ -n "$VOICEOVER" ]]; then
  if [[ ! -f "$VOICE_MODEL" ]]; then echo "Piper voice model is missing: $VOICE_MODEL" >&2; exit 5; fi
  python -m piper -m "$VOICE_MODEL" -f work/voice_raw.wav -- "$VOICEOVER"
  video_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$FINAL")"
  voice_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 work/voice_raw.wav)"
  speed="$(python - <<PY
v=float('$video_duration'); a=float('$voice_duration'); target=max(v-0.25,0.5); print(max(1.0,a/target))
PY
)"
  if python - <<PY
import sys; sys.exit(0 if float('$speed') <= 2.0 else 1)
PY
  then
    if python - <<PY
import sys; sys.exit(0 if float('$speed') > 1.01 else 1)
PY
    then ffmpeg -y -i work/voice_raw.wav -filter:a "atempo=$speed" work/voice.wav; else cp work/voice_raw.wav work/voice.wav; fi
  else echo "Voiceover is too long for the selected clip." >&2; exit 6; fi
  voice_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 work/voice.wav)"
  python content-factory/scripts/make_srt.py --text "$VOICEOVER" --duration "$voice_duration" --words-per-caption 3 --output work/captions.srt
  ENRICHED="work/${safe_title}_enriched.mp4"
  ffmpeg -y -i "$FINAL" -i work/voice.wav \
    -filter_complex "[0:a]volume=0.28[bg];[1:a]volume=1.12[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=0[aout]" \
    -map 0:v:0 -map "[aout]" \
    -vf "subtitles=work/captions.srt:force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=42'" \
    -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 160k -movflags +faststart "$ENRICHED"
  mv "$ENRICHED" "$FINAL"
fi

if [[ "$AD_ENABLED" == "1" || "$AD_ENABLED" == "true" ]]; then
  if [[ -z "$ADVERTISER_NAME" || -z "$AD_TEXT" || -z "$AD_ERID" ]]; then echo "Paid ad banner requires ADVERTISER_NAME, AD_TEXT and AD_ERID." >&2; exit 7; fi
  if ! [[ "$AD_START" =~ ^[0-9]+([.][0-9]+)?$ && "$AD_DURATION" =~ ^[0-9]+([.][0-9]+)?$ ]]; then echo "AD_START and AD_DURATION must be numeric seconds." >&2; exit 8; fi
  AD_END="$(python - <<PY
print(float('$AD_START') + float('$AD_DURATION'))
PY
)"
  printf 'РЕКЛАМА · %s\n%s\nerid: %s\n' "$ADVERTISER_NAME" "$AD_TEXT" "$AD_ERID" > work/ad_banner.txt
  ADDED="work/${safe_title}_ad.mp4"
  ffmpeg -y -i "$FINAL" \
    -vf "drawbox=x=36:y=1570:w=1008:h=250:color=black@0.74:t=fill:enable='between(t,$AD_START,$AD_END)',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=work/ad_banner.txt:fontcolor=white:fontsize=34:line_spacing=9:x=64:y=h-315:enable='between(t,$AD_START,$AD_END)'" \
    -c:v libx264 -preset veryfast -crf 21 -c:a copy -movflags +faststart "$ADDED"
  mv "$ADDED" "$FINAL"
fi

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of json "$FINAL"
echo "OUTPUT_FILE=$FINAL"
