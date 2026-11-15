const crypto = require('node:crypto');
const { geoNaturalEarth1, geoPath } = require('d3-geo');
const topojson = require('topojson-client');
const worldTopology = require('world-atlas/countries-110m.json');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://analyticsdata.googleapis.com/v1beta';
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const CACHE_TTL_MS = 45_000;
const MAP_WIDTH = 960;
const MAP_HEIGHT = 440;
const ALLOWED_RANGES = Object.freeze({
  '7d': { label: 'Last 7 days', startDate: '6daysAgo' },
  '30d': { label: 'Last 30 days', startDate: '29daysAgo' },
  '90d': { label: 'Last 90 days', startDate: '89daysAgo' }
});

const countryAliases = new Map([
  ['cote d ivoire', 'ivory coast'],
  ['czechia', 'czech republic'],
  ['iran', 'iran'],
  ['north korea', 'north korea'],
  ['republic of the congo', 'republic of the congo'],
  ['russia', 'russia'],
  ['south korea', 'south korea'],
  ['tanzania', 'united republic of tanzania'],
  ['turkiye', 'turkey'],
  ['united states', 'united states of america'],
  ['usa', 'united states of america'],
  ['uk', 'united kingdom']
]);

function normalizeCountryName(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return countryAliases.get(normalized) || normalized;
}

function buildMapGeometry() {
  const collection = topojson.feature(worldTopology, worldTopology.objects.countries);
  const projection = geoNaturalEarth1().fitExtent(
    [[8, 8], [MAP_WIDTH - 8, MAP_HEIGHT - 8]],
    collection
  );
  const path = geoPath(projection);
  return collection.features.flatMap(feature => {
    const d = path(feature);
    if (!d || !feature.properties?.name) return [];
    const center = path.centroid(feature);
    if (!center.every(Number.isFinite)) return [];
    return [{ name: feature.properties.name, d, center }];
  });
}

const mapGeometry = buildMapGeometry();
const mapGeometryByCountry = new Map(mapGeometry.map(feature => [
  normalizeCountryName(feature.name),
  feature
]));

