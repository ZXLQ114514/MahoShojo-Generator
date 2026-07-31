import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getPublicAiCooldownSettings } from '@/lib/db/repositories/admin';

export async function GET(): Promise<Response> {
  const settings = await getPublicAiCooldownSettings(getDrizzleDbFromRuntime());
  return new Response(JSON.stringify({ publicAiCooldown: settings }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
