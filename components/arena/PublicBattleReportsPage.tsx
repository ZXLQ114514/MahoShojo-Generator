'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PublicBattleReportViewer, type PublicBattleReport } from './PublicBattleReportViewer';
import { PublicBattleReportKDChart } from './PublicBattleReportKDChart';
import { PublicBattleSummaryPanel } from './PublicBattleSummaryPanel';

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

type PublicReportsPagePayload = {
  records?: PublicReportSummary[];
  page?: {
    hasMore?: boolean;
    nextOffset?: number | null;
  };
  error?: string;
};

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
  const [pageHistory, setPageHistory] = useState<number[]>([]);
  const [pageNextOffset, setPageNextOffset] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
      const payload = await response.json() as PublicReportsPagePayload;
      if (!response.ok) throw new Error(payload.error || `加载失败（${response.status}）`);
      setRecords(Array.isArray(payload.records) ? payload.records : []);
      setHasMore(payload.page?.hasMore === true);
      setPageNextOffset(typeof payload.page?.nextOffset === 'number' ? payload.page.nextOffset : null);
    } catch (loadError) {
      setRecords([]);
      setHasMore(false);
      setPageNextOffset(null);
      setError(loadError instanceof Error ? loadError.message : '公开战报加载失败');
    } finally {
      setLoading(false);
    }
  }, [offset, query]);

  useEffect(() => { void loadReports(); }, [loadReports, refreshKey]);

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

  const resetPaging = () => {
    setPageHistory([]);
    setPageNextOffset(null);
    setOffset(0);
    setRefreshKey((value) => value + 1);
  };

  const goToNextPage = () => {
    if (pageNextOffset === null) return;
    setPageHistory((history) => [...history, offset]);
    setOffset(pageNextOffset);
  };

  const goToPreviousPage = () => {
    const previousOffset = pageHistory[pageHistory.length - 1];
    if (previousOffset === undefined) return;
    setPageHistory((history) => history.slice(0, -1));
    setOffset(previousOffset);
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

        <PublicBattleSummaryPanel />
        <PublicBattleReportKDChart />

        <section className="mb-6 rounded-xl border border-white/10 bg-slate-950/80 p-4 shadow-xl backdrop-blur"><form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); resetPaging(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索战报标题或情景标题" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" /><button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">搜索</button></form></section>

        {error ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {loading ? <div className="rounded-xl border border-white/10 bg-slate-950/80 py-16 text-center text-sm text-slate-400">加载中…</div> : null}
        {!loading && records.length === 0 ? <div className="rounded-xl border border-white/10 bg-slate-950/80 py-16 text-center text-sm text-slate-400">暂无公开战报。</div> : null}
        {!loading && records.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <button key={record.id} type="button" onClick={() => void openReport(record.id)} className="group rounded-xl border border-slate-700 bg-slate-900/90 p-5 text-left text-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:border-pink-300/40 hover:bg-slate-800/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300/60"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="inline-flex rounded-full border border-pink-300/20 bg-pink-400/10 px-2 py-1 text-xs font-medium text-pink-200">生成模式：{modeLabels[record.mode || ''] || record.mode || '未知模式'}</span><h2 className="mt-3 line-clamp-2 text-lg font-semibold text-white">{record.headline || '未命名战报'}</h2></div><span className="text-xs text-slate-400 transition group-hover:text-slate-200">查看</span></div>{record.scenarioTitle ? <p className="mt-2 text-xs text-slate-400">情景：{record.scenarioTitle}</p> : null}{record.note ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-pink-200/90">备注：{record.note}</p> : null}<p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{record.excerpt}</p><div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-700 pt-3 text-xs text-slate-400"><span>胜者：{record.winner || '未解析'}</span><span>上传人：{record.username || '未知用户'}</span><span>公开于 {formatDate(record.publicSince)}</span></div></button>)}</div> : null}

        <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={pageHistory.length === 0 || loading} onClick={goToPreviousPage} className="rounded border border-white/20 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40">上一页</button><button type="button" disabled={!hasMore || loading || pageNextOffset === null} onClick={goToNextPage} className="rounded border border-white/20 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40">下一页</button></div>
      </div>

      {selected ? <PublicBattleReportViewer report={selected} formatDate={formatDate} modeLabel={modeLabels[selected.mode || ''] || selected.mode || '竞技场战报'} onClose={() => setSelected(null)} /> : null}
      {detailLoading ? <div className="fixed bottom-5 right-5 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">正在打开战报…</div> : null}
    </main>
  );
}