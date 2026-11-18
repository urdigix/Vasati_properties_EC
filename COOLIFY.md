# Coolify deployment

For separate frontend/backend configuration and isolated database/upload volumes, use the root `docker-compose.coolify.yml`; see [split deployment instructions](deploy/README.md). The original `docker-compose.yml` below remains the single-container option.

The active app is Express + Node's built-in SQLite database. The legacy Next.js/Prisma/PostgreSQL scaffolding is not used by `npm start` or this Dockerfile.

## Deploy

1. Create a Coolify Docker Compose resource from this repository's `docker-compose.yml`.
2. Attach a domain with HTTPS enabled.
3. Configure the required environment variables below in Coolify. Never reuse the local bootstrap password.
4. Deploy. The SQLite database and uploaded files live in named volumes (`app_data` and `uploads_data`) and survive container replacement. Back up both volumes before upgrades.
5. Restrict the admin URL to staff as an additional network control. The app still enforces a hashed-password login and role checks.

Required production settings:

- `ADMIN_DEFAULT_PASSWORD`: unique strong bootstrap password; startup refuses the temporary local password. If a local database is copied into production, change its password before deploying.
- `IP_HASH_SALT`: random secret used to pseudonymize analytics sessions.
- `APP_BASE_URL`: public HTTPS origin.

Optional integrations:

- Google customer OAuth is not enabled by the current Express routes; legacy environment values are not used.
- Customer OTP: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Configure SMS and email channels and a 5-minute code lifetime in Twilio Verify. OTP is not simulated; site-visit and brochure verification remain unavailable until configured.
- Bot protection: set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` for the public hostname. Both are required for public verification requests.
- Reverse proxy: the split stack defaults `TRUST_PROXY_HOPS` to `2` for Traefik → Nginx → Express. Adjust it if changing the topology; direct exposure uses `0`.
- GA4 browser tracking: `GA4_MEASUREMENT_ID` (`G-...`). The browser tag and event collection are enabled only after analytics consent.
- GA4 admin reports (optional): `GA4_PROPERTY_ID` (numeric property ID), `GA4_SERVICE_ACCOUNT_EMAIL`, and `GA4_SERVICE_ACCOUNT_PRIVATE_KEY`. Enable the Google Analytics Data API in the service account's Google Cloud project, then add the service-account email to the GA4 property's access management with Viewer permission. Store the private key only as a Coolify server secret (escaped `\n` sequences are supported); it and access tokens are never sent to the browser. The measurement ID and reporting property ID are separate settings.
- Remote MCP: set independent high-entropy `MCP_READ_TOKEN` and `MCP_WRITE_TOKEN`. Expose the endpoint only through the HTTPS domain at `/mcp`. Keep tokens server-side and grant only the needed token to each client.

## Database and storage

SQLite is appropriate for a single application instance with a persistent local volume. Do not scale this configuration horizontally without moving the data layer to a supported shared database and implementing safe concurrent migrations. Uploads are stored in the persistent `uploads_data` volume; the SQLite volume contains listings, settings, customer request metadata, sessions, and audit records. Include both volumes in backups.

## Operational checks

- Backend health check: `GET /api/health`; split frontend: `GET /healthz`.
- Administrator: `/admin`; initial local-only login is documented in `README.md`. The first successful login requires a password change.
- Configure and verify Turnstile and Twilio delivery before advertising verification forms. Without these services, WhatsApp contact remains available when a number is configured.
- Configure and verify the GA4 measurement ID and server-side reporting property separately. The dashboard uses the GA4 Realtime API for active users and the GA4 Data API for historical reports. If reporting credentials are absent, it shows a setup-required state; API failures are reported without fabricating data.
- The country map renders local country outlines and places aggregate GA4 country sessions at country-centroid positions. These are approximate country-level summaries, not exact visitor locations or individual tracking. Countries without a supported map shape are omitted.
- Review the Coolify proxy's forwarded-header and HTTPS settings. The app sets secure cookies in production.

## Remote MCP client setup

Add a remote MCP server URL of `https://your-domain.example/mcp` in a client that supports remote MCP over Streamable HTTP. Authenticate with the bearer token configured for that client. Use the read token for `properties_list`, `property_get`, and `website_content_get`. Use the separate write token only when authorized draft creation/update is needed; it cannot publish, delete, export customer records, or read personal information. Publishing and deletion remain manual admin actions. Client product-plan, workspace, and administrator approval requirements vary; check the current client-side MCP availability and policy before enabling the connection.

The endpoint uses stateless JSON-RPC over HTTPS POST (Streamable HTTP). Do not expose it over plain HTTP, commit tokens, or place tokens in browser code. Token rotation is performed by updating Coolify secrets and restarting the app.

## Important limitations

The admin dashboard reports GA4 aggregates when its server-side integration is configured; it does not identify individuals. Its summary refreshes every 60 seconds while the Analytics page is visible. The country map is approximate and uses country-centroid positions, never exact visitor locations. No email-marketing delivery provider is configured, so new subscribers receive a one-time unsubscribe link in the confirmation UI; wire an email provider before operating a mailing program.
