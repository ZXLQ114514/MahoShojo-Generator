import { getRuntimeShieldWordRulesSnapshot } from '@/lib/shield-word-runtime';

export const dynamic = 'force-dynamic';

export const GET = async (): Promise<Response> => {
  const settings = await getRuntimeShieldWordRulesSnapshot();
  if (!settings.available) {
    return new Response(JSON.stringify({ error: '屏蔽词设置暂不可用' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ rules: settings.rules, revision: settings.revision }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
    },
  });
};
