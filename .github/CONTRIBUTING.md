# Contributing to Maestro

Thanks for your interest in contributing! 🎼

## Development setup

```bash
npm install
cp .env.example .env   # fill in your keys
npm run dev             # hot-reload dev server
```

## Before submitting a PR

1. `npm run typecheck` — must pass with zero errors
2. `npm test` — all 25 unit tests must pass
3. `npm run build` — must compile cleanly
4. Keep the light-theme dashboard aesthetic
5. No dark mode (by design)

## Code style

- TypeScript strict mode, ESM (`"type": "module"`)
- Pure functions for testable logic; side effects only in explicitly marked modules
- Every new feature should ship with unit tests in `test/`

## Commit messages

Conventional commits preferred: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.

## Issues

Use the issue templates. Be specific about:
- What you expected
- What happened
- Your Node version and OS
