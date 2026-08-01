export type MahoshojoRuntimeMode = 'cloudflare' | 'local';

export const getMahoshojoRuntimeMode = (): MahoshojoRuntimeMode =>
  process.env.MAHOSHOJO_RUNTIME_MODE?.trim().toLowerCase() === 'local' ? 'local' : 'cloudflare';

export const isLocalRuntime = (): boolean => getMahoshojoRuntimeMode() === 'local';
