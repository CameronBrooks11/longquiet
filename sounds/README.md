# Sounds

`sounds.json` lists every recording longquiet plays. It is the single source
for attribution (the app's credits and the tests read it) and for how each
file is built (`scripts/build-sounds.sh` reads it).

## What qualifies

- A real field recording. No synthesis, no AI-generated audio.
- A licence that allows hosting and redistributing the file here: CC0,
  CC BY 4.0, or public domain. No NC or ND licences, and nothing under a
  site's own terms (BBC Sound Effects, for example).
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
2. Add an entry to `sounds.json`. `source.sha256` is the output of
   `sha256sum sounds/.cache/<file>`; `source.format` reads like
   `24-bit WAV`. In `recipe`, `excerpt` is the number of seconds to keep
   from the start (or `null` for all of it) and `crossfade` the seconds of
   end blended into the start (8 is a good default; 0 for a recording
   already made to loop).
3. Add the recording to the table in the top-level README.
4. `just sounds` renders `public/audio/<id>.mp3` and checks it. Listen to
   the whole file, and to the loop point, before committing.

## Checks

`just audio-check` measures every file in `public/audio/` and fails if one
is more than 1 LU off the loudness target, has a true peak above −1 dBTP,
or has a loop point that stands out: the level step from its last second
to its first must be no larger than the recording's own 95th-percentile
step between adjacent seconds (at least 1.5 dB). A busy recording such as
birdsong varies by several dB from second to second, so for those only
listening can judge the loop. The tests fail if an entry is missing its
file, its attribution, or an allowed licence.

A recording whose loudest moments sit far above its average (crackling
fire, close thunder) cannot reach the loudness target without its peaks
clipping, and its sudden peaks would startle a listener anyway. The check
rejects it on true peak; choose a steadier recording.

Built audio is committed while the total stays under 150 MB. Past that it
moves to versioned release assets.
