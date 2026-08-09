import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  buildContentSecurityPolicy,
  buildHttpsRedirectUrl,
  buildPermissionsPolicy,
  buildRequestBrowserSecurityHeaders,
  buildStaticBrowserSecurityHeaders,
  getRequestHost,
  getRequestHostname,
  getRequestProtocol,
  shouldRedirectToHttps,
} from '@/lib/security/browser-headers';

describe('browser security headers', () => {
  test('静态安全头包含基础浏览器硬化项与 CSP', () => {
    const headers = buildStaticBrowserSecurityHeaders({
      allowGoogleAnalytics: true,
      allowTurnstile: true,
      isProduction: true,
    });

    expect(headers).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
    expect(headers).toContainEqual({
      key: 'X-Frame-Options',
      value: 'DENY',
    });
    expect(headers).toContainEqual({
      key: 'Permissions-Policy',
      value: buildPermissionsPolicy(),
    });
    expect(headers).toContainEqual({
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy({
        allowGoogleAnalytics: true,
        allowTurnstile: true,
        isProduction: true,
      }),
    });
  });

  test('CSP 会启用 anti-frame、静态脚本白名单与 HTTPS 升级', () => {
    const policy = buildContentSecurityPolicy({
      allowGoogleAnalytics: true,
      allowTurnstile: true,
      isProduction: true,
    });

    expect(policy).toContain(`frame-ancestors 'none'`);
    expect(policy).toContain(`script-src 'self' 'unsafe-inline'`);
    expect(policy).toContain('https://challenges.cloudflare.com');
    expect(policy).toContain('https://www.googletagmanager.com');
    expect(policy).toContain(`script-src-attr 'none'`);
    expect(policy).toContain('upgrade-insecure-requests');
  });

  test('开发环境 CSP 会保留 Next 开发调试所需的 unsafe-eval', () => {
    const policy = buildContentSecurityPolicy({
      allowGoogleAnalytics: false,
      allowTurnstile: false,
      isProduction: false,
    });

    expect(policy).toContain(`'unsafe-eval'`);
  });

  test('内网 HTTP 自托管可关闭 HTTPS-only 响应头', () => {
    const headers = buildStaticBrowserSecurityHeaders({
      allowGoogleAnalytics: false,
      allowTurnstile: true,
      enableHttpsOnlyHeaders: false,
      isProduction: true,
    });
    const policy = headers.find(header => header.key === 'Content-Security-Policy')?.value ?? '';

    expect(headers.some(header => header.key === 'Strict-Transport-Security')).toBe(false);
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  test('请求级安全头会自动放过局域网 HTTP，并保留公网 HTTPS 强制策略', () => {
    const localHeaders = buildRequestBrowserSecurityHeaders(
      new URL('http://0.0.0.0:3000/character-report-analysis'),
      new Headers({ host: '10.126.126.1:3000' }),
      {
        allowGoogleAnalytics: false,
        allowTurnstile: true,
        isProduction: true,
      },
    );
    const localPolicy =
      localHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';

    expect(localHeaders.some(header => header.key === 'Strict-Transport-Security')).toBe(false);
    expect(localPolicy).not.toContain('upgrade-insecure-requests');
    expect(localHeaders).toContainEqual({
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    });

    const publicHeaders = buildRequestBrowserSecurityHeaders(
      new URL('https://0.0.0.0:3000/character-report-analysis'),
      new Headers({ host: 'mahoshojo.example.com' }),
      {
        allowGoogleAnalytics: false,
        allowTurnstile: true,
        isProduction: true,
      },
    );
    const publicPolicy =
      publicHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';

    expect(publicHeaders).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
    expect(publicPolicy).toContain('upgrade-insecure-requests');

    const globallyDisabledHeaders = buildRequestBrowserSecurityHeaders(
      new URL('https://mahoshojo.example.com/character-report-analysis'),
      new Headers(),
      {
        allowGoogleAnalytics: false,
        allowTurnstile: true,
        enableHttpsOnlyHeaders: false,
        isProduction: true,
      },
    );
    const globallyDisabledPolicy =
      globallyDisabledHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';

    expect(
      globallyDisabledHeaders.some(header => header.key === 'Strict-Transport-Security'),
    ).toBe(false);
    expect(globallyDisabledPolicy).not.toContain('upgrade-insecure-requests');
  });

  test('HTTPS 跳转会尊重代理协议头且放过本地开发地址', () => {
    expect(
      shouldRedirectToHttps(new URL('http://mahoshojo.example.com/free'), new Headers()),
    ).toBe(true);

    expect(
      shouldRedirectToHttps(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'x-forwarded-proto': 'https' }),
      ),
    ).toBe(false);

    expect(
      shouldRedirectToHttps(new URL('http://localhost:3000/free'), new Headers()),
    ).toBe(false);

    expect(
      shouldRedirectToHttps(new URL('http://192.168.1.10:3000/free'), new Headers()),
    ).toBe(false);

    expect(
      shouldRedirectToHttps(new URL('http://26.208.231.39:3000/free'), new Headers()),
    ).toBe(false);

    expect(
      shouldRedirectToHttps(
        new URL('http://0.0.0.0:3000/free'),
        new Headers({ host: 'mahoshojo.example.com' }),
      ),
    ).toBe(true);
  });

  test('协议识别会优先读取代理透传头', () => {
    expect(
      getRequestProtocol(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'x-forwarded-proto': 'http' }),
      ),
    ).toBe('http');

    expect(
      getRequestProtocol(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'cf-visitor': JSON.stringify({ scheme: 'https' }) }),
      ),
    ).toBe('https');
  });

  test('主机识别会优先使用客户端 Host，并在缺失或无效时回退 URL', () => {
    const internalUrl = new URL('http://0.0.0.0:3000/free');

    expect(
      getRequestHostname(internalUrl, new Headers({ host: '10.126.126.1:3000' })),
    ).toBe('10.126.126.1');
    expect(
      getRequestHostname(internalUrl, new Headers({ host: 'mahoshojo.example.com' })),
    ).toBe('mahoshojo.example.com');
    const forwardedPublicHeaders = new Headers({
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'mahoshojo.example.com',
    });
    expect(getRequestHostname(internalUrl, forwardedPublicHeaders)).toBe(
      'mahoshojo.example.com',
    );
    expect(shouldRedirectToHttps(internalUrl, forwardedPublicHeaders)).toBe(true);
    expect(buildHttpsRedirectUrl(internalUrl, forwardedPublicHeaders).href).toBe(
      'https://mahoshojo.example.com/free',
    );
    expect(
      getRequestHost(internalUrl, new Headers({ host: 'mahoshojo.example.com:8443' })),
    ).toBe('mahoshojo.example.com:8443');
    expect(
      buildHttpsRedirectUrl(
        new URL('http://0.0.0.0:3000/free?tab=latest'),
        new Headers({ host: 'mahoshojo.example.com' }),
      ).href,
    ).toBe('https://mahoshojo.example.com/free?tab=latest');
    expect(
      buildHttpsRedirectUrl(
        new URL('http://0.0.0.0:3000/free'),
        new Headers({ host: 'mahoshojo.example.com:8443' }),
      ).href,
    ).toBe('https://mahoshojo.example.com:8443/free');
    expect(getRequestHostname(internalUrl, new Headers({ host: 'invalid host' }))).toBe(
      '0.0.0.0',
    );
    expect(
      getRequestHostname(
        internalUrl,
        new Headers({
          host: 'mahoshojo.example.com',
          'x-forwarded-host': 'evil.example@10.126.126.1/path',
        }),
      ),
    ).toBe('mahoshojo.example.com');
  });

  test('Cloudflare 静态资产保留基础安全头但不强制 HTTPS', () => {
    const staticAssetHeaders = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');

    expect(staticAssetHeaders).toContain('/*');
    expect(staticAssetHeaders).toContain('X-Content-Type-Options: nosniff');
    expect(staticAssetHeaders).toContain('X-Frame-Options: DENY');
    expect(staticAssetHeaders).toContain(`Permissions-Policy: ${buildPermissionsPolicy()}`);
    expect(staticAssetHeaders).not.toContain('Strict-Transport-Security');
    expect(staticAssetHeaders).not.toContain('upgrade-insecure-requests');
    expect(staticAssetHeaders).toContain('X-Robots-Tag: noindex');
  });
});
