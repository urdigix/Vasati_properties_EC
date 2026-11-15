const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Ga4AnalyticsClient } = require('../server/ga4-analytics');

const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  GA4_PROPERTY_ID: '123456789',
  GA4_SERVICE_ACCOUNT_EMAIL: 'ga4-reader@example.test',
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function report(dimensions, metrics, rows) {
  return {
    dimensionHeaders: dimensions.map(name => ({ name })),
    metricHeaders: metrics.map(name => ({ name, type: 'TYPE_INTEGER' })),
    rows: rows.map(([dimensionValues, metricValues]) => ({
      dimensionValues: dimensionValues.map(value => ({ value })),
      metricValues: metricValues.map(value => ({ value: String(value) }))
    }))
  };
}

function createAnalyticsFetch({ failReports = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return jsonResponse({ access_token: 'test-access-token', expires_in: 3600 });
    }
    if (failReports) return jsonResponse({ error: { message: 'permission denied' } }, 403);

    const body = JSON.parse(options.body);
    if (String(url).endsWith(':runRealtimeReport')) {
      return jsonResponse(report([], ['activeUsers'], [[[], [3]]]));
    }
    const dimension = body.dimensions?.[0]?.name;
    if (!dimension) {
      return jsonResponse(report([], ['activeUsers', 'sessions', 'screenPageViews'], [[[], [12, 24, 36]]]));
    }
    if (dimension === 'pagePath') return jsonResponse(report([dimension], ['screenPageViews'], [[['/homes'], [18]]]));
    if (dimension === 'sessionDefaultChannelGroup') return jsonResponse(report([dimension], ['sessions'], [[['Organic Search'], [14]]]));
    if (dimension === 'deviceCategory') return jsonResponse(report([dimension], ['sessions'], [[['mobile'], [16]]]));
    if (dimension === 'country') return jsonResponse(report([dimension], ['sessions'], [[['India'], [20]]]));
    return jsonResponse(report([dimension], [body.metrics[0].name], []));
  };
  return { calls, fetchImpl };
}

test('GA4 dashboard uses realtime and historical reports, adds approximate map markers, and caches results', async () => {
  let now = 1_800_000_000_000;
  const { calls, fetchImpl } = createAnalyticsFetch();
  const client = new Ga4AnalyticsClient({ env, fetchImpl, now: () => now });
  const result = await client.getDashboard({ range: '30d' });

  assert.equal(result.status, 'ready');
  assert.equal(result.rangeLabel, 'Last 30 days');
  assert.equal(result.realtime.activeUsers, 3);
  assert.deepEqual(result.historical, { activeUsers: 12, sessions: 24, pageViews: 36 });
  assert.deepEqual(result.topPages, [{ name: '/homes', value: 18 }]);
  assert.deepEqual(result.trafficSources, [{ name: 'Organic Search', value: 14 }]);
  assert.deepEqual(result.devices, [{ name: 'mobile', value: 16 }]);
  assert.deepEqual(result.countries, [{ name: 'India', sessions: 20 }]);
  assert.equal(result.map.markers.length, 1);
  assert.equal(result.map.markers[0].country, 'India');
  assert.ok(result.map.features.length > 100);
  assert.ok(calls.some(call => call.url.endsWith(':runRealtimeReport')));
  const historicalRequest = calls.find(call => call.url.endsWith(':runReport'));
  assert.equal(JSON.parse(historicalRequest.options.body).dateRanges[0].startDate, '29daysAgo');
  assert.equal(JSON.stringify(result).includes('test-access-token'), false);
  assert.equal(JSON.stringify(result).includes(env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY), false);

  await client.getDashboard({ range: '30d' });
  assert.equal(calls.length, 7);
  now += 60_001;
  await client.getDashboard({ range: '30d' });
  assert.equal(calls.length, 13);
});

test('GA4 dashboard applies exact country filters to realtime and historical requests', async () => {
  const { calls, fetchImpl } = createAnalyticsFetch();
  const client = new Ga4AnalyticsClient({ env, fetchImpl });
  await client.getDashboard({ range: '7d', country: 'India' });

  const reportCalls = calls.filter(call => call.url.includes('/properties/'));
  assert.equal(reportCalls.length, 6);
  for (const call of reportCalls) {
    assert.deepEqual(JSON.parse(call.options.body).dimensionFilter, {
      filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'India' } }
    });
  }
});

test('GA4 dashboard reports missing setup without calling Google and rejects unsupported filters', async () => {
  let calls = 0;
  const client = new Ga4AnalyticsClient({ env: {}, fetchImpl: async () => { calls += 1; } });
  const setup = await client.getDashboard({ range: '30d' });
  assert.equal(setup.status, 'setup-required');
  assert.deepEqual(setup.missing, [
    'GA4_PROPERTY_ID',
    'GA4_SERVICE_ACCOUNT_EMAIL',
    'GA4_SERVICE_ACCOUNT_PRIVATE_KEY'
  ]);
  assert.equal(calls, 0);
  await assert.rejects(client.getDashboard({ range: 'all-time' }), /Unsupported analytics date range/);
  await assert.rejects(client.getDashboard({ range: '7d', country: 'Bad<script>' }), /Invalid country filter/);
});

test('GA4 API errors are surfaced to the caller instead of returning empty metrics', async () => {
  const { fetchImpl } = createAnalyticsFetch({ failReports: true });
  const client = new Ga4AnalyticsClient({ env, fetchImpl });
  await assert.rejects(
    client.getDashboard({ range: '30d' }),
    /GA4 runRealtimeReport request failed \(403\)/
  );
});

test('admin analytics refresh runs every 60 seconds only while the tab and document are visible', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const start = adminHtml.indexOf('    function startAnalyticsRefresh() {');
  const end = adminHtml.indexOf('    async function loadAnalytics()', start);
  assert.ok(start >= 0 && end > start, 'analytics refresh function should exist in the admin page');

  let tabActive = true;
  let visible = true;
  let nextTimerId = 1;
  const intervals = [];
  const cleared = [];
  let refreshes = 0;
  const scope = {
    document: {
      getElementById: () => ({ classList: { contains: () => tabActive } }),
      get visibilityState() { return visible ? 'visible' : 'hidden'; }
    },
    clearInterval: id => cleared.push(id),
    setInterval: (callback, delay) => {
      const interval = { id: nextTimerId++, callback, delay };
      intervals.push(interval);
      return interval.id;
    },
    loadAnalytics: () => { refreshes += 1; }
  };
  const createHarness = new Function(
    'document',
    'clearInterval',
    'setInterval',
    'loadAnalytics',
    `let analyticsRefreshTimer;\n${adminHtml.slice(start, end)}\nreturn { startAnalyticsRefresh, getTimer: () => analyticsRefreshTimer };`
  );
  const harness = createHarness(scope.document, scope.clearInterval, scope.setInterval, scope.loadAnalytics);

  harness.startAnalyticsRefresh();
  assert.equal(intervals[0].delay, 60_000);
  intervals[0].callback();
  assert.equal(refreshes, 1);
  visible = false;
  intervals[0].callback();
  assert.equal(refreshes, 1);
  tabActive = false;
  harness.startAnalyticsRefresh();
  assert.deepEqual(cleared.filter(id => id !== undefined), [intervals[0].id]);
  assert.equal(harness.getTimer(), undefined);
  assert.equal(intervals.length, 1);
});
