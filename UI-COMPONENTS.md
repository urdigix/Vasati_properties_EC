# React UI components

The running website uses Express and HTML. Existing Next.js files are legacy
scaffolding; this integration does not switch the website to Next.js.

## Component and style locations

- Canonical React components: `src/components/ui/`, as configured by
  `components.json` and the TypeScript `@/*` alias.
- Root `components/ui/` contains compatibility exports, including
  `rainbow-borders-button.tsx`. Keep reusable UI in this predictable folder
  structure so imports and shadcn-generated components remain consistent.
- Existing React global styles: `src/app/globals.css`.
- Active website button styles: the original inline styles in each HTML page.
  The rainbow effect is confined to the standalone React demo.
- Responsive layout refinements: `public/site-responsive.css`,
  `public/admin-responsive.css`, and `public/forms-responsive.css`.
- React demo: `src/demos/rainbow-button/demo.tsx`.

The supplied component has no props, state, providers, hooks, images, or icons.
Its full-screen wrapper and rainbow visual treatment are kept for the demo only.
The website uses its normal button styles, dimensions, and actions.
The demo uses a standard, namespaced `<style>` instead of Next-only `style jsx`.
Both implementations respect reduced motion and retain keyboard focus indicators.

## Build and preview

```powershell
npm ci
npm run typecheck:ui
npm run build:ui
npm start
```

Open `http://localhost:3000/component-demos/rainbow-button.html` for the React demo,
or `http://localhost:3000/` for the website. `npm run build` runs the existing server
checks, checks the new TypeScript UI, and regenerates the demo assets.
Generated JS/CSS under `public/component-demos/` is included so the existing
production Docker image can serve the demo without development dependencies.

React, React DOM, TypeScript, Tailwind CSS 3, PostCSS, Autoprefixer, and esbuild
are declared in `package.json`. Tailwind 3 matches the existing configuration.
The shared `cn` helper uses `clsx` and `tailwind-merge`.

## shadcn setup

This repository already has `components.json`, `tailwind.config.ts`, TypeScript
aliases, and the UI folders. The rainbow component needs no shadcn primitives.
Do not run `init` over the existing site just to use this button.

If you want a new, fully framework-managed React/shadcn app instead of this
Express integration, create a separate project using the interactive CLI:

```powershell
npx shadcn@latest init
```

Choose a TypeScript framework template with Tailwind, then place reusable UI in
the generated `components/ui` (or `src/components/ui`) folder. Configure the
`ui` alias in `components.json` to match the actual TypeScript import path.
That is a separate migration; the legacy Next.js application is not restored
or included in the targeted `typecheck:ui` command.

## Dependency limitation

`npm audit` reports ten high-severity development-dependency advisories through
Tailwind 3's glob-matching dependencies. No fixed picomatch release was available
in the registry during this integration. A Tailwind 4 upgrade was attempted but
its PostCSS package could not be fetched. The compatible Tailwind 3 build is
retained; these development tools are omitted from the production Docker image.
