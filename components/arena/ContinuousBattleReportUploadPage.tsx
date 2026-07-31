'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/useAuth';
import { authStorage } from '@/lib/auth';
import { listBattleStoryChaptersBySession, listBattleStorySessions } from '@/lib/ai-session/battle-story/storage';
import type { BattleStoryChapterRecord, BattleStorySessionRecord } from '@/lib/ai-session/battle-story/types';

const modeLabels: Record<string, string> = { classic: '经典模式', kizuna: '羁绊模式', daily: '日常模式', scenario: '情景模式' };

export function ContinuousBattleReportUploadPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [sessions, setSessions] = useState<BattleStorySessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [chapters, setChapters] = useState<BattleStoryChapterRecord[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await listBattleStorySessions({ limit: 100 });
        setSessions(result);
        if (result[0]) setSelectedId(result[0].id);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '读取本地连续战报失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setChapters([]); return; }
    void (async () => {
      try {
        const result = await listBattleStoryChaptersBySession(selectedId, { includeSuperseded: false, limit: 100 });
        setChapters(result.sort((a, b) => a.index - b.index));
        const session = sessions.find((item) => item.id === selectedId);
        if (session) setTitle((current) => current || session.title);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '读取连续战报章节失败');
      }
    })();
  }, [selectedId, sessions]);

  const selectedSession = sessions.find((item) => item.id === selectedId) ?? null;
  const totalChars = useMemo(() => chapters.reduce((total, chapter) => total + chapter.markdown.length, 0), [chapters]);

  const upload = async () => {
    if (!isAuthenticated || !selectedSession || chapters.length === 0) return;
    setUploading(true); setError(null); setMessage(null);
    try {
      const response = await authStorage.fetch('/api/arena/continuous-bundle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSession.id,
          title: title.trim() || selectedSession.title,
          note,
          isPublic,
          mode: selectedSession.source.mode,
          language: selectedSession.source.language,
          storyLength: selectedSession.source.storyLength,
          chapters: chapters.map((chapter) => ({ index: chapter.index, title: chapter.title, markdown: chapter.markdown })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; generationId?: string; chapterCount?: number };
      if (!response.ok) throw new Error(payload.error || '连续战报上传失败');
      setMessage(`已打包上传 ${payload.chapterCount ?? chapters.length} 章。${isPublic ? '战报已公开。' : '可在个人战报中继续设置公开。'}`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '连续战报上传失败');
    } finally {
      setUploading(false);
    }
  };

  if (authLoading) return <main className="container py-10 text-sm text-gray-600">正在验证登录状态…</main>;
  if (!isAuthenticated) return <main className="container py-10"><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">请先登录后上传连续战报。</div></main>;

  return (
    <main className="magic-background-white min-h-screen py-8">
      <div className="container max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Continuous Archive</p><h1 className="text-3xl font-bold text-gray-900">打包上传连续战报</h1><p className="mt-2 text-sm text-gray-600">选择浏览器本地会话，将有效章节合并为一条战报记录。备注会随公开战报展示。</p></div><div className="flex gap-3 text-sm"><Link href="/arena-reports" className="text-blue-600 hover:underline">返回公开战报</Link><Link href="/arena" className="text-blue-600 hover:underline">竞技场</Link></div></div>
        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div> : null}
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="mb-3 font-semibold text-gray-900">选择本地会话</div>{loading ? <div className="text-sm text-gray-500">读取中…</div> : sessions.length === 0 ? <div className="text-sm text-gray-500">暂无本地连续战报会话，请先在竞技场生成章节。</div> : <div className="max-h-[520px] space-y-2 overflow-y-auto">{sessions.map((session) => <button key={session.id} type="button" onClick={() => { setSelectedId(session.id); setTitle(session.title); setMessage(null); }} className={`w-full rounded-lg border p-3 text-left ${selectedId === session.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}><div className="font-medium text-gray-900">{session.title}</div><div className="mt-1 text-xs text-gray-500">{modeLabels[session.source.mode] || session.source.mode} · {session.chapterCount} 章</div></button>)}</div>}</section>
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-medium text-gray-700">公开标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="连续战报标题" /></label><label className="sm:col-span-2"><span className="text-sm font-medium text-gray-700">公开备注</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="会随公开战报展示的补充说明" /><span className="mt-1 block text-right text-xs text-gray-500">{note.length}/500</span></label></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-gray-100 py-4"><div><div className="font-semibold text-gray-800">章节预览</div><div className="mt-1 text-xs text-gray-500">{chapters.length} 章 · 正文约 {totalChars.toLocaleString()} 字符</div></div><label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />上传后立即公开</label></div><div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">{chapters.length === 0 ? <div className="rounded-lg bg-gray-50 p-5 text-sm text-gray-500">当前会话没有可上传章节。</div> : chapters.map((chapter) => <article key={chapter.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3"><div className="font-medium text-gray-800">第 {chapter.index} 章 · {chapter.title}</div><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-gray-600">{chapter.markdown}</p></article>)}</div><button type="button" onClick={() => void upload()} disabled={uploading || chapters.length === 0 || !selectedSession} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{uploading ? '打包上传中…' : '打包上传连续战报'}</button></section>
        </div>
      </div>
    </main>
  );
}
