import { requireAuthUser, json } from '@/lib/pvp/server';
import { createBattleReportGenerationRecord, updateBattleReportGenerationPublication } from '@/lib/database/battle-report-generations';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';

type BundleChapter = { index: number; title: string; markdown: string };
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  let body: { title?: unknown; note?: unknown; mode?: unknown; language?: unknown; storyLength?: unknown; sessionId?: unknown; isPublic?: unknown; chapters?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ error: '请求体不是合法 JSON' }, { status: 400 }); }

  const title = text(body.title, 160) || '未命名连续战报';
  const note = text(body.note, 500);
  const mode = ['classic', 'kizuna', 'daily', 'scenario'].includes(String(body.mode)) ? String(body.mode) : 'classic';
  const language = text(body.language, 32) || 'zh-CN';
  const storyLength = text(body.storyLength, 32) || 'standard';
  const sessionId = text(body.sessionId, 128) || null;
  const chapters: BundleChapter[] = Array.isArray(body.chapters)
    ? body.chapters.map((item) => ({ index: Number((item as any)?.index), title: text((item as any)?.title, 160), markdown: text((item as any)?.markdown, 80_000) })).filter((item) => Number.isFinite(item.index) && item.markdown)
    : [];
  if (chapters.length < 1 || chapters.length > 50) return json({ error: '至少需要 1 章，最多上传 50 章' }, { status: 400 });

  chapters.sort((a, b) => a.index - b.index);
  const output = `# ${title}\n\n${chapters.map((chapter) => `## 第 ${chapter.index} 章${chapter.title ? `：${chapter.title}` : ''}\n\n${chapter.markdown}`).join('\n\n---\n\n')}`;
  if (output.length > 400_000) return json({ error: '连续战报总长度不能超过 400000 字符' }, { status: 413 });

  const isPublic = body.isPublic === true || body.isPublic === 'true' || body.isPublic === 1;
  if (isPublic) {
    const combined = `${note}\n${output}`;
    if (applyShieldWords(combined).hasShieldWords) return json({ error: '备注或战报正文包含屏蔽词，不能直接公开' }, { status: 422 });
    if ((await quickCheck(combined)).hasSensitiveWords) return json({ error: '备注或战报正文包含敏感内容，不能直接公开' }, { status: 422 });
  }

  const now = new Date().toISOString();
  const generationId = await createBattleReportGenerationRecord({
    startedAt: now, endedAt: now, durationMs: 0, status: 'completed', generationMode: 'stream',
    endpoint: 'api/arena/continuous-bundle', userId: auth.user.id, username: auth.user.username, mode, language, storyLength,
    headline: title, note: note || null, outputPreview: output, outputChars: output.length,
    outputBytes: new TextEncoder().encode(output).byteLength, outputHasSensitiveWords: false, outputHasShieldWords: false,
    extraJson: { kind: 'continuous-battle-report-bundle', sessionId, chapterCount: chapters.length },
  });
  if (!generationId) return json({ error: '连续战报上传失败，数据库不可用' }, { status: 503 });
  if (isPublic) await updateBattleReportGenerationPublication(generationId, true);
  return json({ success: true, generationId, isPublic, chapterCount: chapters.length }, { status: 201 });
}

export default appRouteHandler;
