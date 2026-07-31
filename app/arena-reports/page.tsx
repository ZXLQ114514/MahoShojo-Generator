import type { Metadata } from 'next';

import { PublicBattleReportsPage } from '@/components/arena/PublicBattleReportsPage';

export const metadata: Metadata = {
  title: '公开战报展览 - MahoShojo Generator',
  description: '浏览公开且通过内容检查的竞技场战斗记录。',
};

export default function PublicArenaReportsRoute() {
  return <PublicBattleReportsPage />;
}
