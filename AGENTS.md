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
src/catalogue.ts      # every recording + its attribution (single source of truth)
src/player.ts         # one looping <audio> element, fades, Media Session
src/preferences.ts    # localStorage persistence, validated on load
src/main.ts           # UI wiring; credits rendered from the catalogue
src/*.test.ts         # Vitest
public/audio/         # self-hosted recordings, named <id>.mp3 (built, but committed)
scripts/prepare-audio.sh  # rebuilds public/audio/ from the source previews (ffmpeg)
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
```

## Conventions

- Every recording gets a `soundscapes` entry in `src/catalogue.ts` with title,
  author, source URL, licence and modifications. The tests fail if a file is
  missing or a licence is outside the allowed list.
- Only recordings whose licence allows self-hosted redistribution: CC0, CC BY,
  public domain. No NC/ND licences, no AI-generated audio, no BBC Sound Effects.
  Check the licence on the recording's own page, not in a search result.
- Record any processing (trim, crossfade, re-encode) in `modifications`.
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
