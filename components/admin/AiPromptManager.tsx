'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, History, RotateCcw, Save, Upload } from 'lucide-react';

import { authStorage } from '@/lib/auth';

type PromptSlot = { name: string; description?: string; required?: boolean; example?: string };
type ManagedPrompt = {
  id: string;
  kind: 'text' | 'image' | 'schema';
  category: string;
  name: string;
  description: string;
  active: boolean;
  managementMode: 'replace' | 'overlay' | 'mixed' | 'inventory';
  source: string;
  defaultBody: string;
  effectiveBody: string;
  variables: PromptSlot[];
  revision: string | null;
  previousRevision: string | null;
  action: string;
  isOverridden: boolean;
  isDefault: boolean;
  updatedAt: string | null;
  defaultChanged: boolean;
  invalidOverride: boolean;
};
type PromptHistory = { id: string; revision: string; body: string; action: string; changeNote: string; createdAt?: string; updatedAt?: string; isDefault: boolean };
type BulkPromptResult = { promptId?: unknown; success?: unknown; status?: unknown; code?: unknown; error?: unknown };
type ApiErrorPayload = {
  error?: unknown;
  current?: ManagedPrompt | null;
  code?: unknown;
  partial?: unknown;
  appliedCount?: unknown;
  failedCount?: unknown;
  results?: BulkPromptResult[];
};
type ImportFailure = { promptId: string; status: number | null; code: string | null; error: string };
type ImportFailureReport = { appliedCount: number; failedCount: number; failures: ImportFailure[] };
type AiPromptManagerProps = { onDirtyChange?: (dirty: boolean) => void };

class AdminPromptRequestError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | null;

  constructor(status: number, message: string, payload: ApiErrorPayload | null) {
    super(message);
    this.name = 'AdminPromptRequestError';
    this.status = status;
    this.payload = payload;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  character: '角色生成', creator: 'Creator', tavern: 'Tavern', arena: '竞技场 / PVP', safety: '内容安全', review: '审核与分析', 'tea-party': '魔法茶会', image: '图像提示词', schema: 'Schema 约束',
};
const MANAGEMENT_MODE_LABELS: Record<ManagedPrompt['managementMode'], string> = {
  replace: '完整替换', overlay: '叠加保护层', mixed: '结构化替换 / 流式保护', inventory: '仅盘点',
};

const downloadJson = (filename: string, value: unknown) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseImportFailureReport = (payload: ApiErrorPayload | null): ImportFailureReport | null => {
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];
  const failures = rawResults
    .filter((result) => result?.success !== true)
    .map((result): ImportFailure => ({
      promptId: typeof result.promptId === 'string' && result.promptId.trim() ? result.promptId : '(未知 ID)',
      status: typeof result.status === 'number' && Number.isFinite(result.status) ? result.status : null,
      code: typeof result.code === 'string' && result.code.trim() ? result.code : null,
      error: typeof result.error === 'string' && result.error.trim() ? result.error : '提示词保存失败',
    }));
  if (failures.length === 0) return null;
  const appliedCount = typeof payload?.appliedCount === 'number' && Number.isFinite(payload.appliedCount)
    ? Math.max(0, Math.trunc(payload.appliedCount))
    : rawResults.filter((result) => result?.success === true).length;
  const failedCount = typeof payload?.failedCount === 'number' && Number.isFinite(payload.failedCount)
    ? Math.max(failures.length, Math.trunc(payload.failedCount))
    : failures.length;
  return { appliedCount, failedCount, failures };
};

