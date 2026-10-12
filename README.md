# longquiet

Real field recordings, openly licensed, for long hours of quiet. Pick a
soundscape, press play, and leave it running.

**<https://cameronbrooks11.github.io/longquiet/>**

- Real recordings only, each credited in the app with its source and licence
- Continuous looping, gentle fades, lock-screen controls where the browser supports them
- No accounts, ads, tracking, or backend

## Sounds

| Soundscape | Recording                                                                                                                 | By               | Licence                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| Rain       | [Rainstorm 10 min](https://freesound.org/people/Valerie-Vivegnis/sounds/759545/)                                          | Valerie-Vivegnis | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Forest     | [Afternoon Woods in October - Midwest US (loop)](https://freesound.org/people/NickTayloe/sounds/830253/)                  | NickTayloe       | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Dawn       | [Bird ambience. Coniferous forest dawn chorus.](https://freesound.org/people/SamsterBirdies/sounds/745273/)               | SamsterBirdies   | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Stream     | [Stream flow over the stones in the fields and insect chirping](https://freesound.org/people/lastraindrop/sounds/732848/) | lastraindrop     | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Ocean      | [Baltic Sea II - Zingst/Germany](https://freesound.org/people/pulswelle/sounds/667010/)                                   | pulswelle        | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Night      | [Serrinha do Alambari night frogs chorus with close crickets](https://freesound.org/people/MeliaRoger/sounds/645706/)     | MeliaRoger       | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The audio is built from the uploaded originals by
[`scripts/build-sounds.sh`](scripts/build-sounds.sh) and published as
versioned GitHub release assets, not kept in git: an excerpt where a
recording is long, a crossfaded loop point, and a static gain to −26 LUFS
so switching sounds doesn't jump in volume.
[`sounds/sounds.json`](sounds/sounds.json) is the authoritative list; it
pins each original by checksum, holds the processing recipe, and drives the
in-app credits, and records the sha256 of every built file.
[`sounds/README.md`](sounds/README.md) explains how sounds are chosen,
built and published.

## Development

Needs Node (version in `.nvmrc`) and [just](https://github.com/casey/just).

```sh
just setup        # install dependencies
just fetch-audio  # download the audio release into public/audio/ (once)
just run          # dev server at http://localhost:5173/longquiet/
just check        # format check, lint, typecheck
just test         # unit tests
just build        # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Licence

Code: [MIT](LICENSE). Recordings: the licence listed for each above.
