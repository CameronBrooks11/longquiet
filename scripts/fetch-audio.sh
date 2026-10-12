#!/usr/bin/env bash
# fetch-audio.sh — download the audio release named in sounds/sounds.json
# into public/audio/, refusing any file whose sha256 differs from the one
# recorded for it. Files already present and matching are kept.
#
# Built audio lives in GitHub release assets, not in git (#20). The repo is
# public, so this needs no token: only curl, jq and sha256sum.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/sounds/sounds.json"
out="$root/public/audio"

die() { echo "error: $*" >&2; exit 1; }

release=$(jq -r '.audio.release' "$manifest")
base=$(jq -r '.audio.baseUrl' "$manifest")
if [ "$release" = null ] || [ "$base" = null ]; then
    die "sounds.json has no audio.release / audio.baseUrl"
fi
mkdir -p "$out"

while IFS=$'\t' read -r id sha; do
    [ "$sha" != null ] || die "$id: no recorded build; run just sounds"
    file="$out/$id.mp3"
    if [ -f "$file" ] && echo "$sha  $file" | sha256sum --check --quiet - >/dev/null 2>&1; then
        echo "have    $id.mp3"
        continue
    fi
    part="$file.part"
    curl -fsSL --retry 3 -o "$part" "$base/$release/$id.mp3" || die "$id: download failed from $base/$release/$id.mp3"
    if ! echo "$sha  $part" | sha256sum --check --quiet - >/dev/null 2>&1; then
        rm -f -- "$part"
        die "$id: downloaded file does not match its recorded sha256"
    fi
    mv -- "$part" "$file"
    echo "fetched $id.mp3"
done < <(jq -r '.sounds[] | [.id, (.build.sha256 // "null")] | @tsv' "$manifest")
