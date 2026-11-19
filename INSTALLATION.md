# Installation

The active app runs Express with SQLite. Use Node.js 24 LTS (for `node:sqlite`), npm, and a writable data directory.

## Windows (PowerShell)

```powershell
npm ci
npm start
```

Open the website at <http://localhost:3000> and admin sign-in at <http://localhost:3000/admin>. The first local run initializes the SQLite database and starter listings. The local bootstrap administrator is `admin@example.com` / `Admin@12345`; change the password at first sign-in.

To select another port:

```powershell
$env:PORT = "3001"
npm start
```

## macOS/Linux

```sh
npm ci
npm start
```

Set `PORT=3001` to choose another port.

## Local configuration

Copy `.env.example` to `.env` and set `DATA_DIR` plus integration settings as needed. The server does not automatically load `.env`; export variables in the shell or use your process manager's environment support. For production, set `NODE_ENV=production` and a unique `ADMIN_DEFAULT_PASSWORD`; startup refuses the temporary local password.

`data/properties.db` stores SQLite data. Image uploads are written below `public/uploads/properties/`; brochures and other uploaded media are stored in the database, and legacy brochure files under `public/uploads/brochures/` are served only by the session-bound one-use download route. Keep both database and uploads on durable storage and back them up together.

## External services

- **Reverse proxy:** when the app is behind a trusted proxy, set `TRUST_PROXY_HOPS` to the exact number of proxy hops so server rate limits use the client IP. Keep it at `0` when the app is directly internet-facing; do not trust arbitrary forwarded headers.
- **Remote MCP:** configure separate random read and write tokens and expose `/mcp` through HTTPS.

Visit and brochure forms submit directly, without OTP or third-party CAPTCHA. Input validation, consent, rate limits and one-use brochure links remain enforced. Contact details are not independently verified. The admin Analytics page reads local consented event totals for 7, 30, or 90 days and refreshes every 60 seconds while visible; it does not load GA4 or a visitor map.

## Troubleshooting

- `node:sqlite` missing: upgrade to Node 24.
- `EADDRINUSE`: set an available `PORT`.
- App cannot create its database: ensure `DATA_DIR` exists and is writable.

See [COOLIFY.md](./COOLIFY.md) for deployment, persistent volume, HTTPS, backup, and remote MCP instructions.

For local password recovery, run `npm run reset-admin:local`; see README.md for the supported directory and backup behavior.