function getConfiguration(env) {
  const propertyId = String(env.GA4_PROPERTY_ID || '').trim();
  const serviceAccountEmail = String(env.GA4_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = String(env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const missing = [];

  if (!/^\d{1,20}$/.test(propertyId)) missing.push('GA4_PROPERTY_ID');
  if (!/^[^\s@]+@[^\s@]+$/.test(serviceAccountEmail)) missing.push('GA4_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GA4_SERVICE_ACCOUNT_PRIVATE_KEY');

  return { propertyId, serviceAccountEmail, privateKey, missing };
}

function createAssertion({ serviceAccountEmail, privateKey }, now) {
  const issuedAt = Math.floor(now / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: serviceAccountEmail,
    scope: GA_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

function parseCount(value, label) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) throw new Error(`GA4 returned an invalid ${label} value.`);
  return Math.round(count);
}

function reportRows(report, dimensionName, metricName) {
  const dimensionIndex = report.dimensionHeaders?.findIndex(header => header.name === dimensionName) ?? -1;
  const metricIndex = report.metricHeaders?.findIndex(header => header.name === metricName) ?? -1;
  if (dimensionIndex < 0) throw new Error(`GA4 response omitted the ${dimensionName} dimension.`);
  if (metricIndex < 0) throw new Error(`GA4 response omitted the ${metricName} metric.`);
  return (report.rows || []).map(row => ({
    name: row.dimensionValues?.[dimensionIndex]?.value || '',
    value: parseCount(row.metricValues?.[metricIndex]?.value ?? 0, metricName)
  })).filter(row => row.name && row.name !== '(not set)');
}

function metricValue(report, metricName) {
  if (!report.metricHeaders?.some(header => header.name === metricName)) {
    throw new Error(`GA4 response omitted the ${metricName} metric.`);
  }
  const index = report.metricHeaders.findIndex(header => header.name === metricName);
  const value = report.rows?.[0]?.metricValues?.[index]?.value ?? 0;
  return parseCount(value, metricName);
}

function mapMarkers(countries) {
  return countries.flatMap(country => {
    const feature = mapGeometryByCountry.get(normalizeCountryName(country.name));
    if (!feature) return [];
    return [{
      country: country.name,
      sessions: country.sessions,
      x: feature.center[0],
      y: feature.center[1]
    }];
  });
}

class Ga4AnalyticsClient {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
    this.tokenRequest = undefined;
    this.cache = new Map();
  }

  async readJson(response, message) {
    try {
      return await response.json();
    } catch {
      throw new Error(message);
    }
  }

  async getAccessToken(configuration) {
    if (this.accessToken && this.now() < this.accessTokenExpiresAt) return this.accessToken;
    if (this.tokenRequest) return this.tokenRequest;

    const tokenRequest = this.exchangeAccessToken(configuration);
    this.tokenRequest = tokenRequest;
    try {
      return await tokenRequest;
    } finally {
      if (this.tokenRequest === tokenRequest) this.tokenRequest = undefined;
    }
  }

  async exchangeAccessToken(configuration) {
    const assertion = createAssertion(configuration, this.now());
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error(`GA4 token exchange failed (${response.status}).`);
    const token = await this.readJson(response, 'GA4 token response was invalid.');
    if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(Number(token.expires_in))) {
      throw new Error('GA4 token response was incomplete.');
    }

    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = this.now() + Math.max(0, Number(token.expires_in) - 60) * 1000;
    return this.accessToken;
  }

  async requestReport(method, body, configuration, retry = true) {
    const token = await this.getAccessToken(configuration);
    const response = await this.fetchImpl(
      `${API_ROOT}/properties/${configuration.propertyId}:${method}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000)
      }
    );
    if (response.status === 401 && retry) {
      this.accessToken = '';
      this.accessTokenExpiresAt = 0;
      return this.requestReport(method, body, configuration, false);
    }
    if (!response.ok) throw new Error(`GA4 ${method} request failed (${response.status}).`);
    return this.readJson(response, `GA4 ${method} response was invalid.`);
  }

  async getDashboard({ range, country = '' }) {
    if (!Object.hasOwn(ALLOWED_RANGES, range)) throw new Error('Unsupported analytics date range.');

    const normalizedCountry = String(country || '').trim();
    if (normalizedCountry && !/^[\p{L}\p{M} .,'’()-]{1,80}$/u.test(normalizedCountry)) {
      throw new Error('Invalid country filter.');
    }

    const configuration = getConfiguration(this.env);
    if (configuration.missing.length) {
      return {
        status: 'setup-required',
        missing: configuration.missing,
        message: 'GA4 reporting is not configured. Add the required server-side GA4 credentials to enable reports.'
      };
    }

    const cacheKey = `${range}:${normalizeCountryName(normalizedCountry)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() < cached.expiresAt) return cached.value;

    const rangeConfig = ALLOWED_RANGES[range];
    const dateRanges = [{ startDate: rangeConfig.startDate, endDate: 'today' }];
    const dimensionFilter = normalizedCountry ? {
      filter: {
        fieldName: 'country',
        stringFilter: { matchType: 'EXACT', value: normalizedCountry }
      }
    } : undefined;
    const runReport = (metrics, dimensions = [], limit = 10) => this.requestReport('runReport', {
      dateRanges,
      metrics: metrics.map(name => ({ name })),
      ...(dimensions.length ? { dimensions: dimensions.map(name => ({ name })) } : {}),
      ...(dimensions.length ? { orderBys: [{ metric: { metricName: metrics[0] }, desc: true }] } : {}),
      ...(dimensions.length ? { limit } : {}),
      ...(dimensionFilter ? { dimensionFilter } : {})
    }, configuration);

    const [realtime, totals, pages, sources, devices, countryReport] = await Promise.all([
      this.requestReport('runRealtimeReport', {
        metrics: [{ name: 'activeUsers' }],
        ...(dimensionFilter ? { dimensionFilter } : {})
      }, configuration),
      runReport(['activeUsers', 'sessions', 'screenPageViews'], [], 1),
      runReport(['screenPageViews'], ['pagePath']),
      runReport(['sessions'], ['sessionDefaultChannelGroup']),
      runReport(['sessions'], ['deviceCategory']),
      runReport(['sessions'], ['country'], 50)
    ]);

    const countries = reportRows(countryReport, 'country', 'sessions')
      .sort((left, right) => right.value - left.value)
      .map(row => ({ name: row.name, sessions: row.value }));
    const realtimeActiveUsers = metricValue(realtime, 'activeUsers');
    const data = {
      status: 'ready',
      range,
      rangeLabel: rangeConfig.label,
      lastUpdatedAt: new Date(this.now()).toISOString(),
      realtime: { activeUsers: realtimeActiveUsers },
      historical: {
        activeUsers: metricValue(totals, 'activeUsers'),
        sessions: metricValue(totals, 'sessions'),
        pageViews: metricValue(totals, 'screenPageViews')
      },
      topPages: reportRows(pages, 'pagePath', 'screenPageViews'),
      trafficSources: reportRows(sources, 'sessionDefaultChannelGroup', 'sessions'),
      devices: reportRows(devices, 'deviceCategory', 'sessions'),
      countries,
      map: {
        features: mapGeometry,
        markers: mapMarkers(countries)
      }
    };

    this.cache.set(cacheKey, { value: data, expiresAt: this.now() + CACHE_TTL_MS });
    if (this.cache.size > 50) {
      for (const [key, entry] of this.cache) {
        if (this.now() >= entry.expiresAt) this.cache.delete(key);
      }
      if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    }
    return data;
  }
}

module.exports = {
  ALLOWED_RANGES,
  Ga4AnalyticsClient,
  LOCATION_MAP_NOTICE: 'No location map is connected. Location is approximate when supported, never exact. A GA4 Data API / map integration must be configured by the site owner. The summary refresh interval is 60 seconds; anonymous analytics cannot identify every visitor.',
  getConfiguration,
  normalizeCountryName
};
