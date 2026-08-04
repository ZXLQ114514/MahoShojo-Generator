'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';

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

const TIER_OPTIONS = Object.keys(TIER_STYLES);

type EvaluationSort = 'score' | 'matches' | 'name';

type SummaryPayload = { summary?: PublicBattleSummary | null; error?: string };

const formatDate = (value: string | undefined): string => {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString();
};

export function PublicBattleSummaryPanel() {
  const [summary, setSummary] = useState<PublicBattleSummary | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [characterQuery, setCharacterQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [evaluationSort, setEvaluationSort] = useState<EvaluationSort>('score');
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
  const filteredEvaluations = useMemo(() => {
    const query = characterQuery.trim().toLocaleLowerCase();
    return evaluations
      .filter((item) => (!query || item.name.toLocaleLowerCase().includes(query)) && (!tierFilter || item.tier === tierFilter))
      .sort((left, right) => {
        if (evaluationSort === 'matches') return right.matches - left.matches || right.score - left.score;
        if (evaluationSort === 'name') return left.name.localeCompare(right.name, 'zh-CN');
        return right.score - left.score || right.matches - left.matches;
      });
  }, [characterQuery, evaluationSort, evaluations, tierFilter]);

  const hasActiveFilters = characterQuery.trim() !== '' || tierFilter !== '' || evaluationSort !== 'score';
  const resetFilters = () => {
    setCharacterQuery('');
    setTierFilter('');
    setEvaluationSort('score');
  };

  return (
    <section className="mb-8 rounded-2xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls="public-battle-summary-content"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="min-w-0 flex-1 rounded-xl p-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Public Battle Review</p>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
            <span>角色评价总结</span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-300"><span>{isExpanded ? '收起' : '展开'}</span><ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></span>
          </span>
          <span className="mt-2 block max-w-3xl text-sm font-normal leading-6 text-slate-300">统计所有非日常公开战报。评价分数由服务端固定公式计算，分为超大杯、大杯、中杯、小杯，并各自分为上、下两个档位。</span>
        </button>
      </div>

      {summary ? <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-white/10 py-3 text-xs text-slate-300"><span>统计战报：{summary.reportCount}</span><span>评价角色：{summary.characterCount}</span><span>总结时间：{formatDate(summary.generatedAt)}</span><span className="break-all">使用模型：{summary.model}</span></div> : null}
      {error ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      {loading ? <div className="py-12 text-center text-sm text-slate-400">正在读取公开战报总结…</div> : null}
      <div id="public-battle-summary-content" hidden={!isExpanded} className="mt-5">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <p className="text-xs leading-5 text-slate-400">展开后可选择模型并生成一次不保存到服务器的临时总结。</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 text-xs text-slate-300 sm:min-w-48">手动总结模型<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={manualLoading} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"><option value="">系统默认配置</option>{MODEL_OPTIONS.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <button type="button" onClick={() => void runManualSummary()} disabled={manualLoading || loading} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">{manualLoading ? '总结中…' : '手动总结'}</button>
          </div>
        </div>
        {!loading && evaluations.length > 0 ? <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/50 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-amber-300" />筛选与排序</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] lg:items-end">
            <label className="text-xs text-slate-300">搜索角色<input value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} placeholder="输入角色名" className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500" /></label>
            <label className="text-xs text-slate-300">评价等级<select value={tierFilter} onChange={(event) => setTierFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="">全部等级</option>{TIER_OPTIONS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}</select></label>
            <label className="text-xs text-slate-300">排序<select value={evaluationSort} onChange={(event) => setEvaluationSort(event.target.value as EvaluationSort)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="score">评分从高到低</option><option value="matches">对局数从多到少</option><option value="name">角色名</option></select></label>
            <button type="button" onClick={resetFilters} disabled={!hasActiveFilters} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw aria-hidden="true" className="h-4 w-4" />重置</button>
          </div>
          <p className="mt-3 text-xs text-slate-400">显示 {filteredEvaluations.length} / {evaluations.length} 名角色</p>
        </div> : null}
        {!loading && evaluations.length === 0 ? <div className="py-12 text-center text-sm text-slate-400">当前没有足够的非日常公开战报可供评价。</div> : null}
        {!loading && evaluations.length > 0 && filteredEvaluations.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-700 px-4 py-12 text-center text-sm text-slate-400">没有符合当前筛选条件的角色。</div> : null}
        {!loading && filteredEvaluations.length > 0 ? <div className="mt-5 grid gap-4 md:grid-cols-2">{filteredEvaluations.map((item) => <article key={item.name} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-lg font-bold text-white">{item.name}</h3><p className="mt-1 text-xs text-slate-400">{item.matches} 场有效对局 · 胜 {item.wins} · 负 {item.losses}</p></div><div className="shrink-0 text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${TIER_STYLES[item.tier] || TIER_STYLES.小杯下}`}>{item.tier}</span><div className="mt-1 text-lg font-bold text-amber-300">{item.score} 分</div></div></div><dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">胜率</dt><dd className="mt-1 font-semibold text-emerald-300">{item.winRate.toFixed(1)}%</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">K/D</dt><dd className="mt-1 font-semibold text-cyan-300">{item.kd === null ? '∞' : item.kd.toFixed(2)}</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">击杀</dt><dd className="mt-1 font-semibold text-emerald-300">{item.kills}</dd></div><div className="rounded-lg bg-slate-950/70 p-3"><dt className="text-slate-400">死亡</dt><dd className="mt-1 font-semibold text-rose-300">{item.deaths}</dd></div></dl><div className="mt-4 space-y-3 text-sm leading-6"><div><h4 className="text-xs font-semibold text-indigo-300">数值机制</h4><p className="mt-1 break-words text-slate-300">{item.mechanism}</p></div><div><h4 className="text-xs font-semibold text-pink-300">评价理由</h4><p className="mt-1 break-words text-slate-300">{item.reason}</p></div></div></article>)}</div> : null}
      </div>
    </section>
  );
}
