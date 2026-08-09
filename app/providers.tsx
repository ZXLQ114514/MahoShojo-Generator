'use client';

import { GoogleAnalytics } from '@next/third-parties/google';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import AnnouncementTicker from '@/components/Announcement/AnnouncementTicker';
import { GlobalTopBar } from '@/components/navigation/GlobalTopBar';
import { getTopbarCanonicalPathname, isTopbarCoveredPath } from '@/lib/navigation';

interface AppProvidersProps {
  children: ReactNode;
}

function ShieldWordRulesLoader() {
  const loadedRevision = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    const loadRules = async () => {
      try {
        const response = await fetch('/api/shield-word-rules', {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const payload = await response.json() as { rules?: unknown; revision?: unknown };
        if (!Array.isArray(payload.rules)) return;
        const revision = typeof payload.revision === 'string' ? payload.revision : null;
        // D1 瞬时故障时保留已加载的有效规则，不用空回退覆盖。
        if (revision === null && loadedRevision.current !== undefined) return;
        if (revision === loadedRevision.current) return;
        const rules = payload.rules.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const candidate = item as { word?: unknown; replacement?: unknown };
          if (typeof candidate.word !== 'string') return [];
          if (candidate.replacement !== null && typeof candidate.replacement !== 'string') return [];
          return [{ word: candidate.word, replacement: candidate.replacement }];
        });
        const { setRuntimeShieldWordRules } = await import('@/lib/shield-word-filter');
        if (disposed) return;
        setRuntimeShieldWordRules(rules);
        loadedRevision.current = revision;
      } catch {
        // 前端同步失败时保留当前快照，服务端内容安全检查仍是权威边界。
      }
    };

    void loadRules();
    const interval = window.setInterval(() => void loadRules(), 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadRules();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return null;
}

export function AppProviders({ children }: AppProvidersProps) {
  const pathname = usePathname() || '/';
  const topbarPathname = getTopbarCanonicalPathname(pathname);
  const isBlueThemePage = topbarPathname === '/details' || topbarPathname === '/canshou';
  const isArrestedPage = topbarPathname === '/arrested';
  const shouldShowTopbar = isTopbarCoveredPath(topbarPathname);
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim();

  return (
    <div className={isBlueThemePage ? 'blue-theme' : ''}>
      <ShieldWordRulesLoader />
      {shouldShowTopbar ? <GlobalTopBar pathname={topbarPathname} /> : null}
      {children}
      {!isArrestedPage && <AnnouncementTicker />}
      {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
    </div>
  );
}
