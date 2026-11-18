# Property details page

Every existing `/#property/<id>` link opens the property page with a gallery of up to four images, keyboard-accessible image viewer, project overview, saved floor plans and prices, and amenities. The site-visit workflow and brochure verification remain connected. Site visits are saved in the existing admin enquiries inbox after SMS verification; direct general enquiry submissions are disabled. The public Around this project section and neighbourhood map are removed.

In Admin, add or edit a property and use **Project details & floor plans** to enter the developer, RERA ID, project size, launch date, map address, possession status, and property type. Add up to 12 floor plan configurations. Each configuration has its own area, display price, and optional uploaded image or image URL. Uploads use the existing authenticated image endpoint (PNG/JPEG/WebP, maximum 8 MB). Save the property after uploading. Empty or unconfirmed values remain empty; the public page invites an enquiry instead of inventing floor plans or amenities.

## Deploy on Coolify

The split Coolify application builds `docker-compose.coolify.yml`. Deploy the reviewed release branch, preserving the existing split frontend/backend configuration and persistent database/upload volumes. Public site-visit and brochure verification require Twilio Verify and Cloudflare Turnstile credentials; see [deployment configuration](./COOLIFY.md). Application startup adds `project_details` and `floor_plans` columns to the existing properties table without deleting listings. Existing listings work immediately; add their real floor plans and project information through Admin when available. Retain the current data volume and normal database backups when redeploying.

The admin's saved map address field is retained for existing data compatibility, but the active public page does not render a map. Image sources are the property's own saved gallery. The existing four-photo gallery limit remains; floor plan images are stored separately.

## Validation

Run `npm run check` and `npm test`. Coverage includes database migration, field persistence and clearing, invalid URLs and malformed floor plans, listing-content escaping, missing data, enquiry failure/retry and duplicate-submit protection, authenticated property CRUD, public asset delivery, and enquiry storage.

Visual browser testing was skipped at the owner's request. Review desktop and mobile layout after deployment, then populate actual listing data. Housing.com content and project imagery have not been copied into Vasati listings.
