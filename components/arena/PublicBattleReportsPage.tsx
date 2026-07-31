'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PublicBattleReportViewer, type PublicBattleReport } from './PublicBattleReportViewer';
import { PublicBattleReportKDChart } from './PublicBattleReportKDChart';

type PublicReportSummary = {
  id: string;
  publicSince: string | null;
  startedAt: string;
  headline: string | null;
  winner: string | null;
  username: string | null;
  note: string | null;
  mode: string | null;
  scenarioTitle: string | null;
  excerpt: string;
};

type PublicReportDetail = PublicBattleReport;

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '暂无时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无时间' : date.toLocaleString();
};

const modeLabels: Record<string, string> = {
  classic: '经典对战',
  kizuna: '羁绊对战',
  daily: '日常故事',
  scenario: '情景故事',
};

export function PublicBattleReportsPage() {
  const [records, setRecords] = useState<PublicReportSummary[]>([]);
  const [selected, setSelected] = useState<PublicReportDetail | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 12;

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/arena/public-reports?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { records?: PublicReportSummary[]; page?: { hasMore?: boolean }; error?: string };
      if (!response.ok) throw new Error(payload.error || `加载失败（${response.status}）`);
      setRecords(Array.isArray(payload.records) ? payload.records : []);
      setHasMore(payload.page?.hasMore === true);
    } catch (loadError) {
      setRecords([]);
      setHasMore(false);
      setError(loadError instanceof Error ? loadError.message : '公开战报加载失败');
    } finally {
      setLoading(false);
    }
  }, [offset, query]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  const openReport = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/arena/public-reports?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const payload = await response.json() as { report?: PublicReportDetail; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.error || '公开战报暂时不可用');
      setSelected(payload.report);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : '公开战报暂时不可用');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <main className="magic-background-white min-h-screen py-8">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Arena Public Archive</p>
            <h1 className="text-3xl font-bold text-white">公开战报展览</h1>
            <p className="mt-2 text-sm text-slate-300">浏览创作者主动公开、并通过内容检查的竞技场战斗记录。</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm"><Link href="/arena-reports/upload" className="text-indigo-300 hover:text-white hover:underline">上传连续战报</Link><Link href="/arena" className="text-indigo-300 hover:text-white hover:underline">进入竞技场</Link><Link href="/" className="text-indigo-300 hover:text-white hover:underline">返回首页</Link></div>
        </div>

        <PublicBattleReportKDChart />

        <section className="mb-6 rounded-xl border border-white/10 bg-slate-950/80 p-4 shadow-xl backdrop-blur"><form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); setOffset(0); void loadReports(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索战报标题或情景标题" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" /><button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">搜索</button></form></section>

        {error ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {loading ? <div className="rounded-xl border border-white/10 bg-slate-950/80 py-16 text-center text-sm text-slate-400">加载中…</div> : null}
        {!loading && records.length === 0 ? <div className="rounded-xl border border-white/10 bg-slate-950/80 py-16 text-center text-sm text-slate-400">暂无公开战报。</div> : null}
        {!loading && records.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <button key={record.id} type="button" onClick={() => void openReport(record.id)} className="rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-pink-300 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-pink-50 px-2 py-1 text-xs text-pink-700">生成模式：{modeLabels[record.mode || ''] || record.mode || '未知模式'}</span><h2 className="mt-3 line-clamp-2 text-lg font-semibold text-gray-900">{record.headline || '未命名战报'}</h2></div><span className="text-xs text-gray-500">查看</span></div>{record.scenarioTitle ? <p className="mt-2 text-xs text-gray-500">情景：{record.scenarioTitle}</p> : null}{record.note ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-pink-700">备注：{record.note}</p> : null}<p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-gray-600">{record.excerpt}</p><div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500"><span>胜者：{record.winner || '未解析'}</span><span>上传人：{record.username || '未知用户'}</span><span>公开于 {formatDate(record.publicSince)}</span></div></button>)}</div> : null}

        <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))} className="rounded border border-white/20 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40">上一页</button><button type="button" disabled={!hasMore || loading} onClick={() => setOffset((value) => value + pageSize)} className="rounded border border-white/20 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40">下一页</button></div>
      </div>

      {selected ? <PublicBattleReportViewer report={selected} formatDate={formatDate} modeLabel={modeLabels[selected.mode || ''] || selected.mode || '竞技场战报'} onClose={() => setSelected(null)} /> : null}
      {detailLoading ? <div className="fixed bottom-5 right-5 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">正在打开战报…</div> : null}
    </main>
  );
}
