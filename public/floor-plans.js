(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FloorPlans = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
      const area = text(plan.area ?? (legacy ? '' : undefined), 'Area', legacy ? 500 : 80);
      const price = text(plan.price ?? '', 'Price', legacy ? 500 : 160);
      const image_url = text(plan.image_url ?? plan.image ?? (legacy ? '' : undefined), '2D plan image URL', 2048);
      if (!configuration || (!legacy && (!area || !image_url))) fail('Each floor plan needs a configuration, area and 2D image.');
      if (image_url && !safeImage(image_url) && !(legacy && /^\/(?!\/)[^\s\\]*$/.test(image_url) && !image_url.includes('..'))) fail('Use an uploaded image or an HTTP(S) image URL without credentials.');
      const key = `${configuration.toLowerCase()}\u0000${area.toLowerCase()}`;
      if (seen.has(key) && !legacy) fail('Each configuration and area combination must be unique.');
      seen.add(key);
      const rooms = plan.rooms ?? [];
      if (!Array.isArray(rooms) || rooms.length > 30) fail('Add up to 30 rooms per floor plan.');
      return { configuration, area, price, image_url, ...(legacy ? { legacy_partial: true } : {}), rooms: rooms.map(room => {
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
  function bodyMarkup(groupList, groupIndex = 0, planIndex = 0) {
    const group = groupList[groupIndex];
    const plan = group.plans[planIndex];
    return `<div class="fp-tabs fp-configurations" role="tablist" aria-label="Floor plan configurations">${groupList.map((item, i) => `<button type="button" role="tab" id="fp-config-${i}" aria-controls="fp-config-panel" aria-selected="${i === groupIndex}" tabindex="${i === groupIndex ? 0 : -1}" data-fp-group="${i}"><strong>${escape(item.name)}</strong><span>${item.plans.length === 1 ? escape(item.plans[0].price || 'Contact for price') : `${item.plans.length} area options`}</span></button>`).join('')}</div>
<div id="fp-config-panel" role="tabpanel" aria-labelledby="fp-config-${groupIndex}">
<div class="fp-tabs fp-areas" role="tablist" aria-label="Area options">${group.plans.map((item, i) => `<button type="button" role="tab" id="fp-area-${i}" aria-controls="fp-view-panel" aria-selected="${i === planIndex}" tabindex="${i === planIndex ? 0 : -1}" data-fp-plan="${i}">${escape(item.area || 'Area not listed')}</button>`).join('')}</div>
<div id="fp-view-panel" role="tabpanel" aria-labelledby="fp-area-${planIndex}" tabindex="0">
<div class="fp-price"><strong>${escape(plan.price || 'Contact for price')}</strong><span>2D Floor Plan</span></div>
<div class="fp-viewer"><div class="fp-scroller" tabindex="0" role="region" aria-label="2D floor plan; scroll to explore when zoomed"><div class="fp-stage">${plan.image_url ? `<img src="${escape(plan.image_url)}" alt="${escape(plan.configuration)} — ${escape(plan.area)} 2D floor plan" loading="lazy" decoding="async">` : '<p class="fp-help">A 2D plan image has not been provided for this option.</p>'}<p class="fp-image-error" role="status" hidden>This plan image could not be loaded. Please contact the seller.</p></div></div>
<div class="fp-zoom" role="group" aria-label="Floor plan zoom"><button type="button" data-fp-zoom="in" aria-label="Zoom in">+</button><button type="button" data-fp-zoom="out" aria-label="Zoom out">−</button><button type="button" data-fp-zoom="reset" aria-label="Reset zoom">↺</button></div></div>
<p class="fp-help" role="status" aria-live="polite">Zoom: <span data-fp-scale>100%</span>. Use + and − to zoom; scroll within the plan to explore.</p>
${plan.rooms.length ? `<ul class="fp-rooms" aria-label="Room dimensions">${plan.rooms.map(room => `<li><strong>${escape(room.name)}</strong><span>${escape(room.dimensions)}</span></li>`).join('')}</ul>` : '<p class="fp-help">Room dimensions have not been provided.</p>'}
</div></div>`;
  }
  function render(property) {
    const plans = read(property.floor_plans);
    return `<section id="detail-floor-plans" class="floor-plans detail-section" aria-labelledby="floorPlansTitle"><header><h3 id="floorPlansTitle">${escape(property.title)} Floor Plans and Pricing</h3></header><div class="fp-body">${plans.length ? bodyMarkup(groups(plans)) : '<div class="fp-empty"><p>2D floor plans have not been added for this property yet.</p><button type="button" class="btn btn-outline" data-fp-enquire>Ask seller for a 2D floor plan</button></div>'}</div></section>`;
  }
  function mount(section, property, onEnquire) {
    if (!section) return;
    const groupList = groups(read(property.floor_plans));
    let groupIndex = 0, planIndex = 0, zoom = 1;
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
      body.innerHTML = bodyMarkup(groupList, groupIndex, planIndex);
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
      if (button.hasAttribute('data-fp-group') || button.hasAttribute('data-fp-plan')) return select(button);
      if (button.dataset.fpZoom) {
        zoom = button.dataset.fpZoom === 'reset' ? 1 : Math.max(1, Math.min(3, zoom + (button.dataset.fpZoom === 'in' ? .25 : -.25)));
        const stage = section.querySelector('.fp-stage');
        stage.style.width = `${zoom * 100}%`; stage.style.height = `${zoom * 100}%`;
        section.querySelector('[data-fp-scale]').textContent = `${Math.round(zoom * 100)}%`;
        if (zoom === 1) section.querySelector('.fp-scroller').scrollTo(0, 0);
      }
    });
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
  return { normalize, read, render, mount };
});
