# Project task runner

set dotenv-load := false

# Default: show available recipes
default:
    @just --list

# Install dependencies
setup:
    npm ci

# Format code (mutates working tree — use locally)
fmt:
    git ls-files -z | xargs -0 npm exec -- prettier --ignore-unknown --write

# Verify formatting of tracked files (non-mutating — use in CI)
fmt-check:
    git ls-files -z | xargs -0 npm exec -- prettier --ignore-unknown --check

# Run linters
lint:
    npm exec -- eslint .

# Type-check without emitting
typecheck:
    npm exec -- tsc --noEmit

# Format + lint + type-check (non-mutating — safe for CI)
check: fmt-check lint typecheck

# Run tests
test:
    npm exec -- vitest run

# Render public/audio/ from the originals in sounds/.cache, record, check
sounds:
    scripts/build-sounds.sh build
    npm exec -- prettier --write sounds/sounds.json

# Download the audio release named in sounds/sounds.json into public/audio/
fetch-audio:
    scripts/fetch-audio.sh

# Publish public/audio/ as a new audio release, then name it in sounds.json
publish-audio tag:
    scripts/publish-audio.sh {{tag}}
    npm exec -- prettier --write sounds/sounds.json

# Check the named audio release holds every recorded file (needs gh)
check-release:
    scripts/check-release.sh

# Check loudness, true peak and loop seam of every file in public/audio/
audio-check:
    scripts/build-sounds.sh check

# Write sounds/.cache/<id>.seam.wav, a loop's seam as the player overlaps it
audio-seam id:
    scripts/build-sounds.sh seam {{id}}

# Browser smoke tests of the built site (CI; needs fetch-audio, build, browsers)
e2e:
    npm exec -- playwright test
    npm exec -- playwright test --project=webkit -g "hands a loop over" --repeat-each=20

# Dev server
run:
    npm run dev

# Production build into dist/
build:
    npm run build

# Serve the production build locally
preview: build
    npm run preview

# Remove build artifacts
clean:
    rm -rf dist
