# Contributing to AirWise

## Setup
```bash
npm install
cp .env.example .env      # optional: ANTHROPIC_API_KEY (or GEMINI_API_KEY)
npm run dev               # http://localhost:8080, restarts on change
```

## Quality gate
Run before every commit. CI runs the same steps.
```bash
npm run check             # lint → format check → strict type check → tests + coverage → browser/axe tests
```
Browser tests need Chromium once: `npx playwright install chromium`.

## Conventions
- **Architecture:** read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.
  Business rules belong in `src/services/engine/` (pure functions, no I/O).
  Routes only validate input, call services and shape responses.
- **Types:** every function has JSDoc. Code must pass `npm run typecheck`
  (TypeScript `checkJs`, `strict`). Shared shapes live in `src/types.js`,
  `src/services/engine/shared.js` and `public/js/types.js`.
- **Style:** Prettier (120 columns) and ESLint enforce formatting, complexity ≤ 15,
  nesting depth ≤ 4 and at most 5 parameters. Prefer small named functions and
  named constants over magic numbers.
- **Security:**
  - Never render with `innerHTML`.
  - Never add inline scripts or styles (the CSP forbids them).
  - Validate all input against an allow-list in `src/utils/validation.js`.
  - Never log prompts or API keys.
- **Tests:** every behaviour change comes with a test. When you add a
  recommendation, add an engine test that checks its priority and its
  quantified impact.

## Adding a recommendation
1. Add the factor, if one is needed, to `src/data/factors.js` (cite the source in the README "Assumptions" section).
2. Add a builder in the matching engine module, returning a typed `Recommendation`.
3. Add tests in `tests/recommendationEngine.test.js`.
4. Run `npm run check`.
