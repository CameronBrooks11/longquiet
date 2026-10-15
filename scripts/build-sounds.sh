#!/usr/bin/env bash
# build-sounds.sh build|record|verify|check
#
#   build  verify each original in sounds/.cache against its sha256 in
#          sounds/sounds.json, render public/audio/<id>.mp3, record, check
#   record write each built file's sha256 and size into sounds/sounds.json
#   verify fail unless every built file matches its recorded sha256; run
#          before publishing the files as an audio release
#   check  measure the built public/audio/<id>.mp3 files and fail if any
#          is off the loudness target by more than 1 LU, has a true peak
#          above -1 dBTP, or has a loop point that stands out (below)
#
# The loop point is the level step from the last second to the first, as
# heard. A crossfaded loop is continuous there by construction, so the step is
# the recording's own second-to-second variation, and a fixed limit only says
# how busy the recording is: birdsong or waves step 2-3 dB between ordinary
# seconds. So the step must not exceed the recording's own 95th-percentile
# step between adjacent seconds, with 1.5 dB as the floor for steady sounds.
#
# Render per sound: optional excerpt, optional fades for a crossfaded loop, a
# static gain to the loudness target measured on the lossless intermediate, an
# optional peak limiter (recipe.limit, dBFS) for recordings whose rare
# transients would otherwise clip, then one encode with LAME VBR q2.
#
# The loop: out = in[0, end], faded in over its first X s and out over its
# last X s (quarter-sine, equal power). The player starts the next copy when
# the current one has X s left, so the fades overlap into the crossfade
# in[end-X, end] -> in[0, X] and no element ever restarts: an element looping
# itself goes briefly silent at each restart on iOS Safari (#34). The check
# mixes the file's tail into its head to hear that crossfade.
#
# Needs bash, jq, ffmpeg/ffprobe and awk.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/sounds/sounds.json"
cache="$root/sounds/.cache"
out="$root/public/audio"

target=$(jq -r '.loudnessTarget' "$manifest")
max_lu_off=1
max_true_peak=-1
min_seam_db=1.5

die() { echo "error: $*" >&2; exit 1; }

# Integrated loudness (LUFS) and true peak (dBTP) of a file, space-separated.
loudness() {
    ffmpeg -nostdin -hide_banner -nostats -i "$1" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 |
        awk '/^ *I:/ { i = $2 } /^ *Peak:/ { p = $2 } END { print i, p }'
}

# RMS level (dBFS) of one second of a file starting at $2 seconds.
rms_at() {
    ffmpeg -nostdin -hide_banner -nostats -ss "$2" -i "$1" -t 1 \
        -af astats=measure_perchannel=none:measure_overall=RMS_level -f null - 2>&1 |
        awk '/RMS level dB:/ { r = $NF } END { print r }'
}

# 95th percentile of |level step| between adjacent whole seconds of a file.
typical_step() {
    local sr
    sr=$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=nw=1:nk=1 "$1")
    ffmpeg -nostdin -hide_banner -nostats -i "$1" \
        -af "asetnsamples=n=$sr:p=1,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-" \
        -f null - 2>/dev/null |
        awk -F= '/RMS_level=/ { v[n++] = $2 }
            END { for (i = 1; i < n - 1; i++) { d = v[i] - v[i - 1]; print (d < 0 ? -d : d) } }' |
        sort -g |
        awk '{ s[m++] = $1 } END { printf "%.1f", (m ? s[int(0.95 * (m - 1))] : 0) }'
}

duration() {
    ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"
}

