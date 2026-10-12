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
