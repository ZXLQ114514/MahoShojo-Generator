type StaticHeader = {
  key: string;
  value: string;
};

type BrowserSecurityHeaderOptions = {
  allowGoogleAnalytics?: boolean;
  allowTurnstile?: boolean;
  enableHttpsOnlyHeaders?: boolean;
  isProduction: boolean;
};

const LOCAL_HOSTNAMES = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'localhost',
]);

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : Number.NaN;
  });

  return octets.every((octet) => Number.isInteger(octet)) ? octets : null;
}

function isPrivateOrVirtualLanIpv4(hostname: string): boolean {
  const octets = parseIpv4Address(hostname);
  if (!octets) return false;

  const [first, second] = octets;

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    // 常见虚拟局域网/组网工具会使用这些非 RFC1918 网段。
    first === 25 ||
    first === 26
  );
}

export function buildPermissionsPolicy(): string {
  return [
    'accelerometer=()',
    'ambient-light-sensor=()',
    'autoplay=()',
    'battery=()',
    'bluetooth=()',
    'camera=()',
    'clipboard-read=(self)',
    'clipboard-write=(self)',
    'display-capture=()',
    'document-domain=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'hid=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'serial=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', ');
}

export function buildContentSecurityPolicy(options: BrowserSecurityHeaderOptions): string {
  const scriptSources = [`'self'`, `'unsafe-inline'`];
  const connectSources = [`'self'`, 'https:', 'wss:'];
  const frameSources = [`'self'`];

  if (!options.isProduction) {
    scriptSources.push(`'unsafe-eval'`);
    connectSources.push('http:', 'ws:');
  }

  if (options.allowTurnstile) {
    scriptSources.push('https://challenges.cloudflare.com');
    frameSources.push('https://challenges.cloudflare.com');
  }

  if (options.allowGoogleAnalytics) {
    scriptSources.push('https://www.googletagmanager.com');
    connectSources.push('https://www.google-analytics.com', 'https://region1.google-analytics.com');
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `script-src ${Array.from(new Set(scriptSources)).join(' ')}`,
    `script-src-attr 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
    `media-src 'self' data: blob: https:`,
    `frame-src ${Array.from(new Set(frameSources)).join(' ')}`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  if (options.isProduction && options.enableHttpsOnlyHeaders !== false) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function buildStaticBrowserSecurityHeaders(options: BrowserSecurityHeaderOptions): StaticHeader[] {
  return [
    ...(options.isProduction && options.enableHttpsOnlyHeaders !== false
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ]
      : []),
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'Permissions-Policy',
      value: buildPermissionsPolicy(),
    },
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(options),
    },
  ];
}

export function buildRequestBrowserSecurityHeaders(
  url: URL,
  headers: Headers,
  options: BrowserSecurityHeaderOptions,
): StaticHeader[] {
  return buildStaticBrowserSecurityHeaders({
    ...options,
    enableHttpsOnlyHeaders:
      options.enableHttpsOnlyHeaders !== false &&
      !isLocalHostname(getRequestHostname(url, headers)),
  });
}

export function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(normalizedHostname) ||
    normalizedHostname.endsWith('.localhost') ||
    isPrivateOrVirtualLanIpv4(normalizedHostname)
  );
}

export function getRequestProtocol(url: URL, headers: Headers): string {
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) return forwardedProto.replace(/:$/, '').toLowerCase();

  const forwarded = headers.get('forwarded');
  const forwardedMatch = forwarded?.match(/proto=(https?)/i);
  if (forwardedMatch?.[1]) return forwardedMatch[1].toLowerCase();

  const cfVisitor = headers.get('cf-visitor');
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) return parsed.scheme.toLowerCase();
    } catch {
      // ignore malformed proxy headers
    }
  }

  return url.protocol.replace(/:$/, '').toLowerCase();
}

function parseRequestHost(url: URL, headers: Headers): URL {
  const hostCandidates = [
    headers.get('x-forwarded-host')?.split(',')[0]?.trim(),
    headers.get('host')?.trim(),
  ];

  for (const host of hostCandidates) {
    if (!host) continue;

    try {
      const parsed = new URL(`http://${host}`);
      if (
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === '/' &&
        !parsed.search &&
        !parsed.hash
      ) {
        return parsed;
      }
    } catch {
      // Try the next host source before falling back to the request URL.
    }
  }

  return new URL(`http://${url.host}`);
}

export function getRequestHostname(url: URL, headers: Headers): string {
  return parseRequestHost(url, headers).hostname;
}

export function getRequestHost(url: URL, headers: Headers): string {
  return parseRequestHost(url, headers).host;
}

export function buildHttpsRedirectUrl(url: URL, headers: Headers): URL {
  const requestHost = parseRequestHost(url, headers);
  const redirectUrl = new URL(url.href);
  redirectUrl.protocol = 'https:';
  redirectUrl.hostname = requestHost.hostname;
  redirectUrl.port = requestHost.port;
  return redirectUrl;
}

export function shouldRedirectToHttps(url: URL, headers: Headers): boolean {
  if (isLocalHostname(getRequestHostname(url, headers))) return false;
  return getRequestProtocol(url, headers) === 'http';
}
