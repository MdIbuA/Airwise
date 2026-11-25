# Changelog

## 1.2.0 — code quality and security
- Rule engine split into focused modules (`risk`, `routine`, `indoorHacks`,
  `alternatives`, `impact`, `communityAlert`). Outputs verified byte-identical
  across 6,912 golden-master cases.
- AI layer reorganised into `services/ai/` (assistant, prompt, fallback
  narrative, error classification, Claude and Gemini providers).
- Front end split into typed native ES modules.
- Strict static type checking (TypeScript `checkJs`, `strict`) for server and
  browser code; full JSDoc coverage; Prettier, `.editorconfig`, stricter ESLint.
- Express 5; routes, security middleware and error handler in separate modules.
- CSRF protection (JSON-only POSTs, cross-site requests rejected); CSP adds
  `base-uri` and `form-action`.

## 1.1.0 — speed and resilience
- Instant plan via `/api/plan`. The AI briefing loads progressively from
  `/api/narrative` within a 12 s budget and is cached in the background.
- Claude (default) and Gemini providers, with backup-key failover and Gemini model fallback.
- `npm run check:ai` diagnostics; `.env` loader is safe for files saved by Windows Notepad.
- Redesigned UI: AQI gauge, cleanest-window strip, impact tiles, community alert.

## 1.0.0 — first release
- Rule engine, Open-Meteo air quality, accessible UI, security headers, tests and CI.
