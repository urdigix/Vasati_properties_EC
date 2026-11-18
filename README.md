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

Copy `.env.example` to `.env` to configure local integrations. No OTP is simulated. Site-visit and brochure verification require Twilio Verify and Cloudflare Turnstile; without their credentials, requests remain unavailable and verification is never bypassed.

## Current functionality

- Public property listings, search, property details, carousel, responsive layouts, and editable site settings.
- Session-authenticated admin pages and mutation endpoints, hashed passwords, rate-limited login, first-login password change, and audit entries.
- Draft/publish controls; unpublished properties are excluded from public listing and detail APIs.
- Property image galleries with a maximum of four images enforced by the browser and database layer. Uploads accept JPEG, PNG, and WebP up to 8 MB and are resized/re-encoded to WebP.
- PDF/media upload, admin-side brochure editing, and one-time, short-lived brochure links after contact consent and successful Twilio Verify OTP. Direct public brochure paths are blocked.
- Session-bound SMS verification for site visits, with future date/time validation in IST; public enquiries are created only after verification. Google customer OAuth is not enabled by the current Express routes.
- Subscriber consent, deduplication, search/filter, unsubscribe tokens, and confirmation-gated CSV export.
- Editable social destinations; unconfigured links are hidden. Optional WhatsApp contact buttons hide if no number is configured.
- Consent-gated GA4 tag plus first-party anonymous event summaries.
- Authenticated `/mcp` endpoint with read-only and draft-write bearer scopes.

See [INSTALLATION.md](./INSTALLATION.md), [COOLIFY.md](./COOLIFY.md), [property editing](./PROPERTY-DETAILS.md), and [UI components](./UI-COMPONENTS.md).

## API/security notes

- Public: `GET /api/properties`, `GET /api/properties/:id`, `GET /api/featured-projects`, and public settings.
- Admin writes and customer data routes require the admin session. Admin endpoints are not protected by an obscure URL.
- Brochure OTP routes: `/api/brochures/verification/start`, `/resend`, and `/complete`. Download tokens expire after five minutes and are single-use.
- Subscriber exports require explicit confirmation and are audit logged.
- MCP tools never return customer PII and cannot publish or delete properties.

## Required owner setup for production

Configure a unique admin bootstrap password, HTTPS, persistent Coolify volumes, and regular backups. Configure Twilio Verify SMS/email channels and Cloudflare Turnstile before using the public verification forms; configure a GA4 measurement ID if analytics is to be used. Generate separate random MCP read/write tokens. Do not expose secrets in public code or commit `.env`.

When server-side GA4 credentials are configured, the analytics page reports GA4 Realtime active users, historical metrics, and approximate country-level sessions on a map. It refreshes every 60 seconds while visible and shows setup instructions when credentials are absent. Country markers are aggregate centroids, not individual visitor locations. Subscriber confirmation provides an unsubscribe link in the page; configure an email delivery provider before running a marketing campaign.

No license is currently specified. Legal/compliance statements must be reviewed by qualified counsel before relying on them.
