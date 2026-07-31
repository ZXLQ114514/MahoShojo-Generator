'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type CardType = 'character' | 'scenario' | 'history' | 'questionnaire';
type SortBy = 'created_at' | 'likes' | 'favorites' | 'usage';

type PublicCard = {
  id: string;
  type: CardType;
  name: string;
  description: string | null;
  data: string;
  username: string;
  is_public?: number | boolean;
  review_status?: string | null;
  like_count?: number | null;
  favorite_count?: number | null;
  usage_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  tagIds?: string[];
};

const typeLabels: Record<CardType, string> = {
  character: '角色',
  scenario: '情景',
  history: '历史',
  questionnaire: '问卷',
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '暂无时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无时间' : date.toLocaleString();
};

const parseData = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const readPreview = (card: PublicCard): string => {
  const data = parseData(card.data);
  if (!data) return card.description || '暂无简介';
  const candidates = ['summary', '简介', 'description', 'persona', '角色简介', '设定'];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 180);
  }
  return card.description || '暂无简介';
};

export function PublicCardsPage() {
  const [cards, setCards] = useState<PublicCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<PublicCard | null>(null);
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [type, setType] = useState<CardType | ''>('character');
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 18;

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), sortBy });
      if (type) params.set('type', type);
      if (search.trim()) params.set('search', search.trim());
      if (author.trim()) params.set('author', author.trim());
      const response = await fetch(`/api/public-data-cards?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { cards?: PublicCard[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `加载失败（${response.status}）`);
      setCards(Array.isArray(payload.cards) ? payload.cards : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '公开角色卡加载失败');
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [author, offset, search, sortBy, type]);

  useEffect(() => { void loadCards(); }, [loadCards]);

  const pageLabel = useMemo(() => `${offset + 1}-${offset + cards.length}`, [cards.length, offset]);

  return (
    <main className="magic-background-white min-h-screen py-8">
      <div className="container">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Public Character Cards</p>
            <h1 className="text-3xl font-bold text-gray-900">公开角色卡</h1>
            <p className="mt-2 text-sm text-gray-600">浏览已公开且审核通过的角色卡，点击卡片可以查看完整内容。</p>
          </div>
          <Link href="/" className="text-sm text-blue-600 hover:underline">返回首页</Link>
        </div>

        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_160px_auto]">
            <input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} onKeyDown={(event) => { if (event.key === 'Enter') void loadCards(); }} placeholder="搜索名称或简介" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={author} onChange={(event) => { setAuthor(event.target.value); setOffset(0); }} onKeyDown={(event) => { if (event.key === 'Enter') void loadCards(); }} placeholder="作者用户名" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <select value={type} onChange={(event) => { setType(event.target.value as CardType | ''); setOffset(0); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">全部类型</option>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as SortBy); setOffset(0); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="created_at">最新发布</option><option value="likes">最多点赞</option><option value="favorites">最多收藏</option><option value="usage">最多使用</option>
            </select>
            <button type="button" onClick={() => void loadCards()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">刷新</button>
          </div>
        </section>

        {error ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {loading ? <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">加载中…</div> : null}
        {!loading && !cards.length ? <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">暂时没有符合条件的公开角色卡。</div> : null}

        {!loading && cards.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => <button key={card.id} type="button" onClick={() => setSelectedCard(card)} className="text-left rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
            <div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{typeLabels[card.type] || card.type}</span><h2 className="mt-3 line-clamp-2 text-lg font-semibold text-gray-900">{card.name || '未命名角色卡'}</h2></div><span className="text-xs text-gray-500">查看详情</span></div>
            <p className="mt-3 min-h-12 line-clamp-3 text-sm leading-6 text-gray-600">{readPreview(card)}</p>
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500"><span>作者：{card.username || '未知'}</span><span>赞 {card.like_count ?? 0}</span><span>藏 {card.favorite_count ?? 0}</span><span>用 {card.usage_count ?? 0}</span></div>
          </button>)}
        </div> : null}

        <div className="mt-6 flex items-center justify-between text-sm text-gray-500"><span>{cards.length ? `显示 ${pageLabel}` : ''}</span><div className="flex gap-2"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={cards.length < pageSize || loading} onClick={() => setOffset((value) => value + pageSize)} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
      </div>

      {selectedCard ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedCard(null)}><div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5"><div><span className="text-xs text-blue-700">{typeLabels[selectedCard.type] || selectedCard.type}</span><h2 className="mt-1 text-2xl font-bold text-gray-900">{selectedCard.name || '未命名角色卡'}</h2><p className="mt-1 text-sm text-gray-500">作者：{selectedCard.username || '未知'} · 发布于 {formatDate(selectedCard.created_at)}</p></div><button type="button" onClick={() => setSelectedCard(null)} className="rounded border border-gray-300 px-3 py-1 text-sm">关闭</button></div><div className="max-h-[calc(90vh-130px)] overflow-auto p-5"><p className="mb-4 whitespace-pre-wrap text-sm leading-6 text-gray-700">{selectedCard.description || '暂无简介'}</p><pre className="overflow-auto rounded-lg bg-gray-950 p-4 text-xs leading-5 text-gray-100">{(() => { const parsed = parseData(selectedCard.data); return parsed ? JSON.stringify(parsed, null, 2) : selectedCard.data; })()}</pre></div></div></div> : null}
    </main>
  );
}
