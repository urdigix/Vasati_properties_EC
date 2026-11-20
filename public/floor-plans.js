(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FloorPlans = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SQFT_TO_SQM = 0.09290304;
  const number = value => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const money = rupees => rupees >= 10000000 ? `₹${number(rupees / 10000000)} Cr` : `₹${number(rupees / 100000)} L`;
  const range = (min, max, format) => min === max ? format(min) : `${format(min)} – ${format(max)}`;
  function areaLabel(min, max = min, unit = 'sqft') {
    const factor = unit === 'sqm' ? SQFT_TO_SQM : 1;
    return `${range(min * factor, max * factor, number)} ${unit === 'sqm' ? 'sq.m' : 'sq.ft.'}`;
  }
  function planArea(plan) {
    if (plan.area_sqft) return {min:plan.area_sqft,max:plan.area_max_sqft};
    const match = /^([\d,.]+)(?:\s*[–-]\s*([\d,.]+))?\s*(sq\.?\s*ft\.?|sqft|sq\.?\s*m\.?|sqm|m²)$/i.exec(plan.area || '');
    if (!match) return null;
    const factor = /m/i.test(match[3]) ? 1 / SQFT_TO_SQM : 1;
    const min = Number(match[1].replaceAll(',','')) * factor, max = Number((match[2] || match[1]).replaceAll(',','')) * factor;
    return min > 0 && max >= min ? {min,max} : null;
  }
  function summary(plans) {
    const numeric = plans.filter(p => p.rate_per_sqft > 0 && p.area_sqft > 0);
    if (!numeric.length || numeric.length !== plans.length) return null;
    const min = Math.min(...numeric.map(p => Math.round(p.area_sqft * p.rate_per_sqft * 100) / 100));
    const max = Math.max(...numeric.map(p => Math.round((p.area_max_sqft || p.area_sqft) * p.rate_per_sqft * 100) / 100));
    const areaMin = Math.min(...numeric.map(p => p.area_sqft)), areaMax = Math.max(...numeric.map(p => p.area_max_sqft || p.area_sqft));
    return { min, max, areaMin, areaMax, price: min / 100000, label: range(min, max, money), area: areaLabel(areaMin,areaMax), rate: range(Math.min(...numeric.map(p => p.rate_per_sqft)), Math.max(...numeric.map(p => p.rate_per_sqft)), n => `₹${number(n)}`) + ' / sq.ft.' };
  }
  function fail(message) { const error = new Error(message); error.code = 'INVALID_FLOOR_PLANS'; throw error; }
  function text(value, label, max = 160) {
    if (typeof value !== 'string' || value.trim().length > max) fail(`${label} must be text of at most ${max} characters.`);
    return value.trim();
  }
  function safeImage(value) {
    if (/^\/(?:uploads\/properties|api\/media|images)\/[a-z0-9_./%-]+$/i.test(value) && !value.includes('..')) return true;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }
  function normalize(value = []) {
    if (!Array.isArray(value) || value.length > 30) fail('Add up to 30 floor-plan options per property.');
    const seen = new Set();
    return value.map(plan => {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Each floor plan must be an object.');
      const legacy = typeof plan.label === 'string' || plan.legacy_partial === true;
      const configuration = text(plan.configuration ?? plan.label, 'Configuration', legacy ? 500 : 80);
      let area = text(plan.area ?? '', 'Area', legacy ? 500 : 80);
      let price = text(plan.price ?? '', 'Price', legacy ? 500 : 160);
      const calculated = [plan.area_sqft, plan.area_max_sqft, plan.rate_per_sqft].some(v => v !== undefined && v !== '' && v !== null);
      let pricing = {};
      if (calculated) {
        for (const key of ['area_sqft','area_max_sqft','rate_per_sqft']) if (plan[key] !== undefined && plan[key] !== '' && plan[key] !== null && !['string','number'].includes(typeof plan[key])) fail('Area and price per sq.ft. must be numbers.');
        const min = Number(plan.area_sqft), max = Number(plan.area_max_sqft === undefined || plan.area_max_sqft === '' || plan.area_max_sqft === null ? plan.area_sqft : plan.area_max_sqft), rate = Number(plan.rate_per_sqft);
        if (![min, max, rate].every(Number.isFinite) || min <= 0 || max < min || max > 10000000 || rate <= 0 || rate > 1000000) fail('Enter a positive area and price per sq.ft. Maximum area must be at least the minimum.');
        const area_type = text(plan.area_type ?? 'Super Built-up Area', 'Area type', 80);
        if (!['Super Built-up Area', 'Built-up Area', 'Carpet Area', 'Plot Area'].includes(area_type)) fail('Choose a valid area type.');
        pricing = { area_sqft: min, area_max_sqft: max, rate_per_sqft: rate, area_type };
        area = areaLabel(min, max);
        price = range(Math.round(min * rate * 100) / 100, Math.round(max * rate * 100) / 100, money);
      }
      const image_url = text(plan.image_url ?? plan.image ?? (legacy ? '' : undefined), '2D plan image URL', 2048);
      if (!configuration || (!legacy && (!area || !image_url))) fail('Each floor plan needs a configuration, area and 2D image.');
      if (image_url && !safeImage(image_url) && !(legacy && /^\/(?!\/)[^\s\\]*$/.test(image_url) && !image_url.includes('..'))) fail('Use an uploaded image or an HTTP(S) image URL without credentials.');
      const key = `${configuration.toLowerCase()}\u0000${area.toLowerCase()}`;
      if (seen.has(key) && !legacy) fail('Each configuration and area combination must be unique.');
      seen.add(key);
      const rooms = plan.rooms ?? [];
      if (!Array.isArray(rooms) || rooms.length > 30) fail('Add up to 30 rooms per floor plan.');
      return { configuration, area, price, image_url, ...pricing, ...(legacy ? { legacy_partial: true } : {}), rooms: rooms.map(room => {
        if (!room || typeof room !== 'object') fail('Each room needs a name and dimensions.');
        const name = text(room.name, 'Room name', 80);
        const dimensions = text(room.dimensions, 'Room dimensions', 80);
        if (!name || !dimensions) fail('Enter both the room name and dimensions, or remove the room.');
        return { name, dimensions };
      }) };
    });
  }
  function read(value) {
    try { return normalize(typeof value === 'string' ? JSON.parse(value) : (value ?? [])); }
    catch { return []; }
  }
  function groups(plans) {
    const result = [];
    plans.forEach(plan => {
      let group = result.find(group => group.name.toLowerCase() === plan.configuration.toLowerCase());
      if (!group) { group = { name: plan.configuration, plans: [] }; result.push(group); }
      group.plans.push(plan);
    });
    return result;
  }
  function detailMarkup(groupList, groupIndex = 0, planIndex = 0) {
    const group = groupList[groupIndex];
    const plan = group.plans[planIndex];
    return `<div id="fp-config-panel" role="region" aria-label="${escape(group.name)} plan details">
<div class="fp-tabs fp-areas" role="tablist" aria-label="Area options">${group.plans.map((item, i) => `<button type="button" role="tab" id="fp-area-${i}" aria-controls="fp-view-panel" aria-selected="${i === planIndex}" tabindex="${i === planIndex ? 0 : -1}" data-fp-plan="${i}">${escape(item.area || 'Area not listed')}</button>`).join('')}</div>
<div id="fp-view-panel" role="tabpanel" aria-labelledby="fp-area-${planIndex}" tabindex="0">
<div class="fp-price"><strong>${escape(plan.price || 'Contact for price')}</strong><span>2D Floor Plan</span></div>
<div class="fp-viewer"><div class="fp-scroller" tabindex="0" role="region" aria-label="2D floor plan; scroll to explore when zoomed"><div class="fp-stage">${plan.image_url ? `<img src="${escape(plan.image_url)}" alt="${escape(plan.configuration)} — ${escape(plan.area)} 2D floor plan" loading="lazy" decoding="async">` : '<p class="fp-help">A 2D plan image has not been provided for this option.</p>'}<p class="fp-image-error" role="status" hidden>This plan image could not be loaded. Please contact the seller.</p></div></div>
<div class="fp-zoom" role="group" aria-label="Floor plan zoom"><button type="button" data-fp-zoom="in" aria-label="Zoom in">+</button><button type="button" data-fp-zoom="out" aria-label="Zoom out">−</button><button type="button" data-fp-zoom="reset" aria-label="Reset zoom">↺</button></div></div>
<p class="fp-help" role="status" aria-live="polite">Zoom: <span data-fp-scale>100%</span>. Use + and − to zoom; scroll within the plan to explore.</p>
${plan.rooms.length ? `<ul class="fp-rooms" aria-label="Room dimensions">${plan.rooms.map(room => `<li><strong>${escape(room.name)}</strong><span>${escape(room.dimensions)}</span></li>`).join('')}</ul>` : '<p class="fp-help">Room dimensions have not been provided.</p>'}
</div></div>`;
  }
  function bodyMarkup(groupList, groupIndex = -1, planIndex = 0, unit = 'sqft') {
    const active = groupIndex < 0 ? groupList : [groupList[groupIndex]];
    return `<div class="fp-catalog-toolbar"><div class="fp-tabs" role="tablist" aria-label="Floor plan configurations"><button type="button" role="tab" id="fp-filter--1" aria-controls="fp-card-panel" tabindex="${groupIndex === -1 ? 0 : -1}" aria-selected="${groupIndex === -1}" data-fp-group="-1">All</button>${groupList.map((g,i)=>`<button type="button" role="tab" id="fp-filter-${i}" aria-controls="fp-card-panel" tabindex="${i === groupIndex ? 0 : -1}" aria-selected="${i === groupIndex}" data-fp-group="${i}"><strong>${escape(g.name)}</strong><span>${g.plans.length} ${g.plans.length === 1 ? 'size' : 'sizes'}</span></button>`).join('')}</div><label class="fp-unit">Area unit<select data-fp-unit aria-label="Area unit"><option value="sqft" ${unit === 'sqft' ? 'selected' : ''}>sq.ft.</option><option value="sqm" ${unit === 'sqm' ? 'selected' : ''}>sq.m</option></select></label></div>
    <p class="fp-help">1 sq.m = 10.7639 sq.ft. · Calculated prices are base prices; contact us for the final quote.</p>
    <div class="fp-cards" id="fp-card-panel" role="tabpanel" aria-labelledby="fp-filter-${groupIndex}">${active.map(g=>{
      const gi = groupList.indexOf(g), totals = summary(g.plans), numeric = g.plans.map(planArea).filter(Boolean);
      const min = numeric.length ? Math.min(...numeric.map(p=>p.min)) : 0;
      const max = numeric.length ? Math.max(...numeric.map(p=>p.max)) : 0;
      const selected = g.plans[groupIndex === gi ? planIndex : 0];
      return `<article class="fp-option-card">${selected.image_url ? `<img src="${escape(selected.image_url)}" alt="${escape(g.name)} floor plan" loading="lazy" decoding="async" width="320" height="220">` : '<div class="fp-card-no-image">Plan image not provided</div>'}<div class="fp-option-content"><h4>${escape(g.name)}</h4><p>${escape(selected.area_type || 'Area')}</p><strong class="fp-card-area">${numeric.length ? areaLabel(min,max,unit) : escape(g.plans.map(p=>p.area).join(' / '))}</strong>${numeric.length ? `<small>${areaLabel(min,max,unit === 'sqm' ? 'sqft' : 'sqm')}</small>` : ''}<strong class="fp-card-price">${escape(totals?.label || [...new Set(g.plans.map(p=>p.price || 'Contact for price'))].join(' / '))}</strong>${totals ? `<small>${escape(totals.rate)}</small>` : ''}<button type="button" class="btn btn-outline" data-fp-open="${gi}">View floor plan</button><button type="button" class="btn btn-primary" data-fp-enquire>Contact</button></div></article>`;
    }).join('')}</div>
    <details class="fp-detail" ${groupIndex >= 0 ? 'open' : ''}><summary>Explore plan images, sizes and room dimensions</summary>${detailMarkup(groupList,Math.max(0,groupIndex),planIndex)}</details>`;
  }
  function render(property) {
    const plans = read(property.floor_plans);
    return `<section id="detail-floor-plans" class="floor-plans detail-section" aria-labelledby="floorPlansTitle"><header><h3 id="floorPlansTitle">${escape(property.title)} Floor Plans and Pricing</h3></header><div class="fp-body">${plans.length ? bodyMarkup(groups(plans)) : '<div class="fp-empty"><p>2D floor plans have not been added for this property yet.</p><button type="button" class="btn btn-outline" data-fp-enquire>Ask seller for a 2D floor plan</button></div>'}</div></section>`;
  }
  function mount(section, property, onEnquire) {
    if (!section) return;
    const groupList = groups(read(property.floor_plans));
    let groupIndex = -1, planIndex = 0, zoom = 1, unit = 'sqft';
    const body = section.querySelector('.fp-body');
    function bindImage() {
      const image = section.querySelector('.fp-stage img');
      if (!image) return;
      const error = () => { image.hidden = true; section.querySelector('.fp-image-error').hidden = false; };
      image.addEventListener('error', error, { once: true });
      if (image.complete && !image.naturalWidth) error();
    }
    function draw(focusSelector) {
      zoom = 1;
      body.innerHTML = bodyMarkup(groupList, groupIndex, planIndex, unit);
      bindImage();
      if (focusSelector) section.querySelector(focusSelector)?.focus({ preventScroll: true });
    }
    function select(button) {
      if (button.hasAttribute('data-fp-group')) { groupIndex = Number(button.dataset.fpGroup); planIndex = 0; draw(`[data-fp-group="${groupIndex}"]`); }
      else { planIndex = Number(button.dataset.fpPlan); draw(`[data-fp-plan="${planIndex}"]`); }
    }
    section.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !section.contains(button)) return;
      if (button.hasAttribute('data-fp-enquire')) return onEnquire?.();
      if (button.hasAttribute('data-fp-open')) { groupIndex = Number(button.dataset.fpOpen); planIndex = 0; draw('.fp-detail summary'); section.querySelector('.fp-detail').scrollIntoView({block:'nearest'}); return; }
      if (button.hasAttribute('data-fp-group') || button.hasAttribute('data-fp-plan')) return select(button);
      if (button.dataset.fpZoom) {
        zoom = button.dataset.fpZoom === 'reset' ? 1 : Math.max(1, Math.min(3, zoom + (button.dataset.fpZoom === 'in' ? .25 : -.25)));
        const stage = section.querySelector('.fp-stage');
        stage.style.width = `${zoom * 100}%`; stage.style.height = `${zoom * 100}%`;
        section.querySelector('[data-fp-scale]').textContent = `${Math.round(zoom * 100)}%`;
        if (zoom === 1) section.querySelector('.fp-scroller').scrollTo(0, 0);
      }
    });
    section.addEventListener('change', event => { if (event.target.matches('[data-fp-unit]')) { unit = event.target.value; draw('[data-fp-unit]'); } });
    section.addEventListener('keydown', event => {
      if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...event.target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
      let index = tabs.indexOf(event.target);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[index]);
    });
    bindImage();
  }
  return { normalize, read, render, mount, summary, areaLabel, SQFT_TO_SQM };
});
