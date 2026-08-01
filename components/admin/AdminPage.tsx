'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import { configurationCatalog } from '@/lib/admin/configuration-catalog';

type AdminCard = {
  id: string;
  userId: number;
  username: string;
  type: string;
  name: string;
  description: string | null;
  data: string;
  isPublic: number;
  reviewStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type AdminUser = {
  id: number;
  username: string;
  email: string;
  isBanned: string | null;
  isAdmin: boolean;
  isReviewExempt: boolean;
  slotCount: number | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  cardCount: number;
  pendingCardCount: number;
};

type AdminBattleReport = {
  id: string;
  userId: number | null;
  username: string | null;
  headline: string | null;
  mode: string | null;
  status: string;
  endpoint: string;
  isPublic: number;
  startedAt: string;
  pvpMatchId: string | null;
};

type AdminImageGenerationLicense = {
  id: string;
  keyPrefix: string;
  maxUses: number;
  remainingUses: number;
  expiresAt: string;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Tab = 'cards' | 'reports' | 'users' | 'licenses' | 'settings';
type CardStatus = 'pending' | 'approved' | 'rejected' | 'all';
type AdminUserPatch = { isBanned?: boolean; isAdmin?: boolean; isReviewExempt?: boolean; slotCount?: number };
type CooldownSettings = { systemSeconds: number; freeSeconds: number; customSeconds: number; battleSeconds: number };

const readError = async (response: Response, fallback: string): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return typeof payload?.error === 'string' && payload.error.trim() ? payload.error : fallback;
};

const formatDate = (value: string | null): string => value ? new Date(value).toLocaleString() : '暂无';

const cardTypeLabel: Record<string, string> = {
  character: '角色',
  scenario: '情景',
  history: '历史',
  questionnaire: '问卷',
};

export function AdminPage() {
  const { loading: authLoading, isAuthenticated, user: currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('cards');
  const [status, setStatus] = useState<CardStatus>('pending');
  const [cardSearch, setCardSearch] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reports, setReports] = useState<AdminBattleReport[]>([]);
  const [licenses, setLicenses] = useState<AdminImageGenerationLicense[]>([]);
  const [licenseUses, setLicenseUses] = useState(10);
  const [licenseHours, setLicenseHours] = useState(24);
  const [createdLicenseKey, setCreatedLicenseKey] = useState<string | null>(null);
  const [cooldownSettings, setCooldownSettings] = useState<CooldownSettings>({ systemSeconds: 60, freeSeconds: 120, customSeconds: 3, battleSeconds: 120 });
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await authStorage.fetch(url, { ...init, cache: 'no-store' });
    if (!response.ok) throw new Error(await readError(response, `请求失败（HTTP ${response.status}）`));
    return response;
  }, []);

  const loadCards = useCallback(async () => {
    const params = new URLSearchParams({ status, type: 'character', limit: '100' });
    if (cardSearch.trim()) params.set('search', cardSearch.trim());
    const response = await request(`/api/admin/data-cards?${params.toString()}`);
    const payload = (await response.json()) as { cards?: AdminCard[] };
    setCards(Array.isArray(payload.cards) ? payload.cards : []);
  }, [cardSearch, request, status]);

  const loadUsers = useCallback(async () => {
    const params = userSearch.trim() ? `?search=${encodeURIComponent(userSearch.trim())}` : '';
    const response = await request(`/api/admin/users${params}`);
    const payload = (await response.json()) as { users?: AdminUser[] };
    setUsers(Array.isArray(payload.users) ? payload.users : []);
  }, [request, userSearch]);

  const loadReports = useCallback(async () => {
    const params = reportSearch.trim() ? `?search=${encodeURIComponent(reportSearch.trim())}` : '';
    const response = await request(`/api/admin/battle-reports${params}`);
    const payload = (await response.json()) as { reports?: AdminBattleReport[] };
    setReports(Array.isArray(payload.reports) ? payload.reports : []);
  }, [reportSearch, request]);

  const loadSettings = useCallback(async () => {
    const response = await request('/api/admin/settings');
    const payload = (await response.json()) as { publicAiCooldown?: CooldownSettings };
    if (payload.publicAiCooldown) setCooldownSettings(payload.publicAiCooldown);
  }, [request]);

  const loadLicenses = useCallback(async () => {
    const response = await request('/api/admin/image-generation-licenses');
    const payload = (await response.json()) as { licenses?: AdminImageGenerationLicense[] };
    setLicenses(Array.isArray(payload.licenses) ? payload.licenses : []);
  }, [request]);

  const load = useCallback(async () => {
    if (authLoading || !isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'cards') await loadCards();
      else if (tab === 'reports') await loadReports();
      else if (tab === 'users') await loadUsers();
      else if (tab === 'licenses') await loadLicenses();
      else await loadSettings();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '管理员数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [authLoading, isAuthenticated, loadCards, loadLicenses, loadReports, loadSettings, loadUsers, tab]);

  useEffect(() => { void load(); }, [load]);

  const updateCard = async (cardId: string, action: 'approve' | 'reject' | 'private') => {
    setError(null);
    try {
      await request('/api/admin/data-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, action }),
      });
      setNotice(action === 'approve' ? '角色卡已通过公开审核' : action === 'reject' ? '角色卡已拒绝并封禁公开状态' : '角色卡已撤回公开');
      await loadCards();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '审核操作失败');
    }
  };

  const updateUser = async (userId: number, patch: AdminUserPatch) => {
    setError(null);
    try {
      await request('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...patch }),
      });
      setNotice('用户状态已更新');
      await loadUsers();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '用户更新失败');
    }
  };

  const deleteReport = async (generationId: string) => {
    if (!window.confirm('确定永久删除这条战报吗？公开展示、正文和参战者明细都会被删除，且无法恢复。')) return;
    setError(null);
    try {
      await request('/api/admin/battle-reports', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId }),
      });
      setNotice('战报及其公开记录已删除');
      await loadReports();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '战报删除失败');
    }
  };

  const saveSettings = async () => {
    setError(null);
    try {
      await request('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicAiCooldown: cooldownSettings }),
      });
      setNotice('生成等待时长已保存，后续新请求立即生效');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '设置保存失败');
    }
  };

  const createLicense = async () => {
    setError(null);
    setCreatedLicenseKey(null);
    try {
      const response = await request('/api/admin/image-generation-licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxUses: licenseUses, validForSeconds: licenseHours * 60 * 60 }),
      });
      const payload = (await response.json()) as { licenseKey?: string };
      if (!payload.licenseKey) throw new Error('服务器未返回许可密钥');
      setCreatedLicenseKey(payload.licenseKey);
      setNotice('许可密钥创建成功，请立即复制保存');
      await loadLicenses();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '许可密钥创建失败');
    }
  };

  const revokeLicense = async (id: string) => {
    if (!window.confirm('确定撤销这个图片生成许可吗？撤销后不可恢复。')) return;
    setError(null);
    try {
      await request('/api/admin/image-generation-licenses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setNotice('图片生成许可已撤销');
      await loadLicenses();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : '许可证撤销失败');
    }
  };

  const copyCreatedLicense = async () => {
    if (!createdLicenseKey) return;
    try {
      await navigator.clipboard.writeText(createdLicenseKey);
      setNotice('许可密钥已复制');
    } catch {
      setError('复制失败，请手动复制许可密钥');
    }
  };

  const title = useMemo(() => tab === 'cards' ? '角色卡审核' : tab === 'reports' ? '战报管理' : tab === 'users' ? '用户管理' : tab === 'licenses' ? '图片生成许可' : '系统设置', [tab]);

  if (authLoading) return <main className="container py-10 text-sm text-gray-600">正在验证管理员身份…</main>;
  if (!isAuthenticated) return <main className="container py-10"><div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">请先登录后访问管理员工作台。</div></main>;

  return (
    <main className="magic-background-white min-h-screen py-6">
      <div className="container">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">MahoShojo Control</p>
            <h1 className="text-2xl font-bold text-gray-900">管理员工作台</h1>
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">返回首页</Link>
        </div>

        <div className="mb-4 flex gap-2 border-b border-gray-200">
          {([['cards', '角色卡审核'], ['reports', '战报管理'], ['users', '用户管理'], ['licenses', '图片许可'], ['settings', '系统设置']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === value ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>

        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div> : null}

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-gray-500">所有操作均在服务端重新验证管理员权限，并记录审计日志。</p></div>
            {tab === 'cards' ? (
              <div className="flex flex-wrap gap-2">
                <select value={status} onChange={(event) => setStatus(event.target.value as CardStatus)} className="rounded border border-gray-300 px-2 py-2 text-sm">
                  <option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="all">全部</option>
                </select>
                <input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadCards(); }} placeholder="搜索名称或作者" className="rounded border border-gray-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => void loadCards()} className="rounded bg-gray-900 px-3 py-2 text-sm text-white">刷新</button>
              </div>
            ) : tab === 'reports' ? (
              <div className="flex gap-2"><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadReports(); }} placeholder="搜索标题、作者或战报 ID" className="rounded border border-gray-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void loadReports()} className="rounded bg-gray-900 px-3 py-2 text-sm text-white">刷新</button></div>
            ) : tab === 'licenses' ? (
              <button type="button" onClick={() => void loadLicenses()} className="rounded bg-gray-900 px-3 py-2 text-sm text-white">刷新</button>
            ) : (
              <div className="flex gap-2"><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadUsers(); }} placeholder="搜索用户名或邮箱" className="rounded border border-gray-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void loadUsers()} className="rounded bg-gray-900 px-3 py-2 text-sm text-white">刷新</button></div>
            )}
          </div>

          {loading ? <p className="py-8 text-center text-sm text-gray-500">加载中…</p> : null}
          {!loading && tab === 'cards' ? <div className="space-y-3">{cards.map((card) => {
            const expanded = expandedCardId === card.id;
            return <article key={card.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{card.name || '未命名角色卡'}</h3><p className="text-xs text-gray-500">{cardTypeLabel[card.type] ?? card.type} · 作者 {card.username}（ID {card.userId}）· {formatDate(card.createdAt)}</p><p className="mt-1 text-sm text-gray-600">{card.description || '无描述'}</p></div><span className="rounded-full bg-yellow-50 px-2 py-1 text-xs text-yellow-700">{card.reviewStatus ?? '未知'}</span></div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setExpandedCardId(expanded ? null : card.id)} className="rounded border border-gray-300 px-3 py-1.5 text-sm">{expanded ? '收起内容' : '查看内容'}</button><button type="button" onClick={() => void updateCard(card.id, 'approve')} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white">通过公开</button><button type="button" onClick={() => void updateCard(card.id, 'reject')} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white">拒绝/封禁</button><button type="button" onClick={() => void updateCard(card.id, 'private')} className="rounded bg-gray-700 px-3 py-1.5 text-sm text-white">撤回公开</button></div>
              {expanded ? <pre className="mt-3 max-h-96 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{(() => { try { return JSON.stringify(JSON.parse(card.data), null, 2); } catch { return card.data; } })()}</pre> : null}
            </article>;
          })}{!cards.length ? <p className="py-8 text-center text-sm text-gray-500">没有符合条件的角色卡。</p> : null}</div> : null}
          {!loading && tab === 'reports' ? <div className="space-y-3">{reports.map((report) => <article key={report.id} className="rounded-lg border border-gray-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{report.headline || '未命名战报'}</h3><p className="mt-1 text-xs text-gray-500">{report.username || '匿名用户'}（ID {report.userId ?? '未知'}）· {formatDate(report.startedAt)} · {report.mode || '未知模式'}</p><p className="mt-1 break-all font-mono text-[11px] text-gray-400">{report.id}</p></div><div className="flex shrink-0 flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 ${report.isPublic === 1 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{report.isPublic === 1 ? '已公开' : '私有'}</span>{report.pvpMatchId ? <span className="rounded-full bg-purple-50 px-2 py-1 text-purple-700">PVP</span> : null}<span className="text-gray-500">{report.status}</span></div></div><div className="mt-3 flex justify-end"><button type="button" onClick={() => void deleteReport(report.id)} className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">永久删除战报</button></div></article>)}{!reports.length ? <p className="py-8 text-center text-sm text-gray-500">没有符合条件的战报。</p> : null}</div> : null}
          {!loading && tab === 'users' ? <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs text-gray-500"><th className="px-2 py-2">用户</th><th className="px-2 py-2">角色卡</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b align-top"><td className="px-2 py-3"><div className="font-medium">{user.username}</div><div className="text-xs text-gray-500">{user.email} · ID {user.id}</div><div className="text-xs text-gray-400">注册 {formatDate(user.createdAt)} · 登录 {formatDate(user.lastLoginAt)}</div></td><td className="px-2 py-3">{user.cardCount} 张<div className="text-xs text-yellow-700">待审 {user.pendingCardCount}</div></td><td className="px-2 py-3"><div>{user.isAdmin ? '管理员' : '普通用户'}</div><div>{user.isReviewExempt ? '审核豁免' : '需要审核'}</div><div>{user.isBanned ? `已封禁（${user.isBanned}）` : '正常'}</div><div className="text-xs text-gray-500">槽位 {user.slotCount ?? '默认'}</div></td><td className="space-y-1 px-2 py-3"><div className="flex flex-wrap gap-1"><button type="button" disabled={user.id === currentUser?.id} onClick={() => void updateUser(user.id, { isBanned: Boolean(!user.isBanned) })} className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50">{user.isBanned ? '解除封禁' : '封禁'}</button><button type="button" onClick={() => void updateUser(user.id, { isReviewExempt: !user.isReviewExempt })} className="rounded border border-gray-300 px-2 py-1 text-xs">{user.isReviewExempt ? '取消豁免' : '授予豁免'}</button>{user.id !== currentUser?.id ? <button type="button" onClick={() => void updateUser(user.id, { isAdmin: !user.isAdmin })} className="rounded border border-gray-300 px-2 py-1 text-xs">{user.isAdmin ? '取消管理员' : '设为管理员'}</button> : null}</div><label className="flex items-center gap-1 text-xs text-gray-600">角色卡槽位 <input type="number" min="0" max="1000" defaultValue={user.slotCount ?? ''} onBlur={(event) => { const value = event.target.value.trim(); if (value) void updateUser(user.id, { slotCount: Number(value) }); }} className="w-20 rounded border border-gray-300 px-1 py-1" /></label></td></tr>)}</tbody></table>{!users.length ? <p className="py-8 text-center text-sm text-gray-500">没有符合条件的用户。</p> : null}</div> : null}
          {!loading && tab === 'licenses' ? <div className="space-y-6">
            <section className="max-w-2xl rounded-lg border border-blue-100 bg-blue-50/50 p-4">
              <h3 className="font-semibold text-gray-900">创建图片生成许可</h3>
              <p className="mt-1 text-sm text-gray-600">许可密钥只在创建成功后显示一次，数据库不会保存明文密钥。</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-gray-700">生成次数<input type="number" min="1" max="1000000" value={licenseUses} onChange={(event) => setLicenseUses(Number(event.target.value))} className="mt-1 w-full rounded border border-gray-300 px-3 py-2" /></label>
                <label className="text-sm text-gray-700">有效时间（小时）<input type="number" min="1" max="8760" value={licenseHours} onChange={(event) => setLicenseHours(Number(event.target.value))} className="mt-1 w-full rounded border border-gray-300 px-3 py-2" /></label>
              </div>
              <button type="button" onClick={() => void createLicense()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">创建许可密钥</button>
              {createdLicenseKey ? <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">请立即复制，离开或刷新页面后不会再次显示</p><div className="mt-2 flex gap-2"><input readOnly value={createdLicenseKey} className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-3 py-2 font-mono text-sm" /><button type="button" onClick={() => void copyCreatedLicense()} className="shrink-0 rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white">复制</button></div></div> : null}
            </section>
            <section>
              <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-gray-900">已有图片生成许可</h3><span className="text-xs text-gray-500">共 {licenses.length} 个</span></div>
              <div className="space-y-3">{licenses.map((license) => {
                const expired = new Date(license.expiresAt).getTime() <= Date.now();
                const inactive = Boolean(license.revokedAt) || expired || license.remainingUses <= 0;
                return <article key={license.id} className="rounded-lg border border-gray-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-sm text-gray-800">{license.keyPrefix}…</p><p className="mt-1 text-xs text-gray-500">创建于 {formatDate(license.createdAt)} · 到期 {formatDate(license.expiresAt)}</p></div><span className={`rounded-full px-2 py-1 text-xs ${inactive ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'}`}>{inactive ? '已失效' : '有效'}</span></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>剩余 {license.remainingUses} / {license.maxUses} 次</span>{!inactive ? <button type="button" onClick={() => void revokeLicense(license.id)} className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">撤销许可</button> : null}</div></article>;
              })}</div>{!licenses.length ? <p className="py-8 text-center text-sm text-gray-500">暂无图片生成许可。</p> : null}
            </section>
          </div> : null}
          {!loading && tab === 'settings' ? <div className="space-y-6"><section className="max-w-xl space-y-4"><div><h3 className="font-semibold">生成后等待时长</h3><p className="mt-1 text-sm text-gray-500">在线配置，单位为秒，范围 0 到 86400。修改后新请求立即使用新值。</p></div>{([['systemSeconds', '系统供应商生成间隔'], ['freeSeconds', '免费生成间隔'], ['customSeconds', '自定义供应商生成间隔'], ['battleSeconds', '战斗/战报生成间隔']] as const).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded border border-gray-200 px-3 py-3 text-sm"><span>{label}</span><input type="number" min="0" max="86400" value={cooldownSettings[key]} onChange={(event) => setCooldownSettings((current) => ({ ...current, [key]: Number(event.target.value) }))} className="w-28 rounded border border-gray-300 px-2 py-1.5 text-right" /></label>)}<button type="button" onClick={() => void saveSettings()} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">保存设置</button></section><section><div className="mb-3"><h3 className="font-semibold">全部配置项</h3><p className="mt-1 text-sm text-gray-500">“在线管理”可直接在本页修改；“环境变量”和“配置文件”需要修改部署环境后重新构建。密钥值不会显示。</p></div><div className="grid gap-4 xl:grid-cols-2">{configurationCatalog.map((category) => <section key={category.id} className="rounded-lg border border-gray-200 p-4"><h4 className="font-semibold text-gray-900">{category.title}</h4><p className="mt-1 text-xs leading-5 text-gray-500">{category.description}</p><div className="mt-3 space-y-3">{category.entries.map((entry) => <div key={entry.key} className="border-t border-gray-100 pt-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-gray-800">{entry.name}</span><span className={`rounded-full px-2 py-1 text-xs ${entry.management === 'admin' ? 'bg-green-50 text-green-700' : entry.management === 'env' ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>{entry.management === 'admin' ? '在线管理' : entry.management === 'env' ? '环境变量' : '配置文件'}</span></div><p className="mt-1 break-all font-mono text-xs text-gray-500">{entry.key}</p><p className="mt-1 text-xs leading-5 text-gray-600">默认：{entry.defaultValue} · {entry.effect}</p></div>)}</div></section>)}</div></section></div> : null}
        </section>
      </div>
    </main>
  );
}
