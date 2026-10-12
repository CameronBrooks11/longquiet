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
| Stream     | [Stream flow over the stones in the fields and insect chirping](https://freesound.org/people/lastraindrop/sounds/732848/) | lastraindrop     | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Night      | [Serrinha do Alambari night frogs chorus with close crickets](https://freesound.org/people/MeliaRoger/sounds/645706/)     | MeliaRoger       | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The files in `public/audio/` are built from Freesound's high-quality MP3
previews of these recordings by [`scripts/prepare-audio.sh`](scripts/prepare-audio.sh):
an excerpt where a recording is long, a crossfaded loop point, and a static
gain to about −26 LUFS so switching sounds doesn't jump in volume.
[`src/catalogue.ts`](src/catalogue.ts) is the authoritative list, records
what was done to each file, and drives the in-app credits.

## Development

Needs Node (version in `.nvmrc`) and [just](https://github.com/casey/just).

```sh
just setup   # install dependencies
just run     # dev server at http://localhost:5173/longquiet/
just check   # format check, lint, typecheck
just test    # unit tests
just build   # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Licence

Code: [MIT](LICENSE). Recordings: the licence listed for each above.
