# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

longquiet is a single-page web app for listening to real field recordings
(rain, forest, stream, night) on a loop for hours. It is static, has no
backend or tracking, and is deployed to GitHub Pages at
`https://cameronbrooks11.github.io/longquiet/`. Planned next: a binaural-beat
layer and sleep timer, then an installable offline PWA.

## Stack

- **TypeScript**, no framework, built with **Vite**; Node version in `.nvmrc`, npm
- **Tooling** — Prettier, ESLint (typescript-eslint), `tsc --noEmit`, Vitest

## Layout

```
index.html            # page markup; Vite entry
src/catalogue.ts      # typed view of sounds.json; generates credit text
src/player.ts         # one looping <audio> element, fades, Media Session
src/preferences.ts    # localStorage persistence, validated on load
src/main.ts           # UI wiring; credits rendered from the catalogue
src/*.test.ts         # Vitest
sounds/sounds.json    # every recording: attribution, pinned original, recipe
sounds/README.md      # what qualifies and how to add a sound
sounds/.cache/        # originals, downloaded by hand; gitignored
scripts/build-sounds.sh  # build: originals -> public/audio/; check: measure it
public/audio/         # built recordings, named <id>.mp3, committed
.github/workflows/    # ci.yml (PR gate, `ok` job), deploy.yml (Pages on push to main)
```

## Commands

```sh
just setup        # npm ci
just fmt          # prettier --write
just lint         # eslint
just check        # fmt-check + lint + typecheck (CI-equivalent)
just test         # vitest run
just run          # dev server
just build        # production build into dist/
just preview      # build, then serve dist/ locally
just sounds       # render public/audio/ from sounds/.cache (needs ffmpeg, jq)
just audio-check  # measure public/audio/ against the loudness and seam limits
```

## Conventions

- Every recording is an entry in `sounds/sounds.json`; follow
  `sounds/README.md` to add one. Never hand-write processing notes or
  attribution elsewhere; the credits are generated from that file.
- Never commit originals (`sounds/.cache/`). Keep `public/audio/` under
  150 MB; re-render only when a recipe or original changes.
- Only recordings whose licence allows self-hosted redistribution: CC0, CC BY,
  public domain. No NC/ND licences, no AI-generated audio, no BBC Sound Effects.
  Check the licence on the recording's own page, not in a search result.
- Playback stays on a plain `HTMLAudioElement`: it is what keeps playing on a
  locked phone. iOS ignores `audio.volume`, so nothing may depend on it.
- Asset paths go through `import.meta.env.BASE_URL`; the site lives under
  `/longquiet/`.

## Constraints

- Do not add a backend, analytics, or third-party requests at runtime.
- Do not add dependencies without justification.
- Do not commit secrets or credentials.
- Do not add AI attribution to commits or PR descriptions — no co-author
  trailers, session links, or "generated with" footers.
- Do not let a check report success when it could not run.
