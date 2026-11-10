# Vasati Properties

A Bengaluru property listings website with a public-facing site, property and enquiry APIs, and an admin dashboard.

## Requirements

- Node.js 24 LTS (the project uses Node's built-in `node:sqlite` module)
- npm

## Get started

```powershell
git clone https://github.com/urdigix/vasati_properties.git
cd vasati_properties
npm ci
npm start
```

Open:

- Website: <http://localhost:3000>
- Admin dashboard: <http://localhost:3000/admin>

The first run creates `data/properties.db` and initializes the SQLite schema and starter content. The `data/` directory is local application data and should not be committed.

For development, `npm run dev` also starts the Express server. To use another port in PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

## Features

- Property listings, filters, and individual property details
- Featured projects and site settings
- Enquiry submission and management APIs
- Local image and media uploads
- Admin dashboard for managing listings and enquiries

## API overview

- `GET /api/properties` and `GET /api/properties/:id`
- `POST`, `PUT`, and `DELETE /api/properties` routes
- `GET /api/featured-projects`
- `POST /api/enquiries` and admin enquiry management routes
- `GET /api/settings` and `GET /api/stats`

See [INSTALLATION.md](./INSTALLATION.md) for platform-specific setup and troubleshooting.

## Important deployment note

The admin page and administrative API routes in the current Express server do not enforce authentication. Do not expose this application or its admin endpoints to the public internet until authentication and authorization have been implemented and reviewed. Use only non-sensitive test data in local development.

The current default server uses SQLite. The repository also contains older Next.js, Prisma, and PostgreSQL-related configuration; those paths are not the default local startup flow and should not be assumed to provide production deployment parity.

## License and legal notice

No license is currently specified. Legal and compliance claims should be independently reviewed before relying on them or deploying the site.