export function AiPromptManager({ onDirtyChange }: AiPromptManagerProps) {
  const [prompts, setPrompts] = useState<ManagedPrompt[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [originalDraft, setOriginalDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive' | 'overridden'>('all');
  const [changeNote, setChangeNote] = useState('');
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<ManagedPrompt | null>(null);
  const [importFailureReport, setImportFailureReport] = useState<ImportFailureReport | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await authStorage.fetch(url, { ...init, cache: 'no-store' });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
      const message = typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : `请求失败（HTTP ${response.status}）`;
      throw new AdminPromptRequestError(response.status, message, payload);
    }
    return response;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await request('/api/admin/ai-prompts');
      const payload = await response.json() as { prompts?: ManagedPrompt[] };
      const next = Array.isArray(payload.prompts) ? payload.prompts : [];
      setPrompts(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '提示词加载失败');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const selected = prompts.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected) {
      setDraft('');
      setOriginalDraft('');
      setChangeNote('');
      return;
    }
    setDraft(selected.effectiveBody);
    setOriginalDraft(selected.effectiveBody);
    setChangeNote('');
    setHistory([]);
    setHistoryCursor(null);
    setHistoryHasMore(false);
    setShowHistory(false);
    setConflictPrompt(null);
  }, [selected]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return prompts.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (status === 'active' && !item.active) return false;
      if (status === 'inactive' && item.active) return false;
      if (status === 'overridden' && !item.isOverridden) return false;
      if (!query) return true;
      return `${item.id} ${item.name} ${item.description} ${item.source}`.toLowerCase().includes(query);
    });
  }, [category, prompts, search, status]);

  const isDirty = draft !== originalDraft;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const save = async (reset = false) => {
    if (!selected) return;
    if (!changeNote.trim()) {
      setError('保存、恢复默认和回滚都必须填写变更说明');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const promptId = selected.id;
    try {
      const response = await request('/api/admin/ai-prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId, template: reset ? null : draft, expectedRevision: conflictPrompt?.revision ?? selected.revision, changeNote: changeNote.trim() }),
      });
      const payload = await response.json() as { prompt?: ManagedPrompt };
      if (payload.prompt?.id === promptId) {
        setPrompts((current) => current.map((item) => item.id === payload.prompt!.id ? payload.prompt! : item));
        setDraft(payload.prompt.effectiveBody);
        setOriginalDraft(payload.prompt.effectiveBody);
      } else {
        throw new Error('服务端返回了不匹配的提示词版本');
      }
      setNotice(reset ? '已生成恢复默认版本' : '提示词已保存并立即生效');
      setChangeNote('');
      setConflictPrompt(null);
    } catch (saveError) {
      if (saveError instanceof AdminPromptRequestError && saveError.status === 409) {
        const current = saveError.payload?.current;
        setConflictPrompt(current && current.id === selected.id ? current : null);
        setError(current
          ? '该提示词已被其他管理员修改。本地草稿已保留，请比较服务端版本后合并或重试。'
          : '该提示词已被其他管理员修改。本地草稿已保留，请刷新后重试。');
      } else {
        setError(saveError instanceof Error ? saveError.message : '提示词保存失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (append = false) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const cursor = append ? historyCursor : null;
      const params = new URLSearchParams({ promptId: selected.id, limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const response = await request(`/api/admin/ai-prompts/history?${params.toString()}`);
      const payload = await response.json() as { history?: PromptHistory[]; nextCursor?: string | null; hasMore?: boolean };
      const page = Array.isArray(payload.history) ? payload.history : [];
      setHistory((current) => append
        ? [...current, ...page.filter((item) => !current.some((existing) => existing.id === item.id))]
        : page);
      setHistoryCursor(typeof payload.nextCursor === 'string' ? payload.nextCursor : null);
      setHistoryHasMore(payload.hasMore === true);
      setShowHistory(true);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : '历史版本加载失败');
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (item: PromptHistory) => {
    if (!selected) return;
    const note = window.prompt('请输入回滚变更说明', `回滚到 ${item.revision.slice(0, 8)}`)?.trim();
    if (!note) return;
    setBusy(true);
    try {
      const response = await request('/api/admin/ai-prompts/rollback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId: selected.id, historyId: item.id, expectedRevision: conflictPrompt?.revision ?? selected.revision, changeNote: note }),
      });
      const payload = await response.json() as { prompt?: ManagedPrompt };
      if (payload.prompt) {
        setPrompts((current) => current.map((entry) => entry.id === payload.prompt!.id ? payload.prompt! : entry));
        setDraft(payload.prompt.effectiveBody);
        setOriginalDraft(payload.prompt.effectiveBody);
      }
      setNotice('已创建新的回滚版本');
      setShowHistory(false);
    } catch (rollbackError) {
      if (rollbackError instanceof AdminPromptRequestError && rollbackError.status === 409) {
        const current = rollbackError.payload?.current;
        setConflictPrompt(current && current.id === selected.id ? current : null);
        setError(current
          ? '回滚基于的版本已过期。本地草稿已保留，请比较服务端版本后重试。'
          : '回滚基于的版本已过期。本地草稿已保留，请刷新后重试。');
      } else {
        setError(rollbackError instanceof Error ? rollbackError.message : '回滚失败，本地草稿仍保留');
      }
    } finally {
      setBusy(false);
    }
  };

  const exportPrompts = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await request('/api/admin/ai-prompts/export');
      downloadJson(`mahoshojo-ai-prompts-${new Date().toISOString().slice(0, 10)}.json`, await response.json());
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  const importPrompts = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setImportFailureReport(null);
    try {
      if (isDirty && !window.confirm('当前提示词草稿尚未保存。继续导入会刷新列表，确定放弃该草稿吗？')) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('导入文件不能超过 2 MiB');
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new Error('导入文件不是合法 JSON');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('导入文件顶层必须是 JSON 对象');
      }
      const importObject = parsed as Record<string, unknown>;
      if (importObject.version !== undefined && importObject.version !== 1) {
        throw new Error('不支持的提示词导入版本');
      }
      if (!Array.isArray(importObject.prompts) && !Array.isArray(importObject.items) && (typeof importObject.prompts !== 'object' || importObject.prompts === null)) {
        throw new Error('导入文件必须包含 prompts 或 items');
      }
      const note = window.prompt('请输入导入变更说明')?.trim() ?? '';
      if (!note) return;
      const response = await request('/api/admin/ai-prompts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...importObject, changeNote: note }),
      });
      const payload = await response.json() as ApiErrorPayload;
      setImportFailureReport(parseImportFailureReport(payload));
      setNotice(payload.partial
        ? `导入部分完成：成功 ${typeof payload.appliedCount === 'number' ? payload.appliedCount : 0} 项，失败 ${typeof payload.failedCount === 'number' ? payload.failedCount : 0} 项。`
        : `导入完成：已生成 ${typeof payload.appliedCount === 'number' ? payload.appliedCount : 0} 个新版本。`);
      await load();
    } catch (importError) {
      if (importError instanceof AdminPromptRequestError) {
        setImportFailureReport(parseImportFailureReport(importError.payload));
      }
      setError(importError instanceof Error ? importError.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const categories = Array.from(new Set(prompts.map((item) => item.category)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600">固定业务模板和图像推荐词均可在此维护；动态角色卡、问卷、战报和用户输入只会作为运行时变量。Schema 文字目前只做盘点。</p>
          <p className="mt-1 text-xs text-gray-500">保存后当前 Worker 立即使用，其他 Worker 会在约 30 秒内刷新。未接入项会明确标记，不会误称为已生效。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void exportPrompts()} className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"><Download size={15} />导出 JSON</button>
          <label className={`inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-2 text-sm ${busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><Upload size={15} />导入 JSON<input type="file" disabled={busy} accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPrompts(file); event.target.value = ''; }} /></label>
        </div>
      </div>
      {importFailureReport ? <div role="status" className="border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><p>导入失败报告：成功 {importFailureReport.appliedCount} 项，失败 {importFailureReport.failedCount} 项。</p><button type="button" onClick={() => downloadJson(`mahoshojo-ai-prompt-import-failures-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, generatedAt: new Date().toISOString(), appliedCount: importFailureReport.appliedCount, failedCount: importFailureReport.failedCount, failures: importFailureReport.failures })} className="inline-flex items-center gap-1 border border-amber-400 bg-white px-2 py-1 text-xs"><Download size={13} />下载失败清单</button></div><div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-amber-200 pt-2 text-xs">{importFailureReport.failures.map((failure, index) => <p key={`${failure.promptId}-${index}`} className="break-words"><span className="font-mono">{failure.promptId}</span>{failure.status ? ` · HTTP ${failure.status}` : ''}{failure.code ? ` · ${failure.code}` : ''}：{failure.error}</p>)}</div></div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.34fr)_minmax(0,1fr)]">
        <aside className="min-h-[280px] rounded border border-gray-200 bg-gray-50 p-3 lg:min-h-[520px]">
          <div className="space-y-2">
            <input aria-label="搜索 AI 提示词" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 ID、名称或作用" className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2"><select aria-label="按提示词分类筛选" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-gray-300 bg-white px-2 py-2 text-xs"><option value="all">全部分类</option>{categories.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item] ?? item}</option>)}</select><select aria-label="按提示词状态筛选" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded border border-gray-300 bg-white px-2 py-2 text-xs"><option value="all">全部状态</option><option value="active">生产中</option><option value="inactive">未接入</option><option value="overridden">已有覆盖</option></select></div>
          </div>
          <div className="mt-3 max-h-[340px] space-y-1 overflow-y-auto lg:max-h-[650px]">{loading ? <p className="px-2 py-8 text-center text-xs text-gray-500">加载中…</p> : filtered.map((item) => <button type="button" disabled={busy} key={item.id} onClick={() => { if (isDirty && !window.confirm('当前草稿尚未保存，确定切换吗？')) return; setSelectedId(item.id); }} className={`w-full rounded border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${item.id === selectedId ? 'border-blue-400 bg-blue-50' : 'border-transparent bg-white hover:border-gray-300'}`}><span className="block truncate text-sm font-medium text-gray-800">{item.name}</span><span className="mt-1 block truncate font-mono text-[10px] text-gray-500">{item.id}</span><span className="mt-1 flex flex-wrap gap-1 text-[10px]"><span className={`rounded px-1.5 py-0.5 ${item.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{item.active ? '生产中' : '未接入'}</span>{item.isOverridden ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">已覆盖</span> : null}{item.invalidOverride ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">无效</span> : null}</span></button>)}{!loading && filtered.length === 0 ? <p className="px-2 py-8 text-center text-xs text-gray-500">没有匹配项</p> : null}</div>
        </aside>
        <section className="min-w-0 rounded border border-gray-200 p-4">
          {selected ? <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-900">{selected.name}</h3><p className="mt-1 text-sm text-gray-600">{selected.description}</p><p className="mt-1 break-all font-mono text-[11px] text-gray-400">{selected.source} · revision {selected.revision ?? 'default'}</p></div><div className="flex flex-wrap gap-1"><span className={`rounded px-2 py-1 text-xs ${selected.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{selected.active ? '当前生产调用' : '当前未接入'}</span><span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{MANAGEMENT_MODE_LABELS[selected.managementMode]}</span></div></div>
            <div id="ai-prompt-template-help" className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">关键占位符必须保留，未知占位符会被拒绝。管理员模板不能移除服务端鉴权、内容安全、所有权校验和输出协议等代码级保护。</div>
            <div className="mt-3 flex flex-wrap gap-1">{selected.variables.length ? selected.variables.map((slot) => <span key={slot.name} title={slot.description} className={`rounded px-2 py-1 text-xs ${slot.required ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{`{{${slot.name}}}`}{slot.required ? ' *' : ''}</span>) : <span className="text-xs text-gray-500">无运行时占位符</span>}</div>
            <textarea aria-label={`${selected.name}提示词正文`} aria-describedby="ai-prompt-template-help" disabled={busy} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} className="mt-3 min-h-[360px] w-full rounded border border-gray-300 p-3 font-mono text-sm leading-6 disabled:bg-gray-50" />
            {conflictPrompt ? <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><div className="flex flex-wrap items-center justify-between gap-2"><span>服务端最新版 · revision {conflictPrompt.revision ?? 'default'}</span><button type="button" onClick={() => { setPrompts((current) => current.map((item) => item.id === conflictPrompt.id ? conflictPrompt : item)); setDraft(conflictPrompt.effectiveBody); setOriginalDraft(conflictPrompt.effectiveBody); setConflictPrompt(null); setError(null); }} className="rounded border border-amber-400 bg-white px-2 py-1">载入服务端版本</button></div><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-t border-amber-200 pt-2 font-mono text-[11px]">{conflictPrompt.effectiveBody}</pre><p className="mt-2">继续保存将使用该 revision 做 CAS；请先在上方草稿中完成合并。</p></div> : null}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{draft.length.toLocaleString()} 字符 / {new TextEncoder().encode(draft).byteLength.toLocaleString()} 字节{isDirty ? ' · 未保存' : ''}</span><span>{selected.isDefault ? '当前使用代码默认值' : '当前使用管理员覆盖值'}</span></div>
            <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-[240px] flex-1 text-xs text-gray-600">变更说明<input disabled={busy} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={500} placeholder="例如：补充输出语言约束" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label><button type="button" disabled={busy || !isDirty} onClick={() => void save(false)} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Save size={15} />保存</button><button type="button" disabled={busy} onClick={() => void save(true)} className="inline-flex items-center gap-1 rounded border border-amber-300 px-3 py-2 text-sm text-amber-800 disabled:opacity-50"><RotateCcw size={15} />恢复默认</button><button type="button" disabled={busy} onClick={() => void loadHistory(false)} className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-2 text-sm"><History size={15} />历史</button></div>
            {showHistory ? <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3"><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">不可变历史版本</h4><button type="button" onClick={() => setShowHistory(false)} className="text-xs text-gray-500">关闭</button></div><div className="max-h-64 space-y-2 overflow-auto">{history.map((item) => <div key={item.id} className="rounded border border-gray-200 bg-white p-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-mono">{item.revision}</span><span>{item.action} · {item.changeNote}</span></div><pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap text-[11px] text-gray-600">{item.body}</pre><button type="button" disabled={busy || item.revision === selected.revision} onClick={() => void rollback(item)} className="mt-2 inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 disabled:opacity-50"><RotateCcw size={13} />生成回滚版本</button></div>)}{historyHasMore ? <button type="button" disabled={busy || !historyCursor} onClick={() => void loadHistory(true)} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-xs disabled:opacity-50">加载更多历史</button> : null}{history.length === 0 ? <p className="py-4 text-center text-xs text-gray-500">暂无历史版本</p> : null}</div></div> : null}
          </> : <p className="py-16 text-center text-sm text-gray-500">选择一个提示词开始编辑</p>}
          {error ? <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {notice ? <p aria-live="polite" className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}
        </section>
      </div>
    </div>
  );
}
