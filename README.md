# AirWise: a clean-air coach for smog season 🌫️

AirWise is a GenAI-powered assistant for families and communities living through severe winter smog and urban air pollution. You enter your city and a short household profile. AirWise then:

- fetches **live air quality and today's hourly PM2.5 forecast** for that place,
- works out a **personal risk level** for the household,
- builds a **low-emission daily routine** that tells you when to ventilate, when to exercise and when to mask up,
- suggests **indoor air-quality hacks** that fit what you already own,
- recommends **sustainable alternatives** (commute, heating, cooking, community action),
- and **puts a number on the impact** of each choice: how much exposure drops (%), how much CO₂ is avoided (kg/week) and how much exhaust PM2.5 is avoided (g/week).

It also produces a **shareable community alert** with no personal details. You can forward it to a building, school or neighbourhood group, so one family's plan protects the people around them.

Claude writes a short briefing from these results, lists the household's top three actions and answers the user's own question in plain language.

---

## How it maps to the evaluation criteria

| Criterion | What we did | Where |
|---|---|---|
| **Problem statement alignment** | <ul><li>Live, location-specific AQI and hourly forecast.</li><li>Advice adjusted to the household's lifestyle: sensitive members, commute, heating, cooking, purifier, exercise.</li><li>Low-emission routine, indoor hacks and sustainable swaps, each with a **quantified impact** (exposure %, CO₂ kg/week, PM2.5 g/week).</li><li>A community alert for families *and communities*.</li><li>GenAI briefing and Q&A.</li></ul> | `recommendationEngine.js`, `assistant.js` |
| **Code quality** | <ul><li>Layered design: routes, services, a pure rule engine and reference data.</li><li>Dependency injection, so the app is testable offline.</li><li>JSDoc on public functions; ESLint (flat config) enforced in CI.</li><li>Small, single-purpose modules.</li></ul> | `src/`, `eslint.config.js` |
| **Security** | <ul><li>Allow-list validation.</li><li>Strict CSP and Permissions-Policy via helmet.</li><li>Per-IP rate limits, tighter on the LLM-backed endpoint.</li><li>Prompt-injection fencing and a schema-validated LLM output.</li><li>The API key stays on the server.</li><li>Non-root container and `npm audit` in CI.</li></ul> | `SECURITY.md`, `app.js`, `validation.js` |
| **Efficiency** | <ul><li>TTL + LRU caches for geocoding (24 h), air quality (15 min, ~1 km grid) and LLM output (15 min).</li><li>In-flight request de-duplication.</li><li>gzip compression; 6 s upstream timeouts.</li><li>Low-effort LLM call, since it only narrates facts that are already computed.</li><li>No front-end framework (≈10 kB of JS); 5 runtime dependencies.</li></ul> | `cache.js`, `airQuality.js`, `assistant.js` |
| **Testing** | <ul><li>**56 unit/API tests** (~98% line coverage), fully offline.</li><li>**7 browser E2E tests** covering the full flow, keyboard-only use, clipboard, a 320 px layout and the error path.</li><li>All run in CI.</li></ul> | `tests/`, `.github/workflows/ci.yml` |
| **Accessibility** | <ul><li>**Automated axe-core WCAG 2.1 AA scan with zero violations** on the form and on the results page, in light and dark mode.</li><li>Labelled controls, skip link, live region, focus management.</li><li>Colour plus text for severity; 44 px targets; reduced motion; works at 320 px.</li></ul> | `public/`, `tests/e2e/ui.e2e.js` |

---

## Chosen vertical

**Persona:** a family or community member in a smog-affected city, such as a parent in Delhi, Lahore, Dhaka or Kraków. They have to make everyday decisions: *Can my child play outside? Should I open the windows? Is my commute making things worse?*

**Logic focus:** decisions that depend on context. The same AQI leads to different advice for a household with an asthmatic grandparent and a coal heater than for a healthy couple who work from home.

---

## Approach and logic

AirWise uses a **"rules decide, AI explains"** architecture:

```
Browser (accessible form)
   │  POST /api/plan  (validated, allow-listed profile)
   ▼
Express API ──► Air-quality service ──► Open-Meteo geocoding + air-quality (CAMS)
   │                (TTL cache, 6 s timeout, cleanest-window analysis)
   ▼
Recommendation engine (deterministic, unit-tested)
   │  risk • routine • indoor hacks • alternatives • quantified impact
   ▼
GenAI assistant (Claude, structured JSON output, grounded on engine facts)
   │  briefing • top 3 actions • answer to user question
   │  └─ falls back to a rule-based template if the API is missing or fails
   ▼
JSON response ──► rendered with DOM APIs only (no innerHTML)
```

