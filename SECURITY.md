# Security policy

## Reporting a vulnerability
Please report it privately through GitHub's **Security → Report a vulnerability** tab on this repository, not in a public issue. You should get a response within 7 days.

## Security design summary
| Threat | Mitigation |
|---|---|
| Injection / malformed input | Allow-list validation of every field (enums, numeric ranges, Unicode city pattern, length caps); unknown fields dropped; 10 kB body limit |
| XSS | Strict CSP (`'self'` only, no inline script/style); front end renders with `textContent` only |
| Prompt injection | User text fenced in `<user_question>` and declared as data; model sees only engine facts; JSON-schema output validated server-side |
| Secret leakage | `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_BACKUP` read from env on the server only; `.env` git-ignored; logs never contain prompts or keys |
| Abuse / cost blow-up | Per-IP rate limits (tighter on the LLM-backed `/api/plan`); response caching; upstream timeouts |
| Info disclosure | Central error handler returns generic messages; `x-powered-by` disabled |
| Clickjacking / feature abuse | `frame-ancestors 'none'`, `Permissions-Policy` disables camera, mic, geolocation, payment, USB |
| Supply chain | Lockfile + `npm ci`, `npm audit` in CI, 5 runtime dependencies |
| Container | Non-root user, production-only dependencies |
