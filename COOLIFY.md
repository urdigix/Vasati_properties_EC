# Coolify deployment

See [SCALING.md](./SCALING.md) for traffic optimizations, load checks, WAL backup requirements and the single-instance constraint.

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
- Remote MCP: set independent high-entropy `MCP_READ_TOKEN` and `MCP_WRITE_TOKEN`. Expose the endpoint only through the HTTPS domain at `/mcp`. Keep tokens server-side and grant only the needed token to each client.

## Database and storage

SQLite is appropriate for a single application instance with a persistent local volume. Do not scale this configuration horizontally without moving the data layer to a supported shared database and implementing safe concurrent migrations. The SQLite volume contains listings, settings, customer request metadata, sessions, and audit records. Include both database and upload volumes in backups. New installations use `app_data` and `uploads_data`; the existing production resource keeps `database_data` and `uploaded_media`. `UPLOADS_DIR` configures the upload directory; its default is `public/uploads` within the application.

## Rollback

The upgrade preserves legacy database columns and copies legacy project details into missing overview fields. Keep the database and media volumes in place for an application rollback. The previous production source is branch `codex/admin-subdomain-2026-11-18`, commit `5d49140996040bf585c0a8c3eb660b3e1f2af3b2`; redeploy that revision with its previous Compose configuration if the replacement fails.

Restore a pre-migration database snapshot only when needed, as a separate manual recovery step. Stop application writes first, preserve the current database and its SQLite sidecar files, then restore the selected snapshot while the application is stopped. Verify ownership and restart with the intended source revision. Restoring discards changes made after the snapshot, so do not overwrite the live database automatically. Restore uploaded media separately only if necessary.

## Operational checks

- Backend health check: `GET /api/health` returns `{"status":"ok"}` after a database query. The frontend container's `GET /healthz` checks Nginx; check `/api/health` through the public domain to verify both services.
- Administrator: `/admin`; initial local-only login is documented in `README.md`. The first successful login requires a password change.
- Review the Coolify proxy's forwarded-header and HTTPS settings. The app sets secure cookies in production.

## Remote MCP client setup

Add a remote MCP server URL of `https://your-domain.example/mcp` in a client that supports remote MCP over Streamable HTTP. Authenticate with the bearer token configured for that client. Use the read token for `properties_list`, `property_get`, and `website_content_get`. Use the separate write token only when authorized draft creation/update is needed; it cannot publish, delete, export customer records, or read personal information. Publishing and deletion remain manual admin actions. Client product-plan, workspace, and administrator approval requirements vary; check the current client-side MCP availability and policy before enabling the connection.

The endpoint uses stateless JSON-RPC over HTTPS POST (Streamable HTTP). Do not expose it over plain HTTP, commit tokens, or place tokens in browser code. Token rotation is performed by updating Coolify secrets and restarting the app.

## Important limitations

The admin dashboard reports consented local event totals, not unique visitors or locations, and refreshes every 60 seconds while its Analytics tab is visible. The application no longer uses Twilio OTP, Turnstile verification, or GA4. Visit and brochure requests submit directly with contact validation, consent and rate limits; supplied contacts are not independently verified. No email-marketing delivery provider is configured, so new subscribers receive an unsubscribe link in the confirmation UI; wire an email provider before operating a mailing program. Old provider environment variables are no longer read by the active app. Existing customer request history is retained.
