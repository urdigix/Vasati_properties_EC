const TEXT_FIELDS = ['builder_name', 'rera_id', 'project_units', 'project_area', 'launch_date', 'map_address'];
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
function imageUrl(value) {
  if (!value) return true;
  return typeof value === 'string' && value.length <= 2048 && (/^\/(?!\/)[^\s\\]*$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value));
}
function normalizeDetails(prop, current = {}) {
  const details = prop.project_details === undefined ? (current.project_details || {}) : prop.project_details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) invalid('Project details must be an object.');
  const project_details = {};
  for (const key of TEXT_FIELDS) {
    if (details[key] !== undefined && (typeof details[key] !== 'string' || details[key].length > 500)) invalid(`${key} must be text under 500 characters.`);
    project_details[key] = String(details[key] || '').trim();
  }
  const plans = prop.floor_plans === undefined ? (current.floor_plans || []) : prop.floor_plans;
  if (!Array.isArray(plans) || plans.length > 12) invalid('Add no more than 12 floor plans.');
  const floor_plans = plans.map(plan => {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) invalid('Each floor plan must be an object.');
    const result = {};
    for (const key of ['label', 'area', 'price', 'image']) {
      if (plan[key] !== undefined && (typeof plan[key] !== 'string' || plan[key].length > (key === 'image' ? 2048 : 200))) invalid(`Invalid floor plan ${key}.`);
      result[key] = String(plan[key] || '').trim();
    }
    if (!result.label) invalid('Each floor plan needs a configuration label.');
    if (!imageUrl(result.image)) invalid('Floor plan images need an HTTP(S) URL or a local upload path.');
    return result;
  });
  return { project_details, floor_plans };
}
function readDetails(row) {
  let details = {}, plans = [];
  try { details = JSON.parse(row.project_details || '{}'); } catch {}
  try { plans = JSON.parse(row.floor_plans || '[]'); } catch {}
  return { project_details: details && typeof details === 'object' && !Array.isArray(details) ? details : {}, floor_plans: Array.isArray(plans) ? plans : [] };
}
module.exports = { normalizeDetails, readDetails };
