const DEFAULT_SEARCH_LOCALITIES = ['Electronic City Phase 1', 'Electronic City Phase 2', 'Chandhapura'];

function validateSearchLocalities(value) {
  let names = value;
  if (typeof names === 'string') {
    try { names = JSON.parse(names); } catch { names = null; }
  }
  if (!Array.isArray(names) || names.length > 100) {
    throw new Error('Search locations must be a list of up to 100 names.');
  }
  const seen = new Set();
  return names.map(name => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Each search location must contain 1–80 characters without line breaks.');
    }
    const normalized = name.trim().replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (seen.has(key)) throw new Error('Search locations must have unique names.');
    seen.add(key);
    return normalized;
  });
}

function readSearchLocalities(value) {
  if (value === undefined || value === null) return [...DEFAULT_SEARCH_LOCALITIES];
  try { return validateSearchLocalities(value); } catch { return [...DEFAULT_SEARCH_LOCALITIES]; }
}

module.exports = { DEFAULT_SEARCH_LOCALITIES, validateSearchLocalities, readSearchLocalities };
