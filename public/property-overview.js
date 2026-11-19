(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PropertyOverview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const fields = ['project_units', 'area_unit', 'sizes', 'project_size', 'launch_date', 'avg_price', 'possession_status', 'configurations', 'rera_status', 'rera_id', 'rera_url'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function normalize(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Overview must be an object.');
    const result = {};
    for (const key of fields) {
      const input = value[key] ?? '';
      if (typeof input !== 'string' && !(key === 'project_units' && typeof input === 'number')) fail('Overview fields must contain text.');
      const text = String(input).trim();
      if (text.length > (key === 'rera_url' ? 2048 : 160)) fail('Overview fields must contain at most 160 characters (RERA URL: 2048).');
      result[key] = text;
    }
    if (result.project_units && (!/^\d+$/.test(result.project_units) || Number(result.project_units) < 1 || Number(result.project_units) > 100000000)) fail('Project units must be a whole number between 1 and 100000000.');
    if (result.launch_date && !/^(19\d{2}|20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(result.launch_date)) fail('Launch date must be a valid month (YYYY-MM).');
    result.rera_status ||= 'not_provided';
    if (!['not_provided', 'registered', 'not_applicable'].includes(result.rera_status)) fail('Choose a valid RERA status.');
    if (result.rera_status === 'registered' && !result.rera_id) fail('Enter the RERA ID when choosing registered.');
    if (result.rera_url) {
      let url;
      try { url = new URL(result.rera_url); } catch { fail('RERA details link must be a complete HTTP or HTTPS URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('RERA details link must use HTTP or HTTPS without credentials.');
    }
    return result;
  }
  function fail(message) { const error = new Error(message); error.code = 'INVALID_PROJECT_OVERVIEW'; throw error; }
  function read(value) {
    try { return normalize(typeof value === 'string' ? JSON.parse(value) : (value || {})); }
    catch { return normalize({}); }
  }
  function fromLegacy(value) {
    let legacy;
    try { legacy = typeof value === 'string' ? JSON.parse(value) : value; } catch { return {}; }
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return {};
    const result = {};
    const units = String(legacy.project_units || '').trim();
    if (/^\d+$/.test(units) && Number(units) > 0 && Number(units) <= 100000000) result.project_units = units;
    if (legacy.project_area) result.project_size = String(legacy.project_area).slice(0, 160);
    if (legacy.rera_id) { result.rera_id = String(legacy.rera_id).slice(0, 160); result.rera_status = 'registered'; }
    const launch = String(legacy.launch_date || '').trim();
    if (/^(19\d{2}|20\d{2}|21\d{2})-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(launch)) result.launch_date = launch.slice(0, 7);
    return result;
  }
  const paths = {
    units: '<path d="M4 21V4h10v17M14 10h6v11M8 8h2m-2 4h2m-2 4h2m7-2h1m-1 3h1M2 21h20"/>',
    area: '<path d="M4 4h16v16H4zM8 4v4m4-4v3m4-3v4M4 16h4m-4-4h3m-3-4h4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3v3H8z"/>',
    price: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h8M8 10h8m-5-3c4 0 4 6-3 6l7 5"/>',
    possession: '<path d="M3 8h18M4 8v13m16-13v13M3 3h18v5H3zM6 3l4 5m2-5 4 5m-9 9h10"/>',
    configuration: '<path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/>',
    rera: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M6 7h12M6 17h12"/>'
  };
  const icon = key => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
  function render(property, options = {}) {
    const o = read(property.project_overview);
    let launch = 'Not listed';
    if (o.launch_date) {
      const [year, month] = o.launch_date.split('-');
      launch = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]}, ${year}`;
    }
    const values = [
      ['Project Units', o.project_units || 'Not listed', 'units'],
      ['Area Unit', o.area_unit || (/sq\.?\s*ft|sqft/i.test(property.area || '') ? 'sq.ft.' : 'Not listed'), 'area'],
      ['Sizes', o.sizes || property.area || 'Not listed', 'area'],
      ['Project Size', o.project_size || 'Not listed', 'units'],
      ['Launch Date', launch, 'calendar'],
      ['Avg. Price', o.avg_price || 'Not listed', 'price'],
      ['Possession Status', o.possession_status || property.possession || 'Not listed', 'possession'],
      ['Configurations', o.configurations || (Number(property.bhk) > 0 ? `${property.bhk} BHK ${property.kind || 'Property'}` : 'Not listed'), 'configuration'],
      ['RERA ID', o.rera_status === 'not_applicable' ? 'RERA Not Applicable' : o.rera_status === 'registered' ? o.rera_id : 'Not provided', 'rera']
    ];
    return `<section id="detail-overview" class="project-overview detail-section" aria-labelledby="projectOverviewTitle">
<header><h3 id="projectOverviewTitle">${escape(property.title)} Overview</h3></header>
<dl class="project-overview-grid">${values.map(([label, value, symbol]) => `<div class="project-overview-item">${icon(symbol)}<div><dt>${label}</dt><dd>${escape(value)}</dd>${label === 'RERA ID' && o.rera_url ? `<a class="project-rera-link" href="${escape(o.rera_url)}" target="_blank" rel="noopener noreferrer">Know More<span class="sr-only"> about RERA details</span></a>` : ''}</div></div>`).join('')}</dl>
${options.interactive === false ? '' : `<div class="project-overview-actions"><button type="button" data-overview-action="share"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/></svg>Share</button><button type="button" data-overview-action="save" aria-pressed="${Boolean(options.saved)}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>${options.saved ? 'Saved' : 'Save'}</span></button><button type="button" data-overview-action="ask">Ask For Details</button></div>`}</section>`;
  }
  return { fields, normalize, read, render, fromLegacy };
});
