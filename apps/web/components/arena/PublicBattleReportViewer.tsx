'use client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';

export type PublicBattleReport = {
  id: string;
  publicSince: string | null;
  startedAt: string;
  headline: string | null;
  winner: string | null;
  username: string | null;
  note: string | null;
  mode: string | null;
  scenarioTitle: string | null;
  output: string;
  language: string | null;
  storyLength: string | null;
  combatants: Array<{ sortIndex: number; name: string; type: string | null; teamId: number | null }>;
  renderedReport?: NewsReport;
  liveBody?: string | null;
};

type Props = {
  report: PublicBattleReport;
  formatDate: (value: string | null | undefined) => string;
  modeLabel: string;
  onClose: () => void;
};

const teamLabel = (teamId: number | null): string => {
  if (teamId === null) return '未分队';
  return `队伍 ${teamId}`;
};

export function PublicBattleReportViewer({ report, formatDate, modeLabel, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="公开战报">
      <article
        className="mx-auto min-h-[calc(100vh-1.5rem)] w-full max-w-[1440px] overflow-hidden rounded-2xl border border-white/15 bg-slate-100 shadow-2xl sm:min-h-0 sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 py-6 text-white sm:px-8 sm:py-8 lg:px-12">
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 max-w-5xl">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-pink-200">
                <span>生成模式：{modeLabel}</span>
                <span className="text-white/40">/</span>
                <span>公开竞技场档案</span>
              </div>
              <h2 className="mt-3 break-words text-2xl font-bold leading-tight sm:text-4xl lg:text-5xl">
                {report.headline || '未命名战报'}
              </h2>
              {report.scenarioTitle ? <p className="mt-3 text-sm text-slate-300 sm:text-base">情景：{report.scenarioTitle}</p> : null}
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300 sm:text-sm">
                <span>开始于 {formatDate(report.startedAt)}</span>
                <span>公开于 {formatDate(report.publicSince)}</span>
                <span>上传人：{report.username || '未知用户'}</span>
                {report.language ? <span>语言：{report.language}</span> : null}
              </div>
              {report.note ? <p className="mt-4 max-w-4xl border-l-2 border-pink-300/70 pl-3 text-sm leading-6 text-slate-200">备注：{report.note}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">
              关闭战报
            </button>
          </div>
        </header>

        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8 lg:p-8 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">战报结果</div>
              <div className="mt-3 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 p-4">
                <div className="text-xs text-slate-500">最终胜者</div>
                <div className="mt-1 break-words text-xl font-bold text-slate-900">{report.winner || '未解析'}</div>
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><dt className="text-slate-500">参战者</dt><dd className="font-semibold text-slate-800">{report.combatants.length} 位</dd></div>
                {report.storyLength ? <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><dt className="text-slate-500">战报长度</dt><dd className="font-semibold text-slate-800">{report.storyLength}</dd></div> : null}
                <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">档案编号</dt><dd className="max-w-[160px] truncate font-mono text-xs text-slate-500" title={report.id}>{report.id}</dd></div>
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">参战阵容</div>
              <div className="mt-3 space-y-2">
                {report.combatants.length > 0 ? report.combatants.map((combatant) => (
                  <div key={`${combatant.sortIndex}-${combatant.name}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words text-sm font-semibold text-slate-800">{combatant.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">#{combatant.sortIndex + 1}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{combatant.type || '参战者'} · {teamLabel(combatant.teamId)}</div>
                  </div>
                )) : <p className="text-sm text-slate-500">暂无参战者明细。</p>}
              </div>
            </section>
          </aside>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8 lg:px-12 lg:py-10">
            <div className="mb-7 flex items-center gap-3 border-b border-slate-100 pb-5">
              <span className="h-8 w-1 rounded-full bg-gradient-to-b from-pink-500 to-indigo-500" />
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Battle Report</div>
                <h3 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">战斗实录</h3>
              </div>
            </div>
            {report.renderedReport ? (
              <BattleReportCard
                report={report.renderedReport}
                mode={report.renderedReport.mode ?? undefined}
                liveBody={report.liveBody ?? undefined}
              />
            ) : (
              <MarkdownBlock content={report.output} variant="light" mode="article" className="public-battle-report-markdown" />
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