# Prints one line of measurements and ok|FAIL; returns 1 on FAIL. A playlist
# track ($3 = false) does not loop, so it has no seam to judge.
measure() {
    local id=$1 f=$2 loops=$3 x=$4 lufs tp dur end first last seam limit verdict
    read -r lufs tp < <(loudness "$f")
    if [ "$loops" = false ]; then
        verdict=$(awk -v l="$lufs" -v t="$target" -v p="$tp" -v ml="$max_lu_off" -v mp="$max_true_peak" '
            function abs(x) { return x < 0 ? -x : x }
            BEGIN { print (abs(l - t) <= ml && p <= mp) ? "ok" : "FAIL" }')
        printf '%-8s %7s LUFS %6s dBTP  (track, no loop)  %s\n' "$id" "$lufs" "$tp" "$verdict"
        [ "$verdict" = ok ]
        return
    fi
    dur=$(duration "$f")
    if [ "$x" = 0 ]; then
        first=$(rms_at "$f" 0)
        last=$(rms_at "$f" "$(awk -v d="$dur" 'BEGIN { print d - 1 }')")
        limit=$(typical_step "$f")
    else
        # As heard: the tail's fade-out under the head's fade-in, then the
        # file from X on. The fades themselves are left out of the typical step.
        end=$(awk -v d="$dur" -v x="$x" 'BEGIN { print d - x }')
        ffmpeg -nostdin -hide_banner -loglevel error -i "$f" -i "$f" -filter_complex "
          [0:a]atrim=start=$end,asetpts=PTS-STARTPTS[tail];
          [1:a]atrim=0:$x,asetpts=PTS-STARTPTS[head];
          [tail][head]amix=inputs=2:normalize=0:duration=shortest[out]" \
            -map '[out]' -c:a pcm_f32le "$tmp/$id.seam.wav"
        ffmpeg -nostdin -hide_banner -loglevel error -i "$f" -af "atrim=$x:$end" -c:a pcm_f32le "$tmp/$id.body.wav"
        first=$(rms_at "$f" "$x")
        last=$(rms_at "$tmp/$id.seam.wav" "$(awk -v d="$(duration "$tmp/$id.seam.wav")" 'BEGIN { print d - 1 }')")
        limit=$(typical_step "$tmp/$id.body.wav")
        rm -f -- "$tmp/$id.seam.wav" "$tmp/$id.body.wav"
    fi
    seam=$(awk -v a="$first" -v b="$last" 'BEGIN { printf "%.1f", a - b }')
    limit=$(awk -v t="$limit" -v m="$min_seam_db" 'BEGIN { printf "%.1f", (t > m ? t : m) }')
    verdict=$(awk -v l="$lufs" -v t="$target" -v p="$tp" -v s="$seam" \
        -v ml="$max_lu_off" -v mp="$max_true_peak" -v ms="$limit" '
        function abs(x) { return x < 0 ? -x : x }
        BEGIN { print (abs(l - t) <= ml && p <= mp && abs(s) <= ms) ? "ok" : "FAIL" }')
    printf '%-8s %7s LUFS %6s dBTP  seam %5s dB (limit %s)  %s\n' \
        "$id" "$lufs" "$tp" "$seam" "$limit" "$verdict"
    [ "$verdict" = ok ]
}

render() {
    local id=$1 file=$2 sha=$3 excerpt=$4 x=$5 limit=$6 in mix dur end lufs gain post
    in="$cache/$file"
    [ -f "$in" ] || die "$id: missing original $in (download it from the source page)"
    echo "$sha  $in" | sha256sum --check --quiet - || die "$id: $file does not match its sha256"

    mix="$tmp/$id.wav"
    dur=$(duration "$in")
    [ "$excerpt" = null ] || dur=$excerpt
    ffmpeg -nostdin -hide_banner -loglevel error -i "$in" -af "atrim=0:$dur" -c:a pcm_f32le "$tmp/$id.cut.wav"
    if [ "$x" = 0 ]; then
        mv -- "$tmp/$id.cut.wav" "$mix"
    else
        # Fade on the cut's own length: a decoded original can come out
        # slightly shorter than its container says.
        dur=$(duration "$tmp/$id.cut.wav")
        end=$(awk -v d="$dur" -v x="$x" 'BEGIN { print d - x }')
        ffmpeg -nostdin -hide_banner -loglevel error -i "$tmp/$id.cut.wav" \
            -af "afade=t=in:st=0:d=$x:curve=qsin,afade=t=out:st=$end:d=$x:curve=qsin" \
            -c:a pcm_f32le "$mix"
        rm -f -- "$tmp/$id.cut.wav"
    fi
    read -r lufs _ < <(loudness "$mix")
    gain=$(awk -v t="$target" -v l="$lufs" 'BEGIN { printf "%.2f", t - l }')
    post="volume=${gain}dB"
    if [ "$limit" != null ]; then
        # level=0: no make-up gain, so the limiter only ever turns peaks down.
        # latency=1: compensate the attack look-ahead; without it the output is
        # delayed 5 ms, opening a 5 ms hole at the start of the loop.
        post="$post,alimiter=limit=$(awk -v d="$limit" 'BEGIN { printf "%.4f", 10 ^ (d / 20) }'):level=0:attack=5:release=50:latency=1"
    fi
    ffmpeg -nostdin -hide_banner -loglevel error -y -i "$mix" -af "$post" \
        -map_metadata -1 -c:a libmp3lame -q:a 2 "$out/$id.mp3"
    local note=""
    [ "$limit" = null ] || note=", peaks limited to $limit dBFS"
    echo "built $id.mp3 (source $lufs LUFS, gain $gain dB$note)"
}

sounds() {
    jq -r 'def files: .sounds[] | if .tracks then (.tracks[] | . + {loop: false}) else . + {loop: true} end; files | [.id, .source.file, .source.sha256, (.recipe.excerpt // "null"), .recipe.crossfade, (.recipe.limit // "null"), .loop] | @tsv' "$manifest"
}

record() {
    local id sha bytes next
    while IFS=$'\t' read -r id _; do
        [ -f "$out/$id.mp3" ] || die "$id: missing $out/$id.mp3"
        sha=$(sha256sum "$out/$id.mp3" | cut -d' ' -f1)
        bytes=$(wc -c <"$out/$id.mp3")
        next=$(mktemp)
        jq --arg id "$id" --arg sha "$sha" --argjson bytes "$bytes" \
            'def files: .sounds[] | if .tracks then .tracks[] else . end; (files | select(.id == $id)).build = {sha256: $sha, bytes: $bytes}' \
            "$manifest" >"$next"
        mv -- "$next" "$manifest"
    done < <(sounds)
    echo "recorded build hashes in $manifest"
}

case "${1:-}" in
build)
    mkdir -p "$out"
    tmp=$(mktemp -d)
    trap 'rm -rf -- "$tmp"' EXIT
    while IFS=$'\t' read -r id file sha excerpt x limit _; do
        render "$id" "$file" "$sha" "$excerpt" "$x" "$limit"
    done < <(sounds)
    rm -rf -- "$tmp"
    trap - EXIT
    record
    exec "$0" check
    ;;
record)
    record
    ;;
verify)
    status=0
    list=$(jq -er 'def files: .sounds[] | if .tracks then (.tracks[] | . + {loop: false}) else . + {loop: true} end; files | [.id, .build.sha256] | @tsv' "$manifest")
    while IFS=$'\t' read -r id sha; do
        if ! echo "$sha  $out/$id.mp3" | sha256sum --check --quiet - 2>/dev/null; then
            echo "$id: $out/$id.mp3 is missing or differs from its recorded build" >&2
            status=1
        fi
    done <<<"$list"
    exit "$status"
    ;;
check)
    status=0
    tmp=$(mktemp -d)
    trap 'rm -rf -- "$tmp"' EXIT
    while IFS=$'\t' read -r id _ _ _ x _ loops; do
        [ -f "$out/$id.mp3" ] || die "$id: missing $out/$id.mp3"
        measure "$id" "$out/$id.mp3" "$loops" "$x" || status=1
    done < <(sounds)
    exit "$status"
    ;;
*)
    echo "usage: $0 build|record|verify|check" >&2
    exit 64
    ;;
esac
