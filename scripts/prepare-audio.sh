#!/usr/bin/env bash
# prepare-audio.sh <src-dir> <out-dir>
#
# Rebuilds public/audio/ from the Freesound HQ previews listed in
# src/catalogue.ts. <src-dir> holds the previews under their CDN file names.
#
# Per file: optional excerpt, then an optional crossfaded loop, then a static
# gain to about -26 LUFS integrated, encoded once with LAME VBR q2.
#
# The loop: output = in[X, end-X] + crossfade(in[end-X, end] -> in[0, X]).
# It finishes at in[X], where it starts, so a plain <audio loop> has no seam.
# Each segment is a separate input because acrossfade produced no output when
# fed from asplit; the fade is 0.1 s shorter than X because the decoded tail
# comes out slightly shorter than the container duration.
set -euo pipefail

src=${1:?usage: prepare-audio.sh <src-dir> <out-dir>}
out=${2:?usage: prepare-audio.sh <src-dir> <out-dir>}
mkdir -p "$out"

# id  source-file  excerpt-seconds(0 = whole)  crossfade-seconds(0 = none)  gain-dB
# Gains from `ffmpeg -af ebur128` integrated loudness: target - measured.
recipes=(
    "rain   759545_15375955-hq.mp3 0   8 -10.2"
    "forest 830253_11606594-hq.mp3 0   0 3.0"
    "stream 732848_12768873-hq.mp3 620 8 12.7"
    "night  645706_13222620-hq.mp3 0   8 10.2"
)

for r in "${recipes[@]}"; do
    read -r id file excerpt x gain <<<"$r"
    in="$src/$file"
    [ -f "$in" ] || { echo "missing $in" >&2; exit 1; }
    dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in")
    if [ "$excerpt" != 0 ]; then dur=$excerpt; fi
    if [ "$x" = 0 ]; then
        graph="[0:a]atrim=0:$dur,volume=${gain}dB[out]"
    else
        end=$(echo "$dur - $x" | bc)
        fade=$(echo "$x - 0.1" | bc)
        graph="
          [0:a]atrim=$x:$end,asetpts=PTS-STARTPTS[body];
          [1:a]atrim=$end:$dur,asetpts=PTS-STARTPTS[tail];
          [2:a]atrim=0:$x,asetpts=PTS-STARTPTS[head];
          [tail][head]acrossfade=d=$fade:c1=qsin:c2=qsin[seam];
          [body][seam]concat=n=2:v=0:a=1,volume=${gain}dB[out]"
    fi
    ffmpeg -hide_banner -loglevel error -y -i "$in" -i "$in" -i "$in" \
        -filter_complex "$graph" -map '[out]' -map_metadata -1 \
        -c:a libmp3lame -q:a 2 "$out/$id.mp3"
    echo "$id.mp3"
done
