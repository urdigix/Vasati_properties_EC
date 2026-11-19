# Coolify deployment

The active app is Express + Node's built-in SQLite database. The legacy Next.js/Prisma/PostgreSQL scaffolding is not used by `npm start` or this Dockerfile.

## Replace the existing Vasati production application

Use `docker-compose.coolify.yml` for the existing Vasati Coolify resource. Its `frontend` service runs Nginx and routes requests to the Express `backend`, including property pages, APIs, uploads and the admin portal. It retains the existing public and admin hostnames and Traefik routing. Set the resource's Compose file path to this file and deploy the selected repository branch.

Keep the existing `database_data` and `uploaded_media` volumes attached under the same Coolify resource. They mount at `/app/data` and `/app/storage/uploads`; `UPLOADS_DIR=/app/storage/uploads` makes Express serve the existing uploaded media. Do not recreate the resource or remove its volumes during replacement. Back up both volumes before deployment.

The production Compose file enables `BACKUP_BEFORE_MIGRATION=true`. On the first upgrade of an existing database, before migration writes, the app uses SQLite `VACUUM INTO` to create a consistent `properties-before-practice-*.db` snapshot in `DATA_DIR`. It records migration `practice-overview-2d-v1` on completion, so successful later starts do not repeat the snapshot. Snapshot failure prevents startup. This database snapshot does not replace a backup of uploaded media.

Production defaults are `SITE_URL=https://vasatiproperties.com` and `SEO_INDEXABLE=true`. Keep `APP_BASE_URL` set to the public HTTPS origin. Override indexing to `false` for any preview deployment; see [SEO.md](./SEO.md).

## New installation

1. For a new installation, create a Coolify Docker Compose resource from this repository's `docker-compose.yml`.
2. Attach a domain with HTTPS enabled.
3. Configure the required environment variables below in Coolify. Never reuse the local bootstrap password.
4. Deploy. The SQLite database and uploaded files live in named volumes (`app_data` and `uploads_data`) and survive container replacement. Back up both volumes before upgrades.
5. Restrict the admin URL to staff as an additional network control. The app still enforces a hashed-password login and role checks.

Required production settings:

- `ADMIN_DEFAULT_PASSWORD`: unique strong bootstrap password; startup refuses the temporary local password. If a local database is copied into production, change its password before deploying.
- `IP_HASH_SALT`: random secret used to pseudonymize analytics sessions.
- `APP_BASE_URL`: public HTTPS origin.

Optional integrations:

- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` (`https://your-domain/auth/google/callback`). Register the exact redirect URI in Google Cloud.
- Customer OTP: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Configure SMS and email channels and a 10-minute code lifetime in Twilio Verify. OTP is not simulated; brochure verification returns an explicit unavailable error until configured.
- GA4 browser tracking: `GA4_MEASUREMENT_ID` (`G-...`). The browser tag and event collection are enabled only after analytics consent.
- GA4 admin reports (optional): `GA4_PROPERTY_ID` (numeric property ID), `GA4_SERVICE_ACCOUNT_EMAIL`, and `GA4_SERVICE_ACCOUNT_PRIVATE_KEY`. Enable the Google Analytics Data API in the service account's Google Cloud project, then add the service-account email to the GA4 property's access management with Viewer permission. Store the private key only as a Coolify server secret (escaped `\n` sequences are supported); it and access tokens are never sent to the browser. The measurement ID and reporting property ID are separate settings.
- Remote MCP: set independent high-entropy `MCP_READ_TOKEN` and `MCP_WRITE_TOKEN`. Expose the endpoint only through the HTTPS domain at `/mcp`. Keep tokens server-side and grant only the needed token to each client.

## Database and storage

SQLite is appropriate for a single application instance with a persistent local volume. Do not scale this configuration horizontally without moving the data layer to a supported shared database and implementing safe concurrent migrations. The SQLite volume contains listings, settings, customer request metadata, sessions, and audit records. Include both database and upload volumes in backups. New installations use `app_data` and `uploads_data`; the existing production resource keeps `database_data` and `uploaded_media`. `UPLOADS_DIR` configures the upload directory; its default is `public/uploads` within the application.

## Rollback

The upgrade preserves legacy database columns and copies legacy project details into missing overview fields. Keep the database and media volumes in place for an application rollback. The previous production source is branch `codex/admin-subdomain-2026-11-18`, commit `5d49140996040bf585c0a8c3eb660b3e1f2af3b2`; redeploy that revision with its previous Compose configuration if the replacement fails.

Restore a pre-migration database snapshot only when needed, as a separate manual recovery step. Stop application writes first, preserve the current database and its SQLite sidecar files, then restore the selected snapshot while the application is stopped. Verify ownership and restart with the intended source revision. Restoring discards changes made after the snapshot, so do not overwrite the live database automatically. Restore uploaded media separately only if necessary.

## Operational checks

- Backend health check: `GET /api/health` returns `{"status":"ok"}` after a database query. The frontend container's `GET /healthz` checks Nginx; check `/api/health` through the public domain to verify both services.
- Administrator: `/admin`; initial local-only login is documented in `README.md`. The first successful login requires a password change.
- Configure and verify OAuth callback and Twilio delivery before advertising those workflows.
- Configure and verify the GA4 measurement ID and server-side reporting property separately. The dashboard uses the GA4 Realtime API for active users and the GA4 Data API for historical reports. If reporting credentials are absent, it shows a setup-required state; API failures are reported without fabricating data.
- The country map renders local country outlines and places aggregate GA4 country sessions at country-centroid positions. These are approximate country-level summaries, not exact visitor locations or individual tracking. Countries without a supported map shape are omitted.
- Review the Coolify proxy's forwarded-header and HTTPS settings. The app sets secure cookies in production.

## Remote MCP client setup

Add a remote MCP server URL of `https://your-domain.example/mcp` in a client that supports remote MCP over Streamable HTTP. Authenticate with the bearer token configured for that client. Use the read token for `properties_list`, `property_get`, and `website_content_get`. Use the separate write token only when authorized draft creation/update is needed; it cannot publish, delete, export customer records, or read personal information. Publishing and deletion remain manual admin actions. Client product-plan, workspace, and administrator approval requirements vary; check the current client-side MCP availability and policy before enabling the connection.

The endpoint uses stateless JSON-RPC over HTTPS POST (Streamable HTTP). Do not expose it over plain HTTP, commit tokens, or place tokens in browser code. Token rotation is performed by updating Coolify secrets and restarting the app.

## Important limitations

The admin dashboard reports GA4 aggregates when its server-side integration is configured; it does not identify individuals. Its summary refreshes every 60 seconds while the Analytics page is visible. The country map is approximate and uses country-centroid positions, never exact visitor locations. No email-marketing delivery provider is configured, so new subscribers receive a one-time unsubscribe link in the confirmation UI; wire an email provider before operating a mailing program.
