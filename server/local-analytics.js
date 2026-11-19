const RANGES = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });

function getLocalAnalytics(database, range = '30d') {
  if (!Object.hasOwn(RANGES, range)) throw new RangeError('Choose a supported analytics date range.');
  const since = `-${RANGES[range]} days`;
  const events = database.prepare(`
    SELECT event_name AS name, COUNT(*) AS value FROM analytics_events
    WHERE created_at >= datetime('now', ?) GROUP BY event_name ORDER BY value DESC, name
  `).all(since);
  const properties = database.prepare(`
    SELECT COALESCE(p.title, 'Unavailable property') AS name, COUNT(*) AS value
    FROM analytics_events e LEFT JOIN properties p ON p.id = e.property_id
    WHERE e.event_name = 'property_view' AND e.created_at >= datetime('now', ?)
    GROUP BY e.property_id ORDER BY value DESC, name LIMIT 10
  `).all(since);
  return {
    status: 'ready', provider: 'local', range, rangeLabel: `Last ${RANGES[range]} days`,
    totalEvents: events.reduce((total, event) => total + event.value, 0),
    propertyViews: events.find(event => event.name === 'property_view')?.value || 0,
    enquiries: events.find(event => event.name === 'enquiry')?.value || 0,
    events, properties, lastUpdatedAt: new Date().toISOString()
  };
}

module.exports = { RANGES, getLocalAnalytics };
