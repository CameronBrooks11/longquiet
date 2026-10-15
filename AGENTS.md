# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project

longquiet is a single-page web app for long, quiet listening: real field
recordings on a loop (Nature) and openly licensed music as playlists
(Music: piano and guitar), with a sleep timer. It is static, has no backend or
tracking, and is deployed to GitHub Pages at
`https://cameronbrooks11.github.io/longquiet/`. Open work is in the issue
tracker; the epic is #2.

## Stack

- **TypeScript**, no framework, built with **Vite**; Node version in `.nvmrc`, npm
- **Tooling** — Prettier, ESLint (typescript-eslint), `tsc --noEmit`, Vitest

## Layout

```
index.html            # page markup; Vite entry
src/catalogue.ts      # typed view of sounds.json; generates credit text
src/player.ts         # <audio> playback: loops hand over between two elements, fades, Media Session
src/preferences.ts    # localStorage persistence, validated on load
src/sleep.ts          # sleep timer: wall-clock deadline, counts only while playing
src/keys.ts           # arrow-key navigation of the choices
src/main.ts           # UI wiring; credits rendered from the catalogue
src/*.test.ts         # Vitest
e2e/app.e2e.ts        # Playwright smoke tests (playwright.config.ts)
sounds/sounds.json    # every recording: attribution, pinned original, recipe
sounds/README.md      # what qualifies and how to add a sound
sounds/.cache/        # originals, downloaded by hand; gitignored
scripts/build-sounds.sh  # build: originals -> public/audio/; check: measure it
scripts/fetch-audio.sh   # download the audio release into public/audio/
scripts/publish-audio.sh # upload public/audio/ as a new release
scripts/check-release.sh # check the named release holds every recorded file
public/audio/         # built recordings, gitignored; from the audio release
.github/workflows/    # ci.yml (PR gate, `ok` job), deploy.yml (Pages on push to main)
```

## Commands

```sh
just setup        # npm ci
just fmt          # prettier --write
just lint         # eslint
just check        # fmt-check + lint + typecheck (CI-equivalent)
just test         # vitest run
just e2e          # Playwright smoke tests of dist/, Chromium/Firefox/WebKit (CI)
just run          # dev server
just build        # production build into dist/
just preview      # build, then serve dist/ locally
just fetch-audio  # download the audio release into public/audio/
just sounds       # render public/audio/ from sounds/.cache (needs ffmpeg, jq)
just publish-audio audio-YYYY.MM.DD  # upload built audio as a release (gh)
just check-release  # the named release holds every recorded file (gh)
just audio-check  # measure public/audio/ against the loudness and seam limits
just audio-seam <id>  # write a loop's seam, as played, to sounds/.cache/
```

## Conventions

- Every recording is an entry in `sounds/sounds.json`; follow
  `sounds/README.md` to add one. Never hand-write processing notes or
  attribution elsewhere; the credits are generated from that file.
- Never commit originals (`sounds/.cache/`) or built audio
  (`public/audio/`); built audio ships as a GitHub release named in
  `sounds.json`. Keep the live site under Pages' 1 GB.
- Only recordings whose licence allows self-hosted redistribution: CC0, public
  domain, CC BY, CC BY-SA. No NC/ND licences, no AI-generated audio, no BBC
  Sound Effects. For music the composition must be free too. Check the licence
  on the recording's own page (on Commons, the file page's template, not the
  API summary), not in a search result.
- Playback stays on plain `HTMLAudioElement`s: they are what keeps playing on
  a locked phone. A loop never restarts an element (iOS goes briefly silent
  there); its copies hand over between two elements (#34). iOS ignores
  `audio.volume`, so nothing may depend on it.
- Asset paths go through `import.meta.env.BASE_URL`; the site lives under
  `/longquiet/`.

## Constraints

- Do not add a backend, analytics, or third-party requests at runtime.
- Do not add dependencies without justification.
- Do not commit secrets or credentials.
- Do not add AI attribution to commits or PR descriptions — no co-author
  trailers, session links, or "generated with" footers.
- Do not let a check report success when it could not run.
