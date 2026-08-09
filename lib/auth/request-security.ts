const readRequestOrigin = (req: Request): string => {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.trim();
  if (!host) return new URL(req.url).origin;

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  let protocol = forwardedProto;
  if (!protocol) {
    const cfVisitor = req.headers.get('cf-visitor');
    try {
      const scheme = cfVisitor ? (JSON.parse(cfVisitor) as { scheme?: unknown }).scheme : null;
      if (typeof scheme === 'string' && scheme.trim()) protocol = scheme.trim();
    } catch {
      // Ignore malformed proxy metadata and fall back to the request URL.
    }
  }
  if (!protocol) protocol = new URL(req.url).protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
};

/** 浏览器 mutation 只接受当前站点的 Origin/Referer。 */
export const isSameOriginRequest = (req: Request): boolean => {
  const requestOrigin = readRequestOrigin(req);
  const origin = req.headers.get('origin');
  if (origin && origin !== requestOrigin) return false;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      if (new URL(referer).origin !== requestOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
};
