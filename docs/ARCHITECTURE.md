# AirWise architecture

## Design principle: rules decide, AI explains

Health advice has to be consistent and auditable, so **every number shown to a
user comes from a deterministic, unit-tested rule engine**. The LLM only turns
those facts into a short, empathetic briefing and answers the user's question.
If the AI is slow, misconfigured or down, users still get the complete plan.

## Request flow

```
Browser (public/js, ES modules)
  │ 1. POST /api/plan        ── instant: full plan + rule-based briefing
  │ 2. POST /api/narrative   ── AI briefing, upgrades the coach card in place
  ▼
Express 5 app (src/app.js)
  ├─ middleware/security.js     helmet + strict CSP, Permissions-Policy,
  │                             rate limits, CSRF guard, JSON-only POSTs
  ├─ routes/api.js              validate → air quality → engine → (AI)
  └─ middleware/errorHandler.js only AppError messages reach clients
        │
        ├─ utils/validation.js        allow-list validation (no unknown fields)
        ├─ services/airQuality.js     Open-Meteo geocoding + CAMS readings,
        │                             cached, 6 s timeouts, cleanest-window analysis
        ├─ services/engine/           pure functions, one concern per module
        └─ services/ai/               grounded narration with a time budget
```

## Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `config.js` | Env/`.env` loading (BOM-safe), defaults, provider selection | — |
| `middleware/security.js` | Headers, CSP, rate limits, CSRF and content-type guards | `utils/errors` |
| `routes/api.js` | HTTP contract; no business logic | validation, airQuality, engine, ai |
| `services/airQuality.js` | Upstream data + caching + forecast insights | `utils/cache` |
| `services/engine/risk.js` | AQI band, household-adjusted risk, headline | `data/factors` |
| `services/engine/routine.js` | Morning → night routine (forecast-aware) | `data/factors` |
| `services/engine/indoorHacks.js` | Indoor air actions | `data/factors` |
| `services/engine/alternatives.js` | Sustainable swaps with quantified impact | `engine/impact` |
| `services/engine/impact.js` | Weekly/annual CO₂ totals | `data/factors` |
| `services/engine/communityAlert.js` | Shareable message without personal data | — |
| `services/ai/assistant.js` | Cache, 12 s budget, key failover, rule fallback | `ai/*` |
| `services/ai/prompt.js` | System prompt, output schema, PII-free payload | — |
| `services/ai/providers/*` | Claude and Gemini adapters behind one interface | vendor SDKs (lazy) |
| `data/factors.js` | Reference values (AQI bands, emission factors) | — |

## Key decisions

| Decision | Why |
|---|---|
| Rule engine computes, LLM narrates | No invented health numbers; testable; works without AI |
| Two endpoints (`/plan`, `/narrative`) | The plan renders in milliseconds; AI latency never blocks the user |
| AI time budget + background caching | A slow model degrades to rules now and is instant on the next request |
| Provider adapters with one interface | Swap or fail over vendors (Claude ↔ Gemini) without touching callers |
| Dependency injection in `createApp` | The whole API and UI run in tests with fakes, fully offline |
| No front-end framework, native ES modules | ~10 kB of JS, no build step, strict CSP (`script-src 'self'`) |
| JSDoc + TypeScript `checkJs` (strict) | Type safety without a compile step; contracts documented in place |

## Error handling

- `AppError` carries a user-safe message and HTTP status. Everything else
  becomes a generic `500`, and the details are logged server-side only.
- AI errors are classified (`services/ai/errors.js`): key problems → backup
  key; retired/busy model → next model; refusals → rule-based briefing.
  Logged messages mask anything that looks like an API key.

## Testing strategy

| Layer | Tooling | What it proves |
|---|---|---|
| Unit | `node:test` | Every engine branch, validation, cache, AI failover/time budget, providers |
| API | `node:test` + real HTTP server | Status codes, security headers, CSRF guard, rate limits, gzip |
| Browser | Playwright + axe-core | Full flow, progressive AI loading, keyboard-only, 320 px, WCAG 2.1 AA |
| Regression | Golden-master snapshot (6,912 cases) | Refactors don't change advice |
