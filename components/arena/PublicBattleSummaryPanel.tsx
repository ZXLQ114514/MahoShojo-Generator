'use client';

import { useEffect, useMemo, useState } from 'react';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import type { PublicBattleSummary } from '@/lib/arena/public-battle-summary';

const MODEL_OPTIONS = Array.from(new Set(
  AI_PROVIDER_CATALOG.flatMap((provider) => provider.models.map((model) => model.value)),
)).filter((model) => model && model !== 'default');

const TIER_STYLES: Record<string, string> = {
  超大杯上: 'border-amber-300 bg-amber-100 text-amber-950',
  超大杯下: 'border-orange-300 bg-orange-100 text-orange-950',
  大杯上: 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950',
  大杯下: 'border-purple-300 bg-purple-100 text-purple-950',
  中杯上: 'border-blue-300 bg-blue-100 text-blue-950',
  中杯下: 'border-cyan-300 bg-cyan-100 text-cyan-950',
  小杯上: 'border-slate-300 bg-slate-100 text-slate-950',
  小杯下: 'border-gray-300 bg-gray-100 text-gray-800',
};

type SummaryPayload = { summary?: PublicBattleSummary | null; error?: string };

const formatDate = (value: string | undefined): string => {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString();
};

export function PublicBattleSummaryPanel() {
  const [summary, setSummary] = useState<PublicBattleSummary | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/arena/public-summary?auto=1', { cache: 'no-store' });
      const payload = await response.json() as SummaryPayload;
      if (!response.ok) throw new Error(payload.error || '加载总结失败');
      setSummary(payload.summary ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载总结失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const runManualSummary = async () => {
    setManualLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/arena/public-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      const payload = await response.json() as SummaryPayload;
      if (!response.ok) throw new Error(payload.error || '生成总结失败');
      setSummary(payload.summary ?? null);
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : '生成总结失败');
    } finally {
      setManualLoading(false);
    }
  };

  const evaluations = useMemo(() => summary?.evaluations ?? [], [summary]);

  return (
    <section className="mb-8 rounded-2xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Public Battle Review</p>
          <h2 className="mt-1 text-2xl font-bold">角色评价总结</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">统计所有非日常公开战报。评价分数由服务端固定公式计算，分为超大杯、大杯、中杯、小杯，并各自分为上、下两个档位。</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-300">手动总结模型<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={manualLoading} className="mt-1 block min-w-48 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">系统默认配置</option>{MODEL_OPTIONS.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          <button type="button" onClick={() => void runManualSummary()} disabled={manualLoading || loading} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{manualLoading ? '总结中…' : '手动总结'}</button>
        </div>
      </div>

      {summary ? <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-white/10 py-3 text-xs text-slate-300"><span>统计战报：{summary.reportCount}</span><span>评价角色：{summary.characterCount}</span><span>总结时间：{formatDate(summary.generatedAt)}</span><span>使用模型：{summary.model}</span></div> : null}
      {error ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      {loading ? <div className="py-12 text-center text-sm text-slate-400">正在读取公开战报总结…</div> : null}
      {!loading && evaluations.length === 0 ? <div className="py-12 text-center text-sm text-slate-400">当前没有足够的非日常公开战报可供评价。</div> : null}
      {!loading && evaluations.length > 0 ? <div className="mt-5 grid gap-4 md:grid-cols-2">{evaluations.map((item) => <article key={item.name} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-lg font-bold text-white">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{item.matches} 场有效对局 · 胜 {item.wins} · 负 {item.losses}</p></div><div className="text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${TIER_STYLES[item.tier] || TIER_STYLES.小杯下}`}>{item.tier}</span><div className="mt-1 text-lg font-bold text-amber-300">{item.score} 分</div></div></div><dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">胜率</dt><dd className="mt-1 font-semibold text-emerald-300">{item.winRate.toFixed(1)}%</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">K/D</dt><dd className="mt-1 font-semibold text-cyan-300">{item.kd === null ? '∞' : item.kd.toFixed(2)}</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">击杀</dt><dd className="mt-1 font-semibold text-emerald-300">{item.kills}</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">死亡</dt><dd className="mt-1 font-semibold text-rose-300">{item.deaths}</dd></div></dl><div className="mt-4 space-y-3 text-sm leading-6"><div><h4 className="text-xs font-semibold text-indigo-300">数值机制</h4><p className="mt-1 text-slate-300">{item.mechanism}</p></div><div><h4 className="text-xs font-semibold text-pink-300">评价理由</h4><p className="mt-1 text-slate-300">{item.reason}</p></div></div></article>)}</div> : null}
    </section>
  );
}
