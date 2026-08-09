import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  buildHttpsRedirectUrl,
  buildRequestBrowserSecurityHeaders,
  shouldRedirectToHttps,
} from '@/lib/security/browser-headers';

const browserSecurityHeaderOptions = {
  allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
  allowTurnstile: true,
  enableHttpsOnlyHeaders: process.env.MAHOSHOJO_ENABLE_HTTPS_SECURITY_HEADERS !== 'false',
  isProduction: process.env.NODE_ENV === 'production',
};

function applyBrowserSecurityHeaders(
  response: NextResponse,
  url: URL,
  requestHeaders: Headers,
): NextResponse {
  for (const { key, value } of buildRequestBrowserSecurityHeaders(
    url,
    requestHeaders,
    browserSecurityHeaderOptions,
  )) {
    response.headers.set(key, value);
  }

  return response;
}

export function middleware(request: NextRequest) {
  const { nextUrl } = request;

  if (shouldRedirectToHttps(nextUrl, request.headers)) {
    const redirectUrl = buildHttpsRedirectUrl(nextUrl, request.headers);
    return applyBrowserSecurityHeaders(
      NextResponse.redirect(redirectUrl, 308),
      nextUrl,
      request.headers,
    );
  }

  return applyBrowserSecurityHeaders(NextResponse.next(), nextUrl, request.headers);
}

export const config = {
  matcher: '/:path*',
};
