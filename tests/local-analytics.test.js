const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { getLocalAnalytics } = require('../server/local-analytics');

test('local reports count stored events, honor date ranges and do not invent visitor metrics', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE analytics_events (event_name TEXT, property_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE properties (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO properties VALUES ('one', 'Example property');
      INSERT INTO analytics_events (event_name,property_id) VALUES ('property_view','one'),('property_view','one'),('enquiry','one');
      INSERT INTO analytics_events VALUES ('social_click',NULL,datetime('now','-20 days'));
      INSERT INTO analytics_events VALUES ('old_event',NULL,datetime('now','-100 days'));`);
    const recent = getLocalAnalytics(db, '7d');
    assert.equal(recent.provider, 'local');
    assert.equal(recent.totalEvents, 3);
    assert.equal(recent.propertyViews, 2);
    assert.equal(recent.enquiries, 1);
    assert.deepEqual(recent.properties.map(row=>({...row})), [{name:'Example property',value:2}]);
    assert.equal(getLocalAnalytics(db, '30d').totalEvents, 4);
    assert.equal(getLocalAnalytics(db, '90d').totalEvents, 4);
    assert.equal(Object.hasOwn(recent, 'activeUsers'), false);
    assert.equal(Object.hasOwn(recent, 'map'), false);
    assert.throws(()=>getLocalAnalytics(db, "30d' OR 1=1"), RangeError);
    db.exec('DELETE FROM analytics_events');
    assert.equal(getLocalAnalytics(db).totalEvents, 0);
    assert.deepEqual(getLocalAnalytics(db).events, []);
  } finally { db.close(); }
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
