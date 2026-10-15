# Sounds

`sounds.json` lists every recording longquiet plays. It is the single source
for attribution (the app's credits and the tests read it) and for how each
file is built (`scripts/build-sounds.sh` reads it).

## What qualifies

- A real recording: a field recording, or a performance. No synthesis,
  no AI-generated audio.
- A licence that allows hosting and redistributing the file here: CC0,
  public domain, CC BY or CC BY-SA (our processed copy of a BY-SA track
  carries BY-SA, and the credits say so). No NC or ND licences, and
  nothing under a site's own terms (BBC Sound Effects, for example).
- For music, the composition must be free too: public domain, or under
  one of the licences above. A free recording of a work still in
  copyright does not qualify.
- On Wikimedia Commons, read the licence template on the file page
  itself. The API's licence summary can report a public-domain template
  that covers the composition, not the recording.
- Licence, title, author and URL copied from the recording's own page, not
  from a search result or a summary.
- Long and steady: five minutes or more, no voices, little traffic or
  handling noise unless it can be trimmed, and no single event striking
  enough to be noticed on every loop.
- Auditioned end to end by a person before it ships. The build measures
  levels; it cannot hear a dog bark at minute six.

## Adding a sound

1. Log in on freesound.org (or the source site), download the original
   file, and save it in `sounds/.cache/` under its downloaded name. That
   directory is gitignored: originals are never committed.
2. Add an entry to `sounds.json`, with `section` set to one of the ids
   in `sections` (a section appears in the app once it has a sound).
   `source.sha256` is the output of
   `sha256sum sounds/.cache/<file>`; `source.format` reads like
   `24-bit WAV`. A loop needs a lossless original (WAV, FLAC, AIFF); a
   playlist piece may use a lossy one (`Ogg Vorbis`, `MP3`) when no
   lossless copy exists, since it is only levelled and re-encoded. In `recipe`, `excerpt` is the number of seconds to keep
   from the start (or `null` for all of it) and `crossfade` the seconds of
   fade at each end of a loop, which the player overlaps into a crossfade
   (8 is a good default; a loop needs more than 0, and a playlist piece
   uses 0). `limit`, optional, is a sample-peak ceiling in
   dBFS (between −24 and 0) for a peak limiter after the gain: use it only
   when rare transients, such as drops on a tent, would otherwise clip,
   and say so in review. The credits mention it.
3. Add the recording to the table in the top-level README.
4. `just sounds` renders `public/audio/<id>.mp3`, records each file's
   sha256 and size in `sounds.json`, and checks them. Listen to the
   whole file, and to the loop point: a faded loop alone fades to silence
   there, so `just audio-seam <id>` writes `sounds/.cache/<id>.seam.wav`,
   its end overlapped with its start as the player plays them.
5. `just publish-audio audio-YYYY.MM.DD` (add `.N` for a second release
   the same day) uploads every built file as a
   new GitHub release and names it in `sounds.json` (needs `gh`). Commit
   `sounds.json`; the deploy fetches that release and verifies each file
   against its recorded hash. Publish before the pull request: CI checks
   that the named release holds every recorded file, so the PR fails
   until it does. If an upload fails partway, `publish-audio.sh` says how
   to finish it.

## Checks

`just audio-check` measures every file in `public/audio/` and fails if one
is more than 1 LU off the loudness target, has a true peak above −1 dBTP,
or has a loop point that stands out: the level step from its last second
to its first must be no larger than the recording's own 95th-percentile
step between adjacent seconds (at least 1.5 dB). For a faded loop the last
second is the end mixed into the start, as the player overlaps them, so
the check catches ends that were not faded, which overlap into a swell of
about 3 dB. It does not catch a recording that ends at a different level
from where it starts, since the crossfade spreads that step over its
length: listen to the seam. The tests fail if an entry is missing its
file, its attribution, or an allowed licence.

Screen a candidate before building it. A recording whose peaks sit more
than about 25 dB above its average loudness (a crackling fire, close
thunder) cannot reach the target without clipping, and fails on true
peak. If only a handful of short transients exceed the ceiling, `limit`
can take them down; if they are frequent, the recording does not fit. Sudden jumps of 10 LU or more, or a level that drifts across the
recording, are not measured by the check at all, and they startle or
break the loop; reject those by listening.

Built audio is not committed. `public/audio/` is gitignored; `just
fetch-audio` downloads the release named in `sounds.json` and refuses
any file whose hash differs from the recorded one. Old releases are left
in place, so any past commit can still be built. The live site must stay
under GitHub Pages' 1 GB.
