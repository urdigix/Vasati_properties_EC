import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF protection via Origin-header check (double-origin pattern).
 *
 * How it works:
 *   Browsers always send the Origin header on cross-site POST/PUT/DELETE/PATCH requests.
 *   We compare it against the server's own expected origin.
 *   A legitimate same-site fetch from the admin UI will always pass.
 *   A cross-site attacker's form/fetch cannot spoof the Origin header.
 *
 * When to use:
 *   Call this at the top of every mutating admin route (POST/PUT/PATCH/DELETE)
 *   that is protected by cookie-based authentication. Exempt: auth endpoints
 *   (login, logout, verify-2fa) — CSRF on a login endpoint has no security value.
 *
 * Returns null if the request passes, or a 403 NextResponse to return immediately.
 */
export function checkCsrfOrigin(request: NextRequest): NextResponse | null {
  // Allow server-to-server calls (e.g., cron, internal tools) that omit Origin.
  // They cannot carry the admin session cookie anyway because SameSite=Lax.
  const origin = request.headers.get('origin');
  if (!origin) return null;

  // 1. Direct same-origin match from request URL
  if (request.nextUrl && origin === request.nextUrl.origin) {
    return null;
  }

  // 2. Match against configured NEXT_PUBLIC_APP_URL
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');

  if (appUrl) {
    try {
      const expectedOrigin = new URL(appUrl).origin;
      if (origin === expectedOrigin) {
        return null;
      }
    } catch {
      // Malformed configured URL, fallback to host header check
    }
  }

  // 3. Match against host / forwarded-host headers from reverse proxy (Coolify/Traefik)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  if (host && (origin === `${proto}://${host}` || origin === `https://${host}` || origin === `http://${host}`)) {
    return null;
  }

  return NextResponse.json(
    { success: false, message: 'Forbidden: cross-origin request rejected' },
    { status: 403 },
  );
}
