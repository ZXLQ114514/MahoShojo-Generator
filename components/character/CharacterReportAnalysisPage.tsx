'use client';

import Link from 'next/link';
import { Filter, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { authStorage } from '@/lib/auth';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import {
  type CharacterReportAiSummary,
  type CharacterReportAnalysisResult,
  type CharacterReportOutcome,
} from '@/lib/arena/character-report-analysis';
import { useAuth } from '@/lib/useAuth';

type CharacterDataCardSummary = {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type DataCardsPayload = {
  success?: boolean;
  cards?: CharacterDataCardSummary[];
  error?: string;
};

type AnalysisPayload = {
  success?: boolean;
  analysis?: CharacterReportAnalysisResult;
  error?: string;
};

type AiSummaryPayload = {
  success?: boolean;
  summary?: CharacterReportAiSummary;
  error?: string;
};

const REPORT_LIMIT_OPTIONS = [
  { value: '50', label: '最近 50 场' },
  { value: '100', label: '最近 100 场' },
  { value: '200', label: '最近 200 场' },
  { value: '500', label: '最近 500 场' },
  { value: 'all', label: '全部战报' },
] as const;

const MODE_LABELS: Record<string, string> = {
  classic: '经典对战',
  kizuna: '羁绊对战',
  daily: '日常故事',
  scenario: '情景故事',
};

const OUTCOME_LABELS: Record<CharacterReportOutcome, string> = {
  win: '胜',
  loss: '负',
  draw: '平',
  unknown: '未知',
};

const OUTCOME_STYLES: Record<CharacterReportOutcome, string> = {
  win: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200',
  loss: 'border-rose-300/20 bg-rose-400/10 text-rose-200',
  draw: 'border-amber-300/20 bg-amber-400/10 text-amber-200',
  unknown: 'border-slate-300/20 bg-slate-400/10 text-slate-200',
};

const SUMMARY_MODEL_OPTIONS = AI_PROVIDER_CATALOG.find((provider) => provider.id === 'system')?.models ?? [];

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString('zh-CN');
};

const formatDateOnly = (value: string | null | undefined): string => {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleDateString('zh-CN');
};

const formatRate = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value.toFixed(1)}%`;
};

const formatKd = (value: number | null): string => {
  if (value === null) return '∞';
  return value.toFixed(2);
};

const getModeLabel = (mode: string | null | undefined): string => {
  const trimmed = typeof mode === 'string' ? mode.trim() : '';
  if (!trimmed) return '未知模式';
  return MODE_LABELS[trimmed] || trimmed;
};

const getOutcomeLabel = (outcome: CharacterReportOutcome): string => OUTCOME_LABELS[outcome];

export function CharacterReportAnalysisPage() {
  const { loading: authLoading, isAuthenticated, user } = useAuth();
  const [cards, setCards] = useState<CharacterDataCardSummary[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [uploaderUsername, setUploaderUsername] = useState('');
  const [reportLimit, setReportLimit] = useState<(typeof REPORT_LIMIT_OPTIONS)[number]['value']>('100');
  const [analysis, setAnalysis] = useState<CharacterReportAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [summaryModel, setSummaryModel] = useState('default');
  const [aiSummary, setAiSummary] = useState<CharacterReportAiSummary | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const aiSummaryRequestRef = useRef(0);

  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      setCards([]);
      setSelectedCardId('');
      setCardsLoading(false);
      setCardsError(null);
      setAnalysis(null);
      setAnalysisLoading(false);
      setAnalysisError(null);
      aiSummaryRequestRef.current += 1;
      setAiSummary(null);
      setAiSummaryError(null);
      setAiSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    setCardsLoading(true);
    setCardsError(null);

    authStorage.fetch('/api/data-cards?sortBy=created_at', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as DataCardsPayload;
        if (!response.ok) {
          throw new Error(payload.error || `加载角色卡失败（${response.status}）`);
        }

        const nextCards = (Array.isArray(payload.cards) ? payload.cards : []).filter((card) => card.type === 'character');
        setCards(nextCards);
        setSelectedCardId((current) => {
          if (current && nextCards.some((card) => card.id === current)) {
            return current;
          }
          return nextCards[0]?.id ?? '';
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCards([]);
        setSelectedCardId('');
        setCardsError(error instanceof Error ? error.message : '加载角色卡失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCardsLoading(false);
        }
      });

    return () => controller.abort();
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!uploaderUsername) return;
    const uploaders = analysis?.uploaders ?? [];
    if (uploaders.length > 0 && !uploaders.includes(uploaderUsername)) {
      setUploaderUsername('');
    }
  }, [analysis, uploaderUsername]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !selectedCardId) {
      setAnalysis(null);
      setAnalysisLoading(false);
      setAnalysisError(null);
      aiSummaryRequestRef.current += 1;
      setAiSummary(null);
      setAiSummaryError(null);
      setAiSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ cardId: selectedCardId });
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (uploaderUsername) params.set('uploader', uploaderUsername);
    if (reportLimit !== 'all') params.set('reportLimit', reportLimit);

    setAnalysisLoading(true);
    setAnalysisError(null);
    aiSummaryRequestRef.current += 1;
    setAiSummary(null);
    setAiSummaryError(null);

    authStorage.fetch(`/api/me/character-report-analysis?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as AnalysisPayload;
        if (!response.ok || !payload.analysis) {
          throw new Error(payload.error || `加载分析失败（${response.status}）`);
        }
        setAnalysis(payload.analysis);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAnalysis(null);
        setAnalysisError(error instanceof Error ? error.message : '加载分析失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setAnalysisLoading(false);
        }
      });

    return () => controller.abort();
  }, [authLoading, fromDate, isAuthenticated, reportLimit, selectedCardId, toDate, uploaderUsername]);

  const selectedCard = useMemo(() => cards.find((card) => card.id === selectedCardId) ?? null, [cards, selectedCardId]);
  const recentTimeline = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.timeline].slice(-5).reverse();
  }, [analysis]);

  const resetFilters = () => {
    setFromDate('');
    setToDate('');
    setUploaderUsername('');
    setReportLimit('100');
  };

  const generateAiSummary = async () => {
    if (!selectedCardId || !analysis || aiSummaryLoading) return;
    const requestId = aiSummaryRequestRef.current + 1;
    aiSummaryRequestRef.current = requestId;
    setAiSummaryLoading(true);
    setAiSummaryError(null);

    try {
      const activityHeaders = await authStorage.getActivityHeaders();
      const response = await authStorage.fetch('/api/me/character-report-analysis/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...activityHeaders },
        cache: 'no-store',
        body: JSON.stringify({
          cardId: selectedCardId,
          model: summaryModel,
          filters: {
            from: fromDate || null,
            to: toDate || null,
            uploader: uploaderUsername || null,
            reportLimit,
          },
        }),
      });
      const payload = await response.json() as AiSummaryPayload;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || `生成 AI 总结失败（${response.status}）`);
      }
      if (requestId === aiSummaryRequestRef.current) setAiSummary(payload.summary);
    } catch (error: unknown) {
      if (requestId === aiSummaryRequestRef.current) {
        setAiSummaryError(error instanceof Error ? error.message : '生成 AI 总结失败');
      }
    } finally {
      if (requestId === aiSummaryRequestRef.current) setAiSummaryLoading(false);
    }
  };

  const selectedLimitLabel = REPORT_LIMIT_OPTIONS.find((option) => option.value === reportLimit)?.label ?? '最近 100 场';

  return (
    <main className="magic-background-white min-h-screen py-8">
      <div className="container">
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Character Battle Insights</p>
              <h1 className="text-3xl font-bold text-gray-900">角色战报分析</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                选择当前账号的角色卡，统计关联的现存 completed 战报，并按时间、上传人和数量范围筛选。
                已删除的战报不会计入统计。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/character-manager" className="text-blue-600 hover:underline">
                角色管理器
              </Link>
              <Link href="/me" className="text-blue-600 hover:underline">
                个人页
              </Link>
              <Link href="/" className="text-blue-600 hover:underline">
                返回首页
              </Link>
            </div>
          </div>

          {authLoading ? <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">登录状态检查中…</div> : null}

          {!authLoading && !isAuthenticated ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              你尚未登录。请先前往 <Link href="/character-manager" className="font-semibold underline underline-offset-2">角色管理器</Link> 完成登录后再访问分析页。
            </div>
          ) : null}

          {!authLoading && isAuthenticated && user ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              当前登录账号：<span className="font-semibold text-slate-900">{user.username}</span>
            </div>
          ) : null}

          {!authLoading && isAuthenticated ? (
            <div className="mt-6 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">角色卡</h2>
                    <p className="mt-1 text-xs text-slate-500">只显示当前账号未删除的角色卡。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{cards.length} 张</span>
                </div>

                {cardsLoading ? <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">正在读取角色卡…</div> : null}
                {cardsError ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{cardsError}</div> : null}

                <div className="mt-3 max-h-[380px] space-y-3 overflow-y-auto pr-1">
                  {!cardsLoading && cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                      当前账号没有可统计的角色卡。
                      <div className="mt-2">
                        <Link href="/character-manager" className="font-semibold text-blue-600 hover:underline">
                          前往角色管理器创建或整理角色卡
                        </Link>
                      </div>
                    </div>
                  ) : null}

                  {cards.map((card) => {
                    const active = card.id === selectedCardId;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setSelectedCardId(card.id)}
                        aria-pressed={active}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300/60'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate font-semibold text-slate-900">{card.name}</h3>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                              {card.description || '暂无简介'}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">
                            {active ? '已选中' : '切换'}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span>类型：{card.type || 'character'}</span>
                          <span>更新时间：{formatDateOnly(card.updated_at || card.created_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 border-t border-slate-200 pt-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Filter aria-hidden="true" className="h-4 w-4 text-indigo-500" />
                    筛选范围
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    时间、上传人和样本数量会一起作用到当前选中的角色卡。
                  </p>

                  <div className="mt-3 grid gap-3">
                    <label className="text-xs font-medium text-slate-700">
                      开始日期
                      <input
                        type="date"
                        value={fromDate}
                        onChange={(event) => setFromDate(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>

                    <label className="text-xs font-medium text-slate-700">
                      结束日期
                      <input
                        type="date"
                        value={toDate}
                        onChange={(event) => setToDate(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>

                    <label className="text-xs font-medium text-slate-700">
                      上传人
                      <select
                        value={uploaderUsername}
                        onChange={(event) => setUploaderUsername(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="">全部上传人</option>
                        {(analysis?.uploaders ?? []).map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>

                    <label className="text-xs font-medium text-slate-700">
                      统计数量
                      <select
                        value={reportLimit}
                        onChange={(event) => setReportLimit(event.target.value as typeof reportLimit)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        {REPORT_LIMIT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    重置筛选
                  </button>
                </div>
              </aside>

              <section className="space-y-5">
                <div className="rounded-2xl border border-slate-700 bg-slate-950/90 p-4 text-white shadow-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Selected Character</p>
                      <h2 className="mt-1 text-2xl font-bold text-white">
                        {selectedCard?.name || '请选择一个角色卡'}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                        {selectedCard?.description || '在左侧选择当前账号的角色卡后，这里会展示其战报统计、结论、优势与弱势。'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {analysisLoading ? <span className="rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200">更新中…</span> : null}
                      {analysis ? (
                        <div className="rounded-xl border border-indigo-300/20 bg-indigo-400/10 px-4 py-3 text-right text-xs text-slate-300">
                          <div>当前样本</div>
                          <div className="mt-1 text-lg font-bold text-indigo-200">{analysis.includedReports}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {selectedCard ? (
                    <div className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-slate-900/80 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">角色信息</div>
                        <dl className="mt-2 grid gap-2 text-sm text-slate-200">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <dt className="text-slate-400">卡片类型</dt>
                            <dd>{selectedCard.type || 'character'}</dd>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <dt className="text-slate-400">更新时间</dt>
                            <dd>{formatDateTime(selectedCard.updated_at || selectedCard.created_at)}</dd>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <dt className="text-slate-400">筛选数量</dt>
                            <dd>{selectedLimitLabel}</dd>
                          </div>
                        </dl>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">筛选摘要</div>
                        <p className="mt-2 text-sm leading-6 text-slate-200">
                          {[
                            fromDate ? `从 ${fromDate}` : '不限制开始时间',
                            toDate ? `到 ${toDate}` : '不限制结束时间',
                            uploaderUsername ? `上传人 ${uploaderUsername}` : '全部上传人',
                          ].join(' · ')}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {analysisError ? (
                    <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-2 text-sm text-red-200">
                      {analysisError}
                    </div>
                  ) : null}

                  {!analysisLoading && !analysis && selectedCard ? (
                    <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-4 text-sm text-slate-400">
                      请选择筛选范围或等待分析结果加载。
                    </div>
                  ) : null}

                  {!analysisLoading && !selectedCard ? (
                    <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-4 text-sm text-slate-400">
                      左侧选择一个角色卡后即可开始统计。
                    </div>
                  ) : null}

                  {analysis ? (
                    <div className="mt-5 space-y-5">
                      {analysis.moreAvailable ? (
                        <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                          当前仅统计最近 {analysis.includedReports} 场匹配战报，完整筛选结果共有 {analysis.totalReports} 场。
                          如需查看全部样本，请将“统计数量”切换为“全部战报”。
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          { label: '匹配战报', value: String(analysis.totalReports), hint: '满足当前筛选条件的总数' },
                          { label: '当前样本', value: String(analysis.includedReports), hint: '本次实际纳入分析的数量' },
                          { label: '胜率', value: formatRate(analysis.winRate), hint: `胜 ${analysis.wins} · 负 ${analysis.losses}` },
                          { label: 'K/D', value: formatKd(analysis.kd), hint: `胜负映射：击杀 ${analysis.kills} · 死亡 ${analysis.deaths}` },
                          { label: '平局', value: String(analysis.draws), hint: '不计入胜率和 K/D' },
                          { label: '未知', value: String(analysis.unknowns), hint: '胜负无法稳定识别' },
                          { label: '首场', value: formatDateOnly(analysis.firstStartedAt), hint: '最早匹配到的战报时间' },
                          { label: '末场', value: formatDateOnly(analysis.lastStartedAt), hint: '最近匹配到的战报时间' },
                        ].map((metric) => (
                          <article key={metric.label} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                            <div className="text-xs text-slate-400">{metric.label}</div>
                            <div className="mt-2 text-2xl font-bold text-white">{metric.value}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-400">{metric.hint}</div>
                          </article>
                        ))}
                      </div>

                      <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-white">战报最终结果</h3>
                          <span className="text-xs text-slate-400">已读取 {analysis.finalResultCount} / {analysis.includedReports} 场</span>
                        </div>
                        {analysis.finalResultCount > 0 ? (
                          <div className="mt-3 space-y-3">
                            {analysis.records.filter((record) => Boolean(record.finalResult)).slice(0, 5).map((record) => (
                              <article key={record.generationId} className="rounded-lg border border-white/10 bg-slate-950/70 p-3">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                                  <span>{formatDateTime(record.startedAt)}</span>
                                  <span>{getModeLabel(record.mode)}</span>
                                  <span>上传人：{record.username || '未知'}</span>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{record.finalResult}</p>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-slate-400">当前筛选样本没有可读取的最终结果正文。</p>
                        )}
                      </section>

                      <section className="rounded-xl border border-indigo-300/20 bg-indigo-950/35 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-100">
                            <Sparkles aria-hidden="true" className="h-4 w-4" />
                            AI 总结
                          </div>
                          <div className="flex flex-wrap items-end justify-end gap-2">
                            <label className="text-left text-xs text-indigo-100">
                              总结模型
                              <select
                                value={summaryModel}
                                onChange={(event) => setSummaryModel(event.target.value)}
                                disabled={aiSummaryLoading}
                                className="mt-1 block min-w-[190px] rounded-lg border border-indigo-200/20 bg-slate-950 px-3 py-2 text-sm text-white"
                              >
                                {SUMMARY_MODEL_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={generateAiSummary}
                              disabled={aiSummaryLoading || !analysis}
                              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-indigo-200/30 bg-indigo-400/20 px-3 py-2 text-sm font-semibold text-indigo-50 transition hover:bg-indigo-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Sparkles aria-hidden="true" className="h-4 w-4" />
                              {aiSummaryLoading ? '生成中…' : '生成 AI 总结'}
                            </button>
                          </div>
                        </div>
                        {aiSummaryError ? (
                          <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
                            {aiSummaryError}
                          </div>
                        ) : null}
                        {aiSummary ? (
                          <div className="mt-4 space-y-4">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-indigo-200/80">
                              <span>模型：{aiSummary.model}</span>
                              <span>生成时间：{formatDateTime(aiSummary.generatedAt)}</span>
                              <span className="break-all">生成键：{aiSummary.generationKey}</span>
                              {aiSummary.isFallback ? <span className="text-amber-200">部分内容回退到规则总结</span> : null}
                            </div>
                            <p className="text-sm leading-7 text-indigo-50">{aiSummary.conclusion}</p>
                            <div className="grid gap-4 xl:grid-cols-2">
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-200">AI 优势</h4>
                                <ul className="mt-2 space-y-2 text-sm leading-6 text-emerald-100">
                                  {aiSummary.strengths.map((item) => <li key={item}>• {item}</li>)}
                                </ul>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-200">AI 弱势</h4>
                                <ul className="mt-2 space-y-2 text-sm leading-6 text-rose-100">
                                  {aiSummary.weaknesses.map((item) => <li key={item}>• {item}</li>)}
                                </ul>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-indigo-100/70">选择模型后点击生成，规则统计总结会始终保留。</p>
                        )}
                      </section>

                      <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                          <Sparkles aria-hidden="true" className="h-4 w-4" />
                          规则统计总结
                        </div>
                        <p className="mt-3 text-sm leading-7 text-slate-200">{analysis.conclusion}</p>
                      </section>

                      <div className="grid gap-5 xl:grid-cols-2">
                        <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                          <h3 className="text-sm font-semibold text-white">优势</h3>
                          {analysis.strengths.length > 0 ? (
                            <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-100">
                              {analysis.strengths.map((item) => <li key={item}>• {item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-slate-400">当前样本下暂无足够明确的优势。</p>
                          )}
                        </section>

                        <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                          <h3 className="text-sm font-semibold text-white">弱势</h3>
                          {analysis.weaknesses.length > 0 ? (
                            <ul className="mt-3 space-y-2 text-sm leading-6 text-rose-100">
                              {analysis.weaknesses.map((item) => <li key={item}>• {item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-slate-400">当前样本下暂无足够明确的弱势。</p>
                          )}
                        </section>
                      </div>

                      <div className="grid gap-5 xl:grid-cols-2">
                        <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                          <h3 className="text-sm font-semibold text-white">模式分布</h3>
                          <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
                                <tr>
                                  <th className="px-0 py-2">模式</th>
                                  <th className="px-0 py-2">场次</th>
                                  <th className="px-0 py-2">胜/负/平/未知</th>
                                  <th className="px-0 py-2">胜率</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {analysis.modeBreakdown.length > 0 ? analysis.modeBreakdown.map((row) => (
                                  <tr key={row.label} className="text-slate-200">
                                    <td className="px-0 py-2 font-medium text-white">{row.label}</td>
                                    <td className="px-0 py-2">{row.count}</td>
                                    <td className="px-0 py-2">{row.wins}/{row.losses}/{row.draws}/{row.unknowns}</td>
                                    <td className="px-0 py-2">{formatRate(row.winRate)}</td>
                                  </tr>
                                )) : (
                                  <tr><td className="px-0 py-4 text-sm text-slate-400" colSpan={4}>暂无模式分布。</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>

                        <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                          <h3 className="text-sm font-semibold text-white">上传人分布</h3>
                          <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
                                <tr>
                                  <th className="px-0 py-2">上传人</th>
                                  <th className="px-0 py-2">场次</th>
                                  <th className="px-0 py-2">胜/负/平/未知</th>
                                  <th className="px-0 py-2">胜率</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {analysis.uploaderBreakdown.length > 0 ? analysis.uploaderBreakdown.map((row) => (
                                  <tr key={row.label} className="text-slate-200">
                                    <td className="px-0 py-2 font-medium text-white">{row.label}</td>
                                    <td className="px-0 py-2">{row.count}</td>
                                    <td className="px-0 py-2">{row.wins}/{row.losses}/{row.draws}/{row.unknowns}</td>
                                    <td className="px-0 py-2">{formatRate(row.winRate)}</td>
                                  </tr>
                                )) : (
                                  <tr><td className="px-0 py-4 text-sm text-slate-400" colSpan={4}>暂无上传人分布。</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      </div>

                      <section className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
                        <h3 className="text-sm font-semibold text-white">近期走势</h3>
                        {recentTimeline.length > 0 ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            {recentTimeline.map((point) => (
                              <article key={point.generationId} className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                                <div className="text-xs text-slate-400">{point.label}</div>
                                <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${OUTCOME_STYLES[point.outcome]}`}>
                                  {getOutcomeLabel(point.outcome)}
                                </div>
                                <div className="mt-2 text-xs leading-5 text-slate-400">上传人：{point.username || '未知'}</div>
                                <div className="mt-1 text-xs leading-5 text-slate-400">模式：{getModeLabel(point.mode)}</div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-lg bg-slate-950/80 p-2">
                                    <div className="text-slate-400">累计胜率</div>
                                    <div className="mt-1 font-semibold text-emerald-200">{formatRate(point.cumulativeWinRate)}</div>
                                  </div>
                                  <div className="rounded-lg bg-slate-950/80 p-2">
                                    <div className="text-slate-400">累计 K/D</div>
                                    <div className="mt-1 font-semibold text-cyan-200">{formatKd(point.cumulativeKd)}</div>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-slate-400">暂无可展示的走势数据。</p>
                        )}
                      </section>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
