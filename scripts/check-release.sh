#!/usr/bin/env bash
# check-release.sh — fail unless the audio release named in sounds/sounds.json
# holds, for every sound, an asset with the recorded sha256 and size.
#
# Runs in CI so a forgotten `just publish-audio` fails the pull request
# rather than the deploy after merge. Reads the release through the GitHub
# API (asset digests), so nothing is downloaded. Needs gh and jq; in Actions,
# gh authenticates with GH_TOKEN.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/sounds/sounds.json"

release=$(jq -er '.audio.release' "$manifest")
base=$(jq -er '.audio.baseUrl' "$manifest")
repo=${base#https://github.com/}
repo=${repo%/releases/download}

assets=$(gh api "repos/$repo/releases/tags/$release" --jq '.assets[] | [.name, .digest, .size] | @tsv')
wanted=$(jq -er 'def files: .sounds[] | if .tracks then (.tracks[] | . + {loop: false}) else . + {loop: true} end; files | [.id, .build.sha256, .build.bytes] | @tsv' "$manifest")

status=0
while IFS=$'\t' read -r id sha bytes; do
    have=$(awk -F'\t' -v n="$id.mp3" '$1 == n { print $2 "\t" $3 }' <<<"$assets")
    if [ "$have" != "sha256:$sha"$'\t'"$bytes" ]; then
        echo "$id: release $release has ${have:-no $id.mp3}, sounds.json records sha256:$sha $bytes" >&2
        status=1
    fi
done <<<"$wanted"
[ "$status" = 0 ] && echo "release $release matches sounds.json ($(wc -l <<<"$wanted") files)"
exit "$status"
