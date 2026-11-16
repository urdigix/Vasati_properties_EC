# Vasati Properties public interface

Apply to the active Express/HTML frontend in `public/`. The Next.js scaffold is inactive.

## Direction

Preserve the existing Vasati logo, blue primary actions, gold brand accents and Plus Jakarta Sans typography. Use white surfaces, a neutral page background, clear boundaries and property photography. Keep listing facts and CMS text intact.

UI UX Pro Max's `property listing search --domain product` matched **Directory / Listing Site**, recommending a filter-heavy grid, neutral backgrounds and category chips. This is a closer fit than its initial broad real-estate suggestion of Glassmorphism. Avoid adding blur, a new font family or speculative claims to property listings.

## Discovery and hierarchy

- Hero: CMS-controlled title and introduction, followed by a visible search form.
- Search: locality, property category, bedrooms and maximum budget, using the existing API contracts. Budget values are in lakh.
- Shortcuts: Bengaluru localities; selection must remain visible in the search field.
- Featured projects: show only when the API provides projects.
- Collection: clear results count, sorting and a reset action; property title links work with a keyboard.

## Interaction and accessibility

- Label every field; reserve placeholders for examples.
- Interactive controls have at least 44px targets and visible focus indicators.
- Announce loading, result counts and failures. A failure offers retry.
- Cancel obsolete searches so an earlier response cannot replace the current results.
- Pause the carousel on hover and keyboard focus. Provide a persistent pause/play control, disable autoplay for reduced motion, and make offscreen slides inert.
- Prefer SVG or text labels over decorative emoji in navigation and featured-project metadata.
- Use dark green for WhatsApp buttons to retain readable white text.
- Preserve reduced-motion preferences for animations and programmatic scrolling.

## Responsive behavior

Desktop search uses a single row. Tablet and mobile use two columns with a full-width locality field. Controls remain readable at 16px on mobile, localities wrap, and cards reflow without horizontal page scrolling. Validate at 375, 768, 1024 and 1440px.

## Deployment

Coolify uses `docker-compose.coolify.yml`. Public HTML and its stylesheet ship together in the Nginx frontend image. Keep the existing proxy, backend settings and persistent database/upload volumes.
