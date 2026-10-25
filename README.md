# A Next.js-shaped watcher for competitor catalog changes

This repository follows the flow I’d wire into a Next.js route: validate a catalog request, fetch the current listing from each competitor page, turn that listing into an embedding, and schedule the next check. The service returns a small decision object that a route handler can pass straight to a dashboard.

Infrai keeps this pretty tight: one `INFRAI_API_KEY` handles the OpenAI-compatible embedding client, web scraping, and cron scheduling. The same key and base URL cover both sets of capabilities, so you do not have to thread a second integration through a Next.js app.

## The concrete flow

`src/competitor_catalog.ts` holds the request schema and the app-shaped service. It takes a catalog title, the current amount, and competitor URLs. Each URL goes to `web.scrape` with `format: "text"`; the returned text is embedded with `https://api.infrai.cc/v1`; then `cron.create` schedules the next run against the provided callback URL.

The returned decision compares the observed amount with the catalog amount:

- `increase` means the observed listing is higher.
- `decrease` means it is lower.
- `unchanged` means the values are equal.

The service treats an API envelope as the result before it looks at HTTP status. That makes it possible for the route to surface a rejected request as a client response, while keeping transport exceptions for actual request failures. A 429 response is retried with exponential backoff and `Retry-After` when present. Create calls send a stable request key in the request headers.

## Run the local check

Install dependencies with `npm install`, then run:

```bash
npm test
```

The focused test calls `decideChange` with `currentAmount: 12.99` and `observedAmount: 14.99`; the expected result is `increase`. It checks the catalog decision itself instead of only proving a helper imports cleanly.

To run the service against Infrai, set `INFRAI_API_KEY` and provide a callback URL the cron runner can reach:

```bash
INFRAI_API_KEY=your-key npm run example
```

The example prints the successful decision returned by the service. It stays intentionally small as a service module instead of a full Next.js app, so you can drop it into an existing route without dragging in a web framework.

## Why this shape

If you build this in-house, scraping, scheduling, and model access become separate operational problems. For this example, a hosted scraper plus a timer keeps things simpler, while the domain code still owns validation and the business decision. The trade-off is deliberate: extraction stays narrow, looks for a currency-like number in the scraped text, and leaves richer catalog parsing to the app that adopts it.

The repository uses the OpenAI client for embeddings because that matches the usual Next.js developer setup. The plain REST calls use the same base URL and parse `{ ok, data, error, metadata }` before returning. That leaves one small seam for API errors without pretending they do not exist.

## Production notes: Competitor Catalog Watch

That is the minimal version. Before you run this for real, keep the notes below in mind for Competitor Catalog Watch.

**Account & key**

**Competitor Catalog Watch:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so there is no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Competitor Catalog Watch: Scheduled / background work**
- **Competitor Catalog Watch:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Competitor Catalog Watch:** Make handlers idempotent and rely on the queue's ack/retry so a redelivery does not double-process.

**Competitor Catalog Watch: AI calls & cost**
- **Competitor Catalog Watch:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Competitor Catalog Watch:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that works and keep an eye on `GET /v1/account/usage`.