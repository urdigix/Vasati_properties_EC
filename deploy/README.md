# Split Coolify deployment

Select `docker-compose.coolify.yml` from the repository root, with base directory `/`.

## Existing VPS proxy

This VPS has an existing host-network Traefik container, `traefik-traefik-1`, listening on ports 80/443 with entrypoints `web`/`websecure` and certificate resolver `letsencrypt`. The frontend's explicit `vasati-ec-public` router uses those names. Its Docker provider discovers the frontend labels; the host-network proxy can reach the frontend's bridge address. HTTP-to-HTTPS redirection is already configured on that proxy. Do not start a second Coolify proxy on the same ports or stop the existing proxy used by other services.

`PUBLIC_HOST` defaults to the deployment's temporary sslip.io hostname. If changing domains, update both `PUBLIC_HOST` and `APP_BASE_URL`, plus the frontend domain in Coolify, then redeploy. Only the frontend is enabled in Traefik. The backend has `traefik.enable=false` and is reached through the frontend on the private Compose network. On another server, adjust the router entrypoint and certificate resolver to that server's actual proxy configuration.

- `deploy/frontend/`: Nginx frontend image and routing configuration. Attach the public HTTPS domain to this service, port 80, only.
- `deploy/backend/`: Node 24 backend image. Port 3000 is internal; do not attach a public domain or host port. Admin authorization and brochure access remain in Express.
- `db/`: active SQLite database layer. The `database_data` named volume mounts at `/app/data`, containing `properties.db`. SQLite runs inside the backend process, not as an unused PostgreSQL container. Keep one backend replica.
- `uploaded_media`: separate named volume at `/app/storage/uploads`. Admin images go into `properties/`; legacy brochures may go into `brochures/`. Public image URLs remain `/uploads/properties/...`; brochure URLs stay protected by Express. This storage is separate from the frontend's bundled `/images` branding assets. The frontend cannot write to either data volume.

Set `APP_BASE_URL` to the frontend HTTPS origin, `ADMIN_DEFAULT_PASSWORD` to a unique bootstrap secret, `ADMIN_DEFAULT_EMAIL` to the administrator email, and `IP_HASH_SALT` to a random secret. Never commit secrets. Optional GA4/OAuth/Twilio variables are passed only to the backend. Initial sign-in requires a password change.

Health checks: frontend `/healthz`; backend `/api/health` also verifies a database query. Do not publish backend port 3000. Coolify terminates TLS and forwards the original Host and scheme through Nginx, keeping authentication requests on the same origin.

Both volumes survive deployments. Deleting a resource with volume deletion selected destroys their data. Back up both: stop backend writes briefly before copying the SQLite directory (or use SQLite's online backup API) and back up uploaded media alongside it. A redeploy is not a backup. No backup destination is configured by this Compose file.

This split deployment starts a fresh database unless an existing SQLite database is deliberately restored. It does not migrate legacy Prisma/PostgreSQL schemas. Backend still contains protected admin templates and a static fallback for compatibility; the public landing page and branding assets are served by the separate frontend.
