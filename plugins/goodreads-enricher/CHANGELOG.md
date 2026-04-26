# Changelog — Goodreads Enricher

All notable changes to this plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-04-26

### Bug Fixes
- Preserve paragraph breaks in Goodreads descriptions (#28)


## [0.6.0] - 2026-04-23

### Features
- Support exact Goodreads lookups via query URLs, IDs, ISBNs, and ASINs (#27)


## [0.5.1] - 2026-04-21

### Bug Fixes
- Stop dropping subtitle variants from enricher search results (#25)


## [0.5.0] - 2026-04-21

### Other
- Bump Shisho to 0.0.32, polish metadata, rework logos (#24)


## [0.4.0] - 2026-04-14

### Bug Fixes
- Use bookTitleBare in goodreads autocomplete fallback (#23)


## [0.3.3] - 2026-04-12

### Other
- Use shared stripHTML in goodreads-enricher (#18)


## [0.3.2] - 2026-04-12

### Bug Fixes
- Capture last commit in release changelog generation (#15)


## [0.3.1] - 2026-04-07

### Bug Fixes
- Add retry logic for Goodreads HTTP 503 errors (#14)

## [0.3.0] - 2026-04-05

_No plugin code changes in this release._

## [0.2.0] - 2026-04-05

### Bug Fixes
- Handle missing Unreleased header in plugin changelogs during release (#10)

## [0.1.0] - 2026-04-05

### Features
- Goodreads metadata enricher plugin (#4)
- Add minShishoVersion to release process and enrich plugin metadata (#5)

### Other
- Migrate from Yarn to pnpm workspaces (#7)
