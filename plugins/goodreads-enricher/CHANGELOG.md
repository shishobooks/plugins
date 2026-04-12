# Changelog — Goodreads Enricher

All notable changes to this plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
