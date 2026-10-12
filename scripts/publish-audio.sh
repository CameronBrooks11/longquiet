#!/usr/bin/env bash
# publish-audio.sh <tag> — upload the built files named in sounds/sounds.json
# as a new GitHub release, then name that release in sounds.json.
#
# Only the manifest's files are uploaded, after checking each matches its
# recorded hash. If the upload fails partway, finish it with
#   gh release upload <tag> public/audio/<id>.mp3 --clobber
# or delete the release and run this again. Needs gh and jq.
set -euo pipefail

tag=${1:?usage: publish-audio.sh <tag>, e.g. audio-2026.10.12}
root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/sounds/sounds.json"

"$root/scripts/build-sounds.sh" verify
ids=$(jq -er 'def files: .sounds[] | if .tracks then (.tracks[] | . + {loop: false}) else . + {loop: true} end; files | .id' "$manifest")
files=()
while read -r id; do files+=("$root/public/audio/$id.mp3"); done <<<"$ids"

gh release create "$tag" "${files[@]}" --latest=false --title "Audio $tag" \
    --notes "Built audio for longquiet; see sounds/sounds.json for sources and licences."

next=$(mktemp)
jq --arg t "$tag" '.audio.release = $t' "$manifest" >"$next"
mv -- "$next" "$manifest"
echo "published $tag (${#files[@]} files) and named it in sounds.json"
