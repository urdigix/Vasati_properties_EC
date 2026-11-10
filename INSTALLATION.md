# Installation

This guide covers running the current Express + SQLite application locally. The default server entry point is `server.js`; a PostgreSQL service and Prisma setup are not required for this local workflow.

## Prerequisites

- Node.js 24 LTS
- npm (bundled with Node.js)
- Git

The app uses Node's built-in `node:sqlite` module, so use a Node version that provides it. Node.js 24 is the recommended runtime.

## Windows (PowerShell)

1. Install Node.js 24 LTS from <https://nodejs.org/>.
2. Clone the repository and enter its folder:

   ```powershell
   git clone https://github.com/urdigix/vasati_properties.git
   cd vasati_properties
   ```

3. Install the locked dependencies:

   ```powershell
   npm ci
   ```

4. Start the server:

   ```powershell
   npm start
   ```

5. Visit <http://localhost:3000>. The dashboard is at <http://localhost:3000/admin>.

To select a different port in PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

## macOS and Linux

Install Node.js 24 LTS and Git using your preferred installer, then run:

```sh
git clone https://github.com/urdigix/vasati_properties.git
cd vasati_properties
npm ci
npm start
```

Open <http://localhost:3000>. To use a different port:

```sh
PORT=3001 npm start
```

## Development

Run the same Express server with:

```sh
npm run dev
```

Stop the server with `Ctrl+C`.

## Database and uploads

On startup, the application creates the `data/` directory, initializes `data/properties.db`, and inserts starter settings and sample listings when needed. Image uploads are written under `public/uploads/properties/`; other uploaded media is stored in the SQLite database.

These are local runtime data, not source files. Back up the database and uploaded files before removing or replacing them. Do not commit real customer information, production database files, or uploaded customer media.

The current server does not require an `.env` file for local startup. `PORT` is the supported server setting.

## Troubleshooting

- **`node:sqlite` is unavailable:** confirm `node --version` reports Node.js 24 LTS, then retry.
- **Port 3000 is already in use:** set `PORT` to an available port as shown above.
- **The site loads but no listings appear:** check the server console for startup errors and confirm the process can write to the project directory so it can create the SQLite database.
- **Dependency installation fails:** use `npm ci` with the repository's `package-lock.json`; do not mix package managers in the same install.

## Before deployment

The current admin page and administrative API endpoints do not enforce authentication. Do not make the application publicly accessible until authentication and authorization have been added and security-reviewed. Also review the repository's older Docker, Next.js, Prisma, and PostgreSQL files separately; they do not describe the default SQLite-backed local startup path.
