# Technical SEO deployment

The active Express app serves server-rendered property content and metadata. No Next.js build is required.

## Staging and local development

Keep `SEO_INDEXABLE=false` (the default). Every response has an `X-Robots-Tag: noindex, nofollow` header, public HTML has matching robots metadata, and the sitemap contains no URLs. Robots are allowed to crawl so they can read the noindex directive. Protect staging with hosting-level authentication as well; noindex is not access control.

## Public production

Set these in the hosting environment, then redeploy:

```dotenv
APP_BASE_URL=https://your-real-domain.example
SITE_URL=https://your-real-domain.example
SEO_INDEXABLE=true
```

Replace the example domain with the actual public HTTPS origin, without a path. `SITE_URL` defaults to `APP_BASE_URL`. Localhost remains noindex even if indexing is enabled. The app does not load `.env` automatically; use your deployment's environment configuration or an explicit Node environment-file option.

Configure your reverse proxy to redirect HTTP and alternate domain names to the chosen HTTPS domain. Canonical metadata uses the configured origin, never the request Host header.

Check the homepage and a property URL after deployment:

- Public pages return 200, contain their own title/description/canonical and have no `X-Robots-Tag: noindex` header.
- `/robots.txt` references the production sitemap.
- `/sitemap.xml` includes the homepage and only published properties.
- Unknown pages and unpublished property URLs return 404.
- Admin, API, authentication and demo pages remain noindex. Published property photos remain available for image indexing.

Verify the domain in Google Search Console, submit `/sitemap.xml`, and inspect the rendered homepage and representative property pages. Validate structured data with Google's Rich Results Test and check mobile performance with PageSpeed Insights. Organization and breadcrumb markup does not guarantee a rich result.

## Content and URLs

Homepage title and description use the existing admin Site Settings fields. Property titles/descriptions, prices, locations and photos use saved listing data. Publish only accurate, original listing content; replace sample listings before enabling production indexing.

Property URLs use `/properties/:id/:title-slug`. Short IDs and outdated slugs redirect permanently to the current canonical URL. Old `/#property/:id` bookmarks are migrated in the browser because fragments are not sent to the server. New cards use normal anchor links. The initial HTML contains property content and homepage listing links even before JavaScript runs.

No locality pages, customer reviews, ratings, office addresses or project approvals are invented. Add locality guides when verified content is available. Social preview images use the property's main image or the site logo; provide a suitable public landscape image for best previews.

The existing brochure-consent link points to `/privacy`, but this project currently has no privacy page. That URL now correctly returns 404 instead of displaying the homepage. Supply a reviewed privacy notice before launch.

Measure organic enquiries and qualified site visits alongside Search Console clicks, impressions and indexing. Search Console ownership, DNS, production redirects, and external business profiles require access to those services and are not configured by this code change.

## Verification

Run `npm test` and `npm run check`. SEO tests cover production/staging indexing, published-only URLs, redirects, missing pages, metadata escaping and canonical origin safety.