### Why split it this way?
| Concern | Rule engine | LLM |
|---|---|---|
| Health thresholds and numbers | ✅ deterministic, testable, auditable | ❌ could hallucinate |
| Empathetic, readable explanation | ❌ rigid | ✅ |
| Free-text questions | ❌ | ✅ |
| Works without network or an API key | ✅ | ❌ |

Every number the user sees comes from the engine. The model is only allowed to use numbers that appear in the plan.

### Decision logic (`src/services/recommendationEngine.js`)
1. **AQI band:** US EPA breakpoints (Good → Hazardous).
2. **Personal risk:**
   - Households with sensitive members (children, people over 65, asthma/COPD/heart conditions, pregnancy) are treated **one band higher**.
   - Solid-fuel heating or cooking adds another level, because indoor combustion raises exposure even on clean days.
   - The 0–100 score also takes outdoor-exercise habits into account.
3. **Routine:**
   - The day is split into morning, daytime, evening and night.
   - Uses the **cleanest 2-hour forecast window** (computed from hourly PM2.5) for ventilation and exercise.
   - Avoids dawn hours, when winter temperature inversions trap smog near the ground.
   - Recommends masks at AQI ≥ 151, or ≥ 101 when sensitive members are present.
   - Exercise moves indoors from the "Unhealthy" level.
   - Warns about carbon monoxide when a coal, wood or kerosene heater is in use.
4. **Indoor hacks:**
   - Households with a purifier get placement and sizing advice: CADR ≈ room volume × 5 air changes per hour.
   - Households without one get a DIY box-fan + MERV-13 filter design.
   - Also covers sealing gaps, timing ventilation by the forecast, wet cleaning and removing incense/mosquito-coil smoke.
   - Includes a myth check on house plants.
5. **Alternatives with impact:**
   - Car → metro/bus: (EF_car − EF_transit) × weekly km.
   - Carpooling: halves per-person emissions.
   - Two-wheeler → transit on bad days.
   - Work from home on days rated "Unhealthy" or worse.
   - Clean heating and cooking fuel swaps.
   - Community actions: no open burning, a neighbourhood alert group.
6. **Community alert:** a short message with no personal details. It covers the AQI, the cleanest and worst hours and group-specific advice, and asks neighbours not to burn waste and to check on elderly people. A copy/share button sends it to group chats.
7. **Impact summary:** total CO₂ avoided per week and per year, plus a tree-equivalent. Mutually exclusive options such as carpool vs. transit are not double-counted.

### GenAI layer (`src/services/assistant.js`)
- **Model:** Claude (`claude-opus-5-5` by default; set `AIRWISE_MODEL` to change it).
- **Structured outputs:** a JSON schema (`output_config.format`) guarantees the shape `{summary, priorities[], answer}`, and the response is validated again on the server.
- **Grounded prompt:** the model receives the engine's plan as JSON and must not invent statistics.
- **Prompt-injection defence:** the user's question goes inside `<user_question>` tags and is labelled as data. Off-topic requests are declined.
- **Efficiency:**
  - Low reasoning effort, because the model only narrates facts that are already computed.
  - Responses are cached for 15 minutes, keyed by a SHA-256 hash of the inputs.
  - The prompt payload is minimal and contains no personal data beyond the city.
- **Resilience:**
  - **Backup API key failover:** if the primary key is rejected (401/403), rate-limited (429), overloaded (5xx) or unreachable, the request is retried once with `ANTHROPIC_API_KEY_BACKUP`. Bad requests (400) are not retried, because they would fail the same way.
  - Server-side model fallback.
  - Timeout and a single retry.
  - On a refusal, error or malformed output, the user still gets a rule-based briefing (`source: "rules"`).

---

## How it works (run it)

