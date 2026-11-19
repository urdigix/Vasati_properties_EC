// Bounded local-only HTTP load test. Requests are not equivalent to visitors.
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const base = new URL(process.env.LOAD_TEST_URL || 'http://127.0.0.1:3000');
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Load tests are restricted to local HTTP servers.');
  const total = Number(process.env.LOAD_TEST_REQUESTS || 10000);
  const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 100);
  if (!Number.isInteger(total) || total < 1 || total > 100000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500) throw new Error('Use 1–100000 requests and 1–500 concurrent connections.');
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const request = route => new Promise(resolve => {
    const start = performance.now();
    const req = http.get(new URL(route, base), { agent, headers: { 'Accept-Encoding': 'gzip' } }, res => {
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - start, bytes, cache: res.headers['x-public-cache'] }));
      res.on('error', () => resolve({ status: 0, ms: performance.now() - start, bytes }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, ms: performance.now() - start, bytes: 0 }));
  });
  const properties = await fetch(new URL('/api/properties', base)).then(r => r.json());
  const id = properties.data?.[0]?.id;
  const routes = ['/', '/api/properties', '/api/settings', '/api/featured-projects', '/property-overview.js'];
  if (id) routes.push(`/api/properties/${encodeURIComponent(id)}`);
  for (const route of routes) await request(route);
  const timings = [], statuses = {};
  let cursor = 0, bytes = 0, hits = 0;
  const start = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(total, concurrency) }, async () => {
      while (cursor < total) {
        const index = cursor++;
        const result = await request(routes[index % routes.length]);
        timings.push(result.ms); bytes += result.bytes;
        if (result.cache === 'HIT') hits++;
        statuses[result.status] = (statuses[result.status] || 0) + 1;
      }
    }));
  } finally { agent.destroy(); }
  const seconds = (performance.now() - start) / 1000;
  timings.sort((a, b) => a - b);
  const percentile = p => +timings[Math.min(timings.length - 1, Math.ceil(p * timings.length) - 1)].toFixed(2);
  const errors = Object.entries(statuses).filter(([status]) => Number(status) < 200 || Number(status) >= 400).reduce((n, [, count]) => n + count, 0);
  const result = { timestamp: new Date().toISOString(), node: process.version, target: base.origin, requests: total, concurrency, routes, seconds: +seconds.toFixed(2), requestsPerSecond: +(total / seconds).toFixed(1), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), errors, statuses, wireBytes: bytes, cacheHits: hits };
  if (process.env.LOAD_TEST_OUTPUT) {
    fs.mkdirSync(path.dirname(path.resolve(process.env.LOAD_TEST_OUTPUT)), { recursive: true });
    fs.writeFileSync(process.env.LOAD_TEST_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
  if (errors || result.p95Ms > Number(process.env.LOAD_TEST_P95_MS || 1000)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
