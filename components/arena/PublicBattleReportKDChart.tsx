'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type SummaryRow = { name: string; kills: number; deaths: number; matches: number; kd: number | null };
type TimelinePoint = { generationId: string; startedAt: string; label: string; characters: Record<string, number | null> };
type StatsPayload = { reportCount?: number; summary?: SummaryRow[]; timeline?: TimelinePoint[]; uploaders?: string[]; error?: string };

const EMPTY_SUMMARY: SummaryRow[] = [];
const EMPTY_TIMELINE: TimelinePoint[] = [];

const COLORS = ['#db2777', '#4f46e5', '#0891b2', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#475569'];

const formatKd = (value: number | null): string => value === null ? '∞' : value.toFixed(2);

function polylineSegments(points: Array<[number, number] | null>): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);
  return segments;
}

export function PublicBattleReportKDChart() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [username, setUsername] = useState('');
  const [payload, setPayload] = useState<StatsPayload>({});
  const [isMobile, setIsMobile] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setIsCollapsed(isMobile);
  }, [isMobile]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (username) params.set('username', username);
    setLoading(true);
    setError(null);
    fetch(`/api/arena/public-stats?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const nextPayload = await response.json() as StatsPayload;
        if (!response.ok) throw new Error(nextPayload.error || '统计加载失败');
        setPayload(nextPayload);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : '统计加载失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [from, to, username]);

  const summary = payload.summary ?? EMPTY_SUMMARY;
  const timeline = payload.timeline ?? EMPTY_TIMELINE;
  const chartNames = useMemo(() => summary.slice(0, isMobile ? 4 : 8).map((row) => row.name), [isMobile, summary]);
  const maxKd = useMemo(() => {
    const values = timeline.flatMap((point) => chartNames.map((name) => point.characters[name])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return Math.max(1, ...values);
  }, [chartNames, timeline]);
  const chartWidth = 900;
  const chartHeight = isMobile ? 270 : 330;
  const padding = isMobile ? { left: 42, right: 16, top: 18, bottom: 38 } : { left: 52, right: 20, top: 22, bottom: 42 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const chartTickIndexes = useMemo(() => {
    const maxTicks = isMobile ? 4 : 7;
    if (timeline.length <= maxTicks) return timeline.map((_, index) => index);
    const indexes = new Set<number>([0, timeline.length - 1]);
    for (let index = 1; index < maxTicks - 1; index += 1) {
      indexes.add(Math.round((index / (maxTicks - 1)) * (timeline.length - 1)));
    }
    return [...indexes].sort((a, b) => a - b);
  }, [isMobile, timeline]);
  const hasMultipleDates = useMemo(() => new Set(timeline.map((point) => point.label)).size > 1, [timeline]);
  const summaryCards = useMemo(() => summary.map((row, index) => ({ ...row, color: COLORS[index % COLORS.length] })), [summary]);

  return (
    <section className="mb-8 rounded-2xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Public Character Analytics</p>
          <h2 className="mt-1 text-2xl font-bold text-white">角色 K/D 走势</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">以所有当前公开战报为数据源；胜者计 1 次击杀，其他参战者计 1 次死亡，平局不计入。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {loading ? <span className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200">更新统计中…</span> : null}
          <div className="rounded-xl border border-indigo-300/20 bg-indigo-400/10 px-4 py-3 text-right text-xs text-slate-300 shadow-sm">
            <div>统计战报</div><div className="mt-1 text-lg font-bold text-indigo-200">{payload.reportCount ?? 0}</div>
          </div>
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-controls="public-battle-kd-chart-details"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-indigo-300/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/60"
          >
            <span>{isCollapsed ? '展开' : '收起'}</span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-white/10 bg-slate-900/80 p-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-end">
        <label className="text-xs font-medium text-slate-300">开始日期<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white [color-scheme:dark]" /></label>
        <label className="text-xs font-medium text-slate-300">结束日期<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white [color-scheme:dark]" /></label>
        <label className="min-w-0 text-xs font-medium text-slate-300">上传人<select value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"><option value="">全部上传人</option>{(payload.uploaders ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      {!loading && !error && timeline.length === 0 ? <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/70 py-12 text-center text-sm text-slate-400">当前筛选范围内暂无可统计的非平局公开战报。</div> : null}
      {!error && timeline.length > 0 ? <>
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-3 sm:p-5">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="block h-auto w-full" role="img" aria-label="角色 K/D 折线图">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => { const y = padding.top + innerHeight * (1 - ratio); return <g key={ratio}><line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="#334155" strokeDasharray="4 5" /><text x={padding.left - 9} y={y + 4} textAnchor="end" fontSize={isMobile ? '10' : '11'} fill="#94a3b8">{(maxKd * ratio).toFixed(1)}</text></g>; })}
            <line x1={padding.left} x2={padding.left} y1={padding.top} y2={chartHeight - padding.bottom} stroke="#64748b" />
            <line x1={padding.left} x2={chartWidth - padding.right} y1={chartHeight - padding.bottom} y2={chartHeight - padding.bottom} stroke="#64748b" />
            {timeline.map((point, index) => { const x = padding.left + (timeline.length === 1 ? innerWidth / 2 : (index / (timeline.length - 1)) * innerWidth); if (!chartTickIndexes.includes(index)) return null; const label = hasMultipleDates ? point.label : `第 ${index + 1} 场`; return <text key={point.generationId} x={x} y={chartHeight - 14} textAnchor="middle" fontSize={isMobile ? '9' : '10'} fill="#94a3b8">{label}</text>; })}
            {chartNames.map((name, seriesIndex) => {
              const points = timeline.map((point, index): [number, number] | null => { const value = point.characters[name]; if (typeof value !== 'number' || !Number.isFinite(value)) return null; const x = padding.left + (timeline.length === 1 ? innerWidth / 2 : (index / (timeline.length - 1)) * innerWidth); const y = padding.top + innerHeight * (1 - Math.min(value / maxKd, 1)); return [x, y]; });
              return polylineSegments(points).map((segment, segmentIndex) => <polyline key={`${name}-${segmentIndex}`} points={segment.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={COLORS[seriesIndex]} strokeWidth={isMobile ? '2.5' : '3'} strokeLinecap="round" strokeLinejoin="round" />);
            })}
          </svg>
        </div>
        <div id="public-battle-kd-chart-details" hidden={isCollapsed} className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-2 text-xs text-slate-300">{chartNames.map((name, index) => <span key={name} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index] }} />{name}</span>)}</div>
          <div className="grid gap-3 sm:grid-cols-2 md:hidden">{summaryCards.map((row) => <article key={row.name} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} /><h3 className="truncate font-semibold text-white">{row.name}</h3></div><p className="mt-1 text-xs text-slate-400">有效对局 {row.matches}</p></div><div className="text-right"><div className="text-xs text-slate-400">K/D</div><div className="text-lg font-bold text-indigo-300">{formatKd(row.kd)}</div></div></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">击杀</dt><dd className="mt-1 text-sm font-semibold text-emerald-300">{row.kills}</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">死亡</dt><dd className="mt-1 text-sm font-semibold text-rose-300">{row.deaths}</dd></div></dl></article>)}</div>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-700 bg-slate-900 md:block"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-800 text-xs uppercase tracking-wide text-slate-300"><tr><th className="px-4 py-3">角色</th><th className="px-4 py-3">K/D</th><th className="px-4 py-3">击杀</th><th className="px-4 py-3">死亡</th><th className="px-4 py-3">有效对局</th></tr></thead><tbody className="divide-y divide-slate-800">{summary.map((row) => <tr key={row.name} className="text-slate-200"><td className="px-4 py-3 font-semibold text-white">{row.name}</td><td className="px-4 py-3 font-bold text-indigo-300">{formatKd(row.kd)}</td><td className="px-4 py-3 text-emerald-300">{row.kills}</td><td className="px-4 py-3 text-rose-300">{row.deaths}</td><td className="px-4 py-3">{row.matches}</td></tr>)}</tbody></table></div>
        </div>
      </> : null}
    </section>
  );
}
