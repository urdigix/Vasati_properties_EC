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

`data/properties.db` stores SQLite data. Image uploads are written below `public/uploads/properties/`; brochures and other uploaded media are stored in the database, and legacy brochure files under `public/uploads/brochures/` are served only by the verified-download route. Keep both database and uploads on durable storage and back them up together.

## External services

- **Twilio Verify:** required for real email/SMS OTP delivery. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` in `.env`. In the Verify service settings, enable SMS and/or the email channel you intend to offer, configure its email delivery integration, and set the verification-code validity to **5 minutes**. Without these credentials, the app returns an explicit unavailable response; it never simulates delivery.
- **Cloudflare Turnstile:** required for public OTP requests. Create a widget for your site hostname, then set its public site key as `TURNSTILE_SITE_KEY` and secret as `TURNSTILE_SECRET_KEY`. Both are required for forms to send verification codes; the server validates every token and fails closed if server configuration is missing.
- **Reverse proxy:** when the app is behind a trusted proxy, set `TRUST_PROXY_HOPS` to the exact number of proxy hops so server rate limits use the client IP. Keep it at `0` when the app is directly internet-facing; do not trust arbitrary forwarded headers.
- **Google Analytics 4:** set `GA4_MEASUREMENT_ID` for consent-gated browser tracking. To enable the authenticated admin reports, also set `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_EMAIL`, and `GA4_SERVICE_ACCOUNT_PRIVATE_KEY` on the server. Enable the Google Analytics Data API in Google Cloud and grant the service account Viewer access to the GA4 property. Never put its private key in frontend code.
- **Remote MCP:** configure separate random read and write tokens and expose `/mcp` through HTTPS.

The admin Analytics page separates GA4 Realtime active users from historical active users, sessions, and page views. It refreshes while visible every 60 seconds. Country markers use aggregate country sessions and country-centroid positions only; they are not exact visitor locations or individual tracking. If the reporting integration is not configured, the page displays setup instructions and does not invent metrics.

## Troubleshooting

- `node:sqlite` missing: upgrade to Node 24.
- `EADDRINUSE`: set an available `PORT`.
- App cannot create its database: ensure `DATA_DIR` exists and is writable.
- OTP delivery or security check is unavailable: configure Twilio Verify and Cloudflare Turnstile as described above; there is no development OTP or CAPTCHA bypass.

See [COOLIFY.md](./COOLIFY.md) for deployment, persistent volume, HTTPS, backup, and remote MCP instructions.
