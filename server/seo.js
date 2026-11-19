const fs = require('node:fs');
const path = require('node:path');
const { readSearchLocalities } = require('./search-localities');
const propertyOverview = require('../public/property-overview');
const floorPlans = require('../public/floor-plans');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'property';
const propertyPath = p => `/properties/${encodeURIComponent(p.id)}/${slug(p.title)}`;

function installSeo(app, db, env = process.env) {
  // Never derive canonical URLs from an untrusted Host header.
  const configured = env.SITE_URL || env.APP_BASE_URL;
  const site = new URL(configured || `http://localhost:${env.PORT || 3000}`);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('SITE_URL must be an HTTP(S) origin without a path, credentials, query, or fragment.');
  }
  const origin = site.origin;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  const indexable = env.SEO_INDEXABLE === 'true' && !local;
  const template = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const absolute = value => {
    try {
      const url = new URL(value, origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };

  app.use((req, res, next) => {
    if (!indexable || /^\/(?:admin(?:[-/.]|$)|api(?:\/|$)|auth(?:\/|$)|mcp(?:\/|$)|unsubscribe(?:\.|\/|$)|component-demos(?:\/|$))/.test(req.path)) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  function render(property) {
    const settings = db.getSiteSettings();
    const title = property ? `${property.title} | ${property.locality || property.location || 'Bengaluru'} | Vasati Properties` : (settings.seo_title || 'Vasati Properties | Bengaluru Homes');
    const description = property
      ? [property.description || property.title, property.location, property.price_label, property.area].filter(Boolean).map(value => String(value).trim().replace(/[.\s]+$/, '')).join('. ')
      : (settings.seo_description || 'Explore residential property listings in Bengaluru with Vasati Properties.');
    const canonical = origin + (property ? propertyPath(property) : '/');
    const image = absolute(property?.image || '/images/logo.png');
    const organization = { '@type': 'Organization', '@id': `${origin}/#organization`, name: 'Vasati Properties', url: `${origin}/`, logo: `${origin}/images/logo.png` };
    if (settings.contact_phone) organization.telephone = settings.contact_phone;
    if (settings.contact_email) organization.email = settings.contact_email;
    const graph = [organization, { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: 'Vasati Properties', publisher: { '@id': organization['@id'] } }];
    if (property) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: property.title, item: canonical }
    ] });
    const metadata = `<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, nofollow'}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Vasati Properties">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
    let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
      .replace('<!-- Search locality options -->', () => readSearchLocalities(settings.search_localities).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(''))
      .replace(/<meta id="metaDescription"[^>]*>/, () => `<meta id="metaDescription" name="description" content="${escapeHtml(description)}">`)
      .replace('</head>', () => `${metadata}\n</head>`);
    if (property) {
      const imageHtml = image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(property.title)}" style="max-width:100%;max-height:480px;object-fit:cover" fetchpriority="high">` : '';
      const content = `<article><nav aria-label="Breadcrumb"><a href="/">Home</a> / <span aria-current="page">${escapeHtml(property.title)}</span></nav><h1>${escapeHtml(property.title)}</h1>${imageHtml}<p>${escapeHtml(property.location)}</p><p>${escapeHtml(property.price_label || 'Contact for price')}</p><dl><dt>Bedrooms</dt><dd>${escapeHtml(property.bhk)} BHK</dd><dt>Area</dt><dd>${escapeHtml(property.area)}</dd><dt>Property type</dt><dd>${escapeHtml(property.kind)}</dd><dt>Possession</dt><dd>${escapeHtml(property.possession)}</dd></dl><p>${escapeHtml(property.description)}</p></article>`;
      html = html.replace('<div id="homeSurface">', '<div id="homeSurface" style="display:none">')
        .replace('<main class="wrap" id="propertyDetailView">', '<main class="wrap active" id="propertyDetailView">')
        .replace('<div id="propertyDetailContent"></div>', () => `<div id="propertyDetailContent">${content}${propertyOverview.render(property, { interactive: false })}${floorPlans.render(property)}</div>`)
        .replace(/href="#/g, 'href="/#');
    } else {
      const cards = db.getAllProperties().map(p => {
        const image = absolute(p.image || '');
        const photo = p.image && image ? `<div class="card-photo-wrap"><img src="${escapeHtml(image)}" alt="${escapeHtml(p.title)}" loading="lazy"></div>` : '';
        return `<article class="property-card">${photo}<div class="card-body"><h3 class="card-title"><a href="${escapeHtml(propertyPath(p))}">${escapeHtml(p.title)}</a></h3><p>${escapeHtml(p.location)}</p><p>${escapeHtml(p.price_label || 'Contact for price')} · ${escapeHtml(p.bhk)} BHK · ${escapeHtml(p.area)}</p></div></article>`;
      }).join('');
      html = html.replace('<!-- Dynamically rendered property cards -->', () => cards);
    }
    return html;
  }

  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(indexable
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nAllow: /\n# Indexing is disabled with X-Robots-Tag and HTML robots metadata.\n'));
  app.get('/sitemap.xml', (_req, res) => {
    const urls = indexable ? ['/', ...db.getAllProperties().map(propertyPath)] : [];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escapeHtml(origin + url)}</loc></url>`).join('')}</urlset>`);
  });
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  app.get('/', (_req, res) => res.type('html').send(render()));
  app.get(['/properties/:id', '/properties/:id/:slug'], (req, res, next) => {
    const property = db.getPropertyById(req.params.id);
    if (!property) return next();
    const canonicalPath = propertyPath(property);
    if (req.path !== canonicalPath) return res.redirect(301, canonicalPath);
    res.type('html').send(render(property));
  });
}

function notFound(_req, res) {
  res.status(404).set('X-Robots-Tag', 'noindex, nofollow').type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | Vasati Properties</title></head><body><main><h1>Page not found</h1><p>This page is unavailable.</p><a href="/">Browse available properties</a></main></body></html>');
}

module.exports = { installSeo, notFound, propertyPath };
