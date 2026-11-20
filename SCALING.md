# Traffic capacity and growth

Anonymous catalogue HTML and JSON now use a process cache with a 15-second TTL, bounded to 128 responses and 32 MiB including compressed copies. Gzip representations are generated once per entry. Catalogue/settings edits and MCP mutations invalidate the cache. Changes made directly to SQLite or by another process appear after expiry. Browser catalogue responses revalidate with ETags.

Admin pages, sessions, customer requests, protected media and brochure links are excluded. Responses setting cookies or explicitly opting out with `private`/`no-store` are also excluded. Health checks always query SQLite.

SQLite uses WAL with FULL durability and indexes for published listing order, price and analytics queries. Keep one backend instance and a persistent local database volume. Do not put SQLite on network storage or add independent backend replicas. Use consistent snapshots (`VACUUM INTO` or SQLite's backup API) while running: copying only the `.db` file can omit active WAL changes. Back up uploaded media separately and test restoration.

The Coolify frontend serves bundled CSS, JavaScript and images through Nginx with compression and browser revalidation. Express gives uniquely named uploaded images a seven-day cache; upload a new file rather than overwriting one. Stable bundled images served directly by Express have a one-day cache. Brochure files stream from disk after checking single-use session-bound links. Property detail pages skip requests for the hidden homepage catalogue and featured projects. Secondary hero images load lazily, and changing search filters cancels obsolete requests.

Public JSON/form bodies are limited to 256 KiB. Authenticated media upload POSTs retain a 50 MiB JSON envelope limit and existing decoded-file limits. Keep-alive connections and graceful termination allow requests to finish during restarts; Compose grants 15 seconds before forcing shutdown.

## Repeatable local capacity check

Start the app, then run `npm run test:load` separately from builds and other tests. It sends 10,000 read requests through 100 concurrent keep-alive connections across the homepage, catalogue, a property, settings, featured projects and a JavaScript asset. It accepts only local HTTP targets, bounds concurrency to 500, times out requests and fails on HTTP/network errors or p95 latency above 1,000 ms.

```powershell
$env:LOAD_TEST_URL = 'http://127.0.0.1:3000'
$env:LOAD_TEST_REQUESTS = '10000'
$env:LOAD_TEST_CONCURRENCY = '100'
$env:LOAD_TEST_OUTPUT = '.gstack/benchmark-reports/growth-check.json'
npm run test:load
```

Optional `LOAD_TEST_P95_MS` changes the latency gate. Reports record runtime, target, request mix, throughput, p50/p95/p99 latency, transfer bytes, errors and cache hits. The runner is named `load-check.cjs` so Node's normal test discovery does not execute traffic tests during `npm test`.

## Measurements on 19 November 2026

Local Windows checkout, Node v22.23.4, six seeded published properties; client and server share a computer. Each measured run sent 10,000 requests at concurrency 100 after warming six routes. The baseline predates these changes. A preliminary after-run contended with builds/tests and was excluded; the final after-run ran separately.

| Metric | Before | After |
| --- | ---: | ---: |
| Successful requests | 10,000 | 10,000 |
| Errors | 0 | 0 |
| Throughput | 500.1 requests/s | 940.7 requests/s |
| p50 response latency | 172.11 ms | 61.00 ms |
| p95 response latency | 351.21 ms | 337.77 ms |
| p99 response latency | 474.18 ms | 450.74 ms |
| Response body bytes transferred | 255,756,351 | 64,996,303 |

These are HTTP read-capacity measurements, not 10,000 simultaneous people or end-to-end mobile browsing. The fixture is small. Tests exclude lead writes, real image downloads, TLS, WAN latency, production VPS and Nginx. Docker is unavailable locally, so container validation remains outstanding; the frontend Dockerfile now runs `nginx -t` during build.

## Production acceptance and further growth

Catalogue lists use bounded, indexed pagination rather than returning every property's full details. Server-rendered homepage HTML includes the first 24 listings. The sitemap includes every published property using a lightweight ID/title query.

Run `npm run test:catalogue` for an isolated temporary catalogue check; it does not write to the project database. On 20 November 2026, the 10,007-property fixture served 1,000 requests at concurrency 25 in 5.44 seconds, with p95 latency 176.02 ms, maximum response size 18,024 bytes and zero errors. Full-catalogue search also passed. These local API measurements do not establish simultaneous visitor capacity.

Deploy through the normal reviewed release process with database/media backups. Test a staging deployment on equivalent infrastructure using realistic catalogue size and images, browsing sessions with think time, consented analytics, form submissions and brochure downloads. Measure p95 page/API latency, errors, CPU, memory, disk latency and database write waits as traffic increases. Record the highest sustained traffic meeting agreed targets before claiming visitor capacity.

For larger spikes, public assets can move behind a CDN with versioned URLs or explicit invalidation. Bypass shared edge caching for admin, personal data, forms, session configuration and downloads. Keep catalogue HTML revalidating until edge invalidation exists. If sustained writes or backend replicas become necessary, first migrate data/sessions to a shared database, uploads to object storage, and rate limits/cache invalidation to shared infrastructure. That migration needs production-sized tests; increasing replica count alone is insufficient.