Requirements: Node.js 20+ (22 recommended).

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY (+ ANTHROPIC_API_KEY_BACKUP)
npm start                   # http://localhost:8080
```

Without `ANTHROPIC_API_KEY`, AirWise still works fully in **rule-based mode**. If the air-quality API is unreachable, open *"Enter AQI manually"* in the form.

### Quality checks
```bash
npm run lint            # ESLint
npm test                # 56 unit + API tests (node:test, fully offline)
npm run test:coverage   # ~98% line coverage of src/
npm run test:e2e        # browser E2E + axe-core WCAG 2.1 AA scan (needs Chromium: npx playwright install chromium)
npm run check           # all of the above
```
- **Unit and API tests:** validation, the cache, every branch of the decision engine and the community alert. Also air-quality parsing and caching, and the LLM success/caching/fallback paths.
- **HTTP tests:** run end-to-end, covering security headers, gzip, 400/404/413/429/503 handling, the tighter plan rate limit and the manual-AQI flow.
- **Browser tests:** drive the real UI in Chromium.

### Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Turns on AI briefings and Q&A |
| `ANTHROPIC_API_KEY_BACKUP` | No | Failover key, used only if the primary fails |
| `AIRWISE_MODEL` | No | Claude model (default `claude-opus-5-5`) |
| `PORT` | No | HTTP port (default 8080) |
| `AIRWISE_RATE_LIMIT` | No | API requests/min per IP (default 30; `/api/plan` gets a third) |
| `AIRWISE_DISABLE_LLM` | No | `true` forces rule-based mode |

Keys are read only on the server. Never commit `.env` (it is git-ignored); on a cloud host, use its secret manager.

### Docker / Cloud Run
```bash
docker build -t airwise .
docker run -p 8080:8080 -e ANTHROPIC_API_KEY=... airwise
```

### API
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/options` | Allowed enum values |
| `GET` | `/api/air?city=Delhi` | Live AQI, pollutants, cleanest window |
| `POST` | `/api/plan` | Full personalised plan + narrative |

---

## Security
- **Input:** allow-list validation for every field (enums, numeric ranges, a Unicode-aware city pattern, 500-character question limit). Unknown fields are dropped.
- **Headers:** `helmet` with a strict **Content-Security-Policy** (`'self'` only, no inline scripts or styles), `frame-ancestors 'none'`, `nosniff`; `x-powered-by` is disabled.
- **Abuse limits:** a 10 kB JSON body limit, plus **rate limiting** on `/api` (30 requests/min per IP by default). The LLM-backed `/api/plan` gets a third of that, to cap cost.
- **Browser features:** a `Permissions-Policy` header disables camera, microphone, geolocation, payment and USB.
- **XSS:** the front end renders with `textContent` and DOM APIs only, so model output cannot inject HTML.
- **Secrets and errors:** the API key stays on the server and is read from the environment. Errors are centralised and only safe messages reach clients. Logs never include prompts or keys.
- **Container:** non-root user with a health check, production-only dependencies.
- **Supply chain:** CI runs `npm audit` on every push. See [SECURITY.md](SECURITY.md).

## Accessibility
- Semantic landmarks, a skip link, a `<label>` for every control and `fieldset`/`legend` groups.
- Results sit in an `aria-live` region with `aria-busy`. Focus moves to the results heading, and errors use `role="alert"` and `aria-invalid`.
- AQI severity is shown **as text as well as colour**. Visible focus rings, 44 px touch targets.
- Supports `prefers-color-scheme` (dark mode) and `prefers-reduced-motion`. Readable at 200% zoom with a responsive grid.
- **Verified automatically:** an axe-core WCAG 2.1 AA scan (zero violations in light and dark mode), keyboard-only navigation and a 320 px viewport are all tested in CI.

## Project structure
```
src/
  server.js                 # entry point, graceful shutdown
  app.js                    # Express app factory (dependency-injected)
  config.js                 # env-driven config
  data/factors.js           # AQI bands, emission & exposure factors
  services/
    airQuality.js           # Open-Meteo client + forecast analysis
    recommendationEngine.js # decision logic
    assistant.js            # Claude narrative + fallback
  utils/                    # validation, TTL cache, errors
public/                     # accessible vanilla-JS front end
tests/                      # node:test unit + API suites
tests/e2e/                  # Playwright + axe-core browser tests
```

## Assumptions
- **AQI scale:** AirWise uses the **US EPA AQI** reported by Open-Meteo (Copernicus CAMS model data). Local scales such as India's NAQI differ slightly. CAMS readings are modelled at roughly 10–40 km resolution, so they are not a street-level sensor reading.
- **Emission factors** (CO₂ per passenger-km): petrol car 0.17 kg, diesel car 0.16 kg, two-wheeler 0.06 kg, bus/metro 0.03 kg. Exhaust PM2.5 factors are rounded published averages. Commutes are assumed to be **2 trips/day × 5 days/week**, and the distance entered is one-way.
- **Heating:** weekly CO₂ for heating types is an indicative winter average for a single room.
- **Exposure reductions:** given as **ranges** drawn from published studies (HEPA/DIY filters in closed rooms, clean-cooking interventions). Real results depend on room size, sealing and behaviour.
- **Tree equivalent:** about 22 kg CO₂ absorbed per mature tree per year.
- **Community alert:** it deliberately omits household details (health conditions, fuels, commute), so it is safe to share publicly.
- **Not medical advice:** the app gives general guidance, and the AI is instructed to send symptom questions to a doctor.
- **Sensitive members:** a household that reports any of them is treated conservatively.
