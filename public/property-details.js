(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeUrl(value) {
    const text = String(value || '').trim();
    return /^(https?:\/\/[^\s]+|\/(?!\/)[^\s\\]*)$/i.test(text) ? text : '';
  }
  function priceLabel(p) { return p.priceLabel || p.price_label || (Number(p.price) > 0 ? Number(p.price) >= 100 ? `₹${(Number(p.price) / 100).toFixed(2)} Cr` : `₹${p.price} L` : 'Price on request'); }
  function photos(p) { return [...new Set([...(Array.isArray(p.images) ? p.images : []), p.image].map(safeUrl).filter(Boolean))]; }
  const empty = text => `<p class="pd-muted">${esc(text)}</p>`;
  const stat = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || 'On request')}</dd></div>`;
  function render(p, options = {}) {
    const d = p.project_details || {}, gallery = photos(p), plans = Array.isArray(p.floor_plans) ? p.floor_plans : [];
    const price = priceLabel(p), area = /^([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|ft²)$/i.exec(String(p.area || '').trim());
    const areaNumber = area ? Number(area[1].replace(/,/g, '')) : 0;
    const rate = areaNumber > 0 && Number(p.price) > 0 ? `₹${Math.round(Number(p.price) * 100000 / areaNumber).toLocaleString('en-IN')}/sq.ft` : '';
    const mapQuery = d.map_address || p.location;
    const amenities = (Array.isArray(p.amenities) ? p.amenities : []).filter(Boolean);
    const proximity = (Array.isArray(p.proximity) ? p.proximity : []).filter(Boolean);
    const whatsapp = String(options.whatsapp || '').replace(/\D/g, '');
    return `
      <header class="pd-heading">
        <div><p class="pd-eyebrow">VASATI PROPERTIES · ${esc(p.locality || 'PROPERTY DETAILS')}</p>
          <h1>${esc(p.title)}</h1>${d.builder_name ? `<p>By <strong>${esc(d.builder_name)}</strong></p>` : ''}
          <p class="pd-muted">${esc(p.location)}</p><div class="pd-badges"><span>${esc(p.status || 'Property listing')}</span>${d.rera_id ? `<span>RERA: ${esc(d.rera_id)}</span>` : ''}</div>
        </div><div class="pd-heading-price"><strong>${esc(price)}</strong>${rate ? `<p>${esc(rate)}</p>` : ''}<small>Contact us for the complete cost breakdown</small><button class="btn btn-primary" data-contact>Enquire about this property</button></div>
      </header>
      <section class="pd-gallery" aria-label="Property photographs">${gallery.length ? `
        <button class="pd-cover" data-photo="0" aria-label="Open property photo 1"><img src="${esc(gallery[0])}" alt="${esc(p.title)}" fetchpriority="high"></button>
        <div class="pd-thumbnails">${gallery.slice(1, 3).map((src, i) => `<button data-photo="${i + 1}" aria-label="Open property photo ${i + 2}"><img src="${esc(src)}" alt="${esc(p.title)} photo ${i + 2}" loading="lazy"></button>`).join('')}</div>
        <button class="btn pd-photo-count" data-photo="0">View all ${gallery.length} photos</button>` : empty('Property photos will be added soon.')}
      </section>
      <nav class="pd-nav" aria-label="Property sections">${[['overview','Overview'],['pricing','Floor plans & pricing'],['about','About'],['amenities','Amenities'],['location','Location'],['enquiry','Enquire']].map(([id, label]) => `<button data-section="${id}">${label}</button>`).join('')}</nav>
      <div class="detail-layout pd-layout"><main>
        <section class="detail-card pd-section" id="pd-overview"><h2>Project overview</h2><dl class="pd-stats">
          ${stat('Configuration', p.bhk ? `${p.bhk} BHK ${p.kind || 'Apartment'}` : p.kind)}${stat('Area', p.area)}${stat('Possession', p.possession)}${stat('Bathrooms', p.baths)}
          ${d.project_units ? stat('Project units', d.project_units) : ''}${d.project_area ? stat('Project area', d.project_area) : ''}${d.launch_date ? stat('Launch date', d.launch_date) : ''}${d.rera_id ? stat('RERA ID', d.rera_id) : ''}
        </dl></section>
        <section class="detail-card pd-section" id="pd-pricing"><p class="pd-eyebrow">FIND YOUR FIT</p><h2>Floor plans & pricing</h2>
          ${plans.length ? `<div class="pd-plan-tabs" role="group" aria-label="Floor plan configurations">${plans.map((plan, i) => `<button class="btn btn-outline" data-plan="${i}" aria-pressed="${i === 0}">${esc(plan.label)}</button>`).join('')}</div>
            ${plans.map((plan, i) => `<article class="pd-plan" data-plan-panel="${i}" ${i ? 'hidden' : ''}><div class="pd-plan-image">${safeUrl(plan.image) ? `<button data-plan-photo="${i}" aria-label="Enlarge ${esc(plan.label)} floor plan"><img loading="lazy" src="${esc(safeUrl(plan.image))}" alt="${esc(plan.label)} floor plan"></button>` : empty('Floor plan image available on request.')}</div><div><h3>${esc(plan.label)}</h3><dl class="pd-stats">${stat('Area', plan.area)}${stat('Price', plan.price || 'Price on request')}</dl><button class="btn btn-primary" data-contact>Request price details</button></div></article>`).join('')}` : `<div class="pd-price-summary"><strong>${esc(p.bhk ? `${p.bhk} BHK` : p.kind)}</strong><span>${esc(p.area)}</span><strong>${esc(price)}</strong></div>${empty('Detailed floor plans are available on request.')}<button class="btn btn-outline" data-contact>Request floor plan</button>`}
        </section>
        <section class="detail-card pd-section" id="pd-about"><h2>About ${esc(p.title)}</h2><div class="property-description-box">${options.description || esc(p.description || 'More details available on request.')}</div></section>
        ${safeUrl(p.video_url) ? `<section class="detail-card"><h2>Property walkthrough</h2><a class="btn btn-outline" href="${esc(safeUrl(p.video_url))}" target="_blank" rel="noopener noreferrer">Watch video tour ↗</a></section>` : ''}
        <section class="detail-card pd-section" id="pd-amenities"><h2>Amenities</h2>${amenities.length ? `<div class="amenities-grid">${amenities.map(item => `<div class="amenity-item"><span class="amenity-icon" aria-hidden="true">✓</span><span>${esc(typeof item === 'string' ? item : item.name || item.title)}</span></div>`).join('')}</div>` : empty('Contact us to confirm the amenities available at this property.')}</section>
        <section class="detail-card pd-section" id="pd-location"><h2>Explore the neighbourhood</h2><p>${esc(mapQuery || 'Location available on request')}</p>${mapQuery ? `<iframe class="pd-map" title="Map search for ${esc(mapQuery)}" loading="lazy" referrerpolicy="no-referrer" src="https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed"></iframe><p class="pd-muted">Map shows a location search. Confirm the exact project entrance with our team.</p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}" target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>` : ''}
          ${proximity.length ? `<h3 class="pd-nearby-heading">Around this project</h3><div class="pd-nearby">${proximity.map(item => `<div><strong>${esc(typeof item === 'string' ? item : item.title)}</strong><span>${esc(item.time || '')}</span></div>`).join('')}</div>` : ''}
        </section>
        ${p.brochure_url ? `<section class="detail-card pd-brochure"><div><h2>Project brochure</h2><p>Request the official project PDF.</p></div><button class="btn btn-primary" data-brochure>Download brochure</button></section>` : ''}
      </main><aside class="booking-card pd-section" id="pd-enquiry"><p class="pd-eyebrow">LET’S FIND YOUR NEXT HOME</p><h2>Interested in this property?</h2><p class="pd-muted">Ask for availability, the price sheet, or a floor plan.</p>
        <form id="propertyEnquiryForm" class="booking-form"><label for="pd-name">Full name *</label><input id="pd-name" name="name" autocomplete="name" maxlength="120" required><label for="pd-phone">Phone number *</label><input id="pd-phone" name="phone" type="tel" autocomplete="tel" maxlength="30" required><label for="pd-email">Email (optional)</label><input id="pd-email" name="email" type="email" autocomplete="email" maxlength="254"><label for="pd-message">Your enquiry</label><textarea id="pd-message" name="message" maxlength="2000" rows="3" placeholder="I’d like the price sheet and available floor plans."></textarea><label class="pd-consent"><input type="checkbox" name="consent" required><span>I agree to be contacted by Vasati Properties about this enquiry. <a href="/privacy" target="_blank" rel="noopener">Privacy notice</a></span></label><button class="btn btn-primary" type="submit">Send enquiry</button><p role="status" aria-live="polite" class="pd-muted" id="pd-enquiry-status"></p></form>
        ${whatsapp ? `<a class="btn btn-outline pd-whatsapp" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hello, I’m interested in ${p.title}. Please share availability and pricing.`)}" target="_blank" rel="noopener noreferrer">Chat on WhatsApp ↗</a>` : ''}
        <details class="pd-visit"><summary>Schedule a site visit</summary><form id="scheduleVisitForm" class="booking-form"><label for="visitName">Full name *</label><input id="visitName" name="name" autocomplete="name" required><label for="visitPhone">Phone number *</label><input id="visitPhone" name="phone" type="tel" autocomplete="tel" required><label for="visitDate">Preferred visit date *</label><input id="visitDate" name="preferred_date" type="date" required><label for="visitTime">Preferred visit time (IST) *</label><input id="visitTime" name="preferred_time" type="time" required><p id="visitScheduleHelp" class="booking-help">Choose a future date and time. Complete all fields to enable scheduling.</p><button type="submit" class="btn btn-primary" id="submitLeadBtn" aria-describedby="visitScheduleHelp" disabled>Schedule Site Visit</button></form></details>
      </aside></div>
      <dialog class="pd-lightbox" aria-label="Property image viewer"><div class="pd-lightbox-toolbar"><span data-counter aria-live="polite"></span><button class="btn" data-close aria-label="Close image viewer">Close ✕</button></div><img class="pd-lightbox-image" alt=""><div class="pd-lightbox-controls"><button class="btn" data-previous aria-label="Previous image">← Previous</button><button class="btn" data-next aria-label="Next image">Next →</button></div></dialog>`;
  }
  function bind(container, p, callbacks = {}) {
    const gallery = photos(p), dialog = container.querySelector('dialog'), image = dialog.querySelector('img');
    let activeImages = gallery, imageIndex = 0, opener;
    function display() { image.src = activeImages[imageIndex].src; image.alt = activeImages[imageIndex].alt; dialog.querySelector('[data-counter]').textContent = `${imageIndex + 1} / ${activeImages.length}`; for (const button of dialog.querySelectorAll('[data-previous], [data-next]')) button.hidden = activeImages.length < 2; }
    function open(images, index, button) { if (!images.length) return; activeImages = images; imageIndex = index; opener = button; display(); dialog.showModal(); }
    function close() { dialog.close(); }
    dialog.addEventListener('close', () => opener?.focus());
    dialog.querySelector('[data-close]').addEventListener('click', close);
    const step = delta => { imageIndex = (imageIndex + delta + activeImages.length) % activeImages.length; display(); };
    dialog.querySelector('[data-previous]').addEventListener('click', () => step(-1));
    dialog.querySelector('[data-next]').addEventListener('click', () => step(1));
    dialog.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); } });
    for (const button of container.querySelectorAll('[data-photo]')) button.addEventListener('click', () => open(gallery.map((src, i) => ({ src, alt: `${p.title} photo ${i + 1}` })), Number(button.dataset.photo), button));
    for (const button of container.querySelectorAll('[data-plan-photo]')) button.addEventListener('click', () => { const plan = p.floor_plans[Number(button.dataset.planPhoto)]; open([{ src: safeUrl(plan.image), alt: `${plan.label} floor plan` }], 0, button); });
    for (const button of container.querySelectorAll('[data-plan]')) button.addEventListener('click', () => { for (const tab of container.querySelectorAll('[data-plan]')) tab.setAttribute('aria-pressed', String(tab === button)); for (const panel of container.querySelectorAll('[data-plan-panel]')) panel.hidden = panel.dataset.planPanel !== button.dataset.plan; });
    const scroll = id => container.querySelector(`#pd-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    for (const button of container.querySelectorAll('[data-section]')) button.addEventListener('click', () => scroll(button.dataset.section));
    for (const button of container.querySelectorAll('[data-contact]')) button.addEventListener('click', () => { scroll('enquiry'); container.querySelector('#pd-name').focus({ preventScroll: true }); });
    for (const button of container.querySelectorAll('[data-brochure]')) button.addEventListener('click', event => callbacks.brochure?.(event));
    const form = container.querySelector('#propertyEnquiryForm'), status = container.querySelector('#pd-enquiry-status');
    let sending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (sending || !form.reportValidity()) return;
      const fields = new FormData(form), button = form.querySelector('[type="submit"]');
      if (!String(fields.get('name')).trim() || !String(fields.get('phone')).trim()) { status.textContent = 'Enter your name and phone number.'; return; }
      sending = true; button.disabled = true; status.textContent = 'Sending your enquiry…';
      try {
        const response = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property_id: p.id, property_title: p.title, name: String(fields.get('name')).trim(), phone: String(fields.get('phone')).trim(), email: String(fields.get('email') || '').trim(), message: `${String(fields.get('message') || 'Please share availability, pricing, and floor plans.').trim()}\nCustomer agreed to be contacted about this property.`, analytics_consent: localStorage.getItem('vasati_analytics_consent') === 'accepted' }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Could not send your enquiry. Please try again.');
        form.reset(); status.textContent = 'Enquiry received. Our team will contact you shortly.'; callbacks.track?.();
      } catch (error) { status.textContent = error.message || 'Connection error. Please try again.'; }
      finally { sending = false; button.disabled = false; }
    });
  }
  const api = { render, bind, safeUrl, photos, priceLabel, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PropertyDetails = api;
})(typeof window !== 'undefined' ? window : this);
