'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/useAuth';
import { authStorage } from '@/lib/auth';
import type { BattleMode } from '../types';

type Props = {
  generationId: string | null;
  mode: BattleMode;
  outputText?: string | null;
};

export function BattleReportPublicationControl({ generationId, mode, outputText }: Props) {
  const { isAuthenticated } = useAuth();
  const [isPublic, setIsPublic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsPublic(false);
    setMessage(null);
  }, [generationId]);

  if (!generationId) return null;

  const updatePublication = async (nextValue: boolean) => {
    if (!isAuthenticated) {
      setMessage('登录后才能公开战报。');
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await authStorage.fetch(`/api/me/battle-reports/${encodeURIComponent(generationId)}/publication`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublic: nextValue,
          mode,
          ...(nextValue && typeof outputText === 'string' && outputText.trim()
            ? { outputText: outputText.trim() }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; isPublic?: boolean };
      if (!response.ok) throw new Error(payload.error || '公开状态保存失败');
      setIsPublic(nextValue);
      setMessage(nextValue ? '战报已公开，可在公开战报页查看。' : '战报已撤回公开。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '公开状态保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 border border-blue-100 bg-blue-50/60">
      <div>
        <div className="font-semibold text-gray-800">战报公开展示</div>
        <p className="mt-1 text-xs text-gray-600">仅公开已完成且通过服务端内容检查的战报，不会公开角色原始设定或用户引导。</p>
        {message ? <p className="mt-1 text-xs text-blue-700">{message}</p> : null}
      </div>
      <button
        type="button"
        disabled={isSaving}
        onClick={() => void updatePublication(!isPublic)}
        className={`rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${isPublic ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {isSaving ? '保存中…' : isPublic ? '撤回公开' : '公开此战报'}
      </button>
    </div>
  );
}
