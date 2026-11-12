import { NextRequest, NextResponse } from 'next/server';
import { getAllowedOrigins, isOriginAllowed } from '@/lib/config';

const defaultSecurityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';",
  },
];

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const origin = request.headers.get('origin');
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');

  for (const header of defaultSecurityHeaders) {
    response.headers.set(header.key, header.value);
  }

  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204 });
    for (const header of defaultSecurityHeaders) {
      preflight.headers.set(header.key, header.value);
    }
    preflight.headers.set(
      'Access-Control-Allow-Origin',
      origin && isOriginAllowed(origin) ? origin : '*',
    );
    preflight.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    preflight.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    preflight.headers.set('Access-Control-Max-Age', '600');
    return preflight;
  }

  if (isApiRoute) {
    const allowedOrigins = getAllowedOrigins();
    const corsOrigin = origin && isOriginAllowed(origin)
      ? origin
      : allowedOrigins[0] ?? '*';

    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
    response.headers.set('Cache-Control', 'no-store');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
