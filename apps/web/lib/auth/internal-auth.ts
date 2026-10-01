const INTERNAL_AUTH_HEADER = 'x-mahoshojo-internal-auth';
const MAX_SKEW_SECONDS = 60;

const secretBytes = (): ArrayBuffer => {
  const bytes = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET?.trim() ?? '');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const toHex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes.buffer;
};

const signatureFor = async (timestamp: string, path: string, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', secretBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}:${path}:${body}`)));
};

export async function buildInternalAuthHeader(path: string, body: string): Promise<string | null> {
  if (!process.env.BETTER_AUTH_SECRET?.trim()) return null;
  const timestamp = String(Math.floor(Date.now() / 1000));
  return `${timestamp}.${await signatureFor(timestamp, path, body)}`;
}

export async function verifyInternalAuthHeader(request: Request): Promise<boolean> {
  const value = request.headers.get(INTERNAL_AUTH_HEADER) ?? '';
  const separator = value.indexOf('.');
  if (separator <= 0) return false;
  const timestamp = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(parsed) || Math.abs(Math.floor(Date.now() / 1000) - parsed) > MAX_SKEW_SECONDS) return false;
  if (!/^[a-f0-9]{64}$/u.test(signature) || !process.env.BETTER_AUTH_SECRET?.trim()) return false;
  const path = new URL(request.url).pathname;
  const body = await request.clone().text();
  const actualBytes = fromHex(signature);
  const messageBytes = new TextEncoder().encode(`${timestamp}:${path}:${body}`);
  return await crypto.subtle.verify(
    'HMAC',
    await crypto.subtle.importKey('raw', secretBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
    actualBytes,
    messageBytes,
  );
}

export { INTERNAL_AUTH_HEADER };
