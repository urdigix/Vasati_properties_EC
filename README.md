# Vasati Properties

Bengaluru real-estate listings website and admin portal. The default application is Express + SQLite (`server.js`), with static responsive pages under `public/`. The older Next.js, Prisma, and PostgreSQL files are legacy scaffolding and are not used by the default start or Coolify Docker deployment.

## Run locally

Requirements: Node.js 24 LTS and npm.

```powershell
npm ci
npm start
```

Open <http://localhost:3000>. Admin sign-in: <http://localhost:3000/admin>.

The first local start creates `data/properties.db` and seeds the sample properties plus a hashed, temporary admin account:

- Email: `admin@example.com`
- Password: `Admin@12345`

Change this password at first sign-in. These credentials are for local development only. Production refuses the temporary password; configure a unique `ADMIN_DEFAULT_PASSWORD` in Coolify. Never reuse the local database/password in production.

Copy `.env.example` to `.env` to configure local integrations. No OTP is simulated. Until Twilio Verify is configured, brochure verification returns a clear configuration error.

## Current functionality

- Public property listings, search, property details, carousel, responsive layouts, and editable site settings.
- Session-authenticated admin pages and mutation endpoints, hashed passwords, rate-limited login, first-login password change, and audit entries.
- Draft/publish controls; unpublished properties are excluded from public listing and detail APIs.
- Property image galleries with a maximum of four images enforced by the browser and database layer. Uploads accept JPEG, PNG, and WebP up to 8 MB and are resized/re-encoded to WebP.
- PDF/media upload, admin-side brochure editing, and one-time, short-lived brochure links after contact consent and successful Twilio Verify OTP. Direct public brochure paths are blocked.
- Optional Google OAuth customer sign-in. OAuth establishes an account session only; it does not replace the required OTP verification step for brochure downloads.
- Subscriber consent, deduplication, search/filter, unsubscribe tokens, and confirmation-gated CSV export.
- Editable social destinations; unconfigured links are hidden. Optional WhatsApp contact buttons hide if no number is configured.
- Consent-gated GA4 tag plus first-party anonymous event summaries.
- Authenticated `/mcp` endpoint with read-only and draft-write bearer scopes.

See [INSTALLATION.md](./INSTALLATION.md) and [COOLIFY.md](./COOLIFY.md).

Technical SEO setup and production indexing checklist: [SEO.md](./SEO.md). Indexing is disabled by default; configure the public canonical origin and set `SEO_INDEXABLE=true` only on production.

Manage the public search dropdown under **Admin → Site Content & Settings → Search dropdown locations**. Add, edit, or delete names, then click **Save All Changes**. The initial list is Electronic City Phase 1, Electronic City Phase 2, and Chandhapura. Property forms suggest the saved names; changing a dropdown name does not rename existing property records.

Each property has optional **Project overview** fields under **Admin → Properties CMS → Add/Edit Property**. Set units, area unit/range, project size, launch month, average price, possession, configurations and RERA details. Save the property to update its overview card. RERA “Know More” appears only when a valid HTTP(S) details URL is provided; the app does not infer RERA approval or exemption. Blank fields use existing listing data where available or show “Not listed”. Share and Save use the existing property actions; Ask For Details focuses the enquiry form.

Under the same property form, **2D floor plans and pricing** supports up to 30 configuration/area options, each with a 2D image, price label and optional room dimensions. Add/edit/remove options and rooms, then save the property. Upload JPEG, PNG or WebP drawings up to 8 MB; these are separate from gallery photos, re-encoded as WebP at up to 4000 × 4000 pixels without enlargement. The public viewer groups configurations and area options and supports keyboard tab navigation, zoom from 100% to 300%, scrolling and reset. It has no 3D mode. Listings without plans show an enquiry action; no sample plans or prices are added to live records.

## API/security notes

- Public: `GET /api/properties`, `GET /api/properties/:id`, `GET /api/featured-projects`, and public settings.
- Admin writes and customer data routes require the admin session. Admin endpoints are not protected by an obscure URL.
- Brochure OTP routes: `/api/brochures/verification/start`, `/resend`, and `/complete`. Download tokens expire after five minutes and are single-use.
- Subscriber exports require explicit confirmation and are audit logged.
- MCP tools never return customer PII and cannot publish or delete properties.

## Required owner setup for production

Configure a unique admin bootstrap password, HTTPS, persistent Coolify volumes, and regular backups. Configure Google OAuth credentials and its exact HTTPS callback, Twilio Verify SMS/email channels, and a GA4 measurement ID if those integrations are to be used. Generate separate random MCP read/write tokens. Do not expose secrets in public code or commit `.env`.

The analytics page currently reports anonymous first-party events, not a GA4 live map. It clearly says location is unavailable and that refreshes occur every 60 seconds. Visitor geolocation/GA4 Data API integration and email marketing delivery are not configured. Subscriber confirmation provides an unsubscribe link in the page; configure an email delivery provider before running a marketing campaign.

No license is currently specified. Legal/compliance statements must be reviewed by qualified counsel before relying on them.
