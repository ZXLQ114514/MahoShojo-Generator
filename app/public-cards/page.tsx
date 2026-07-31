import type { Metadata } from 'next';

import { PublicCardsPage } from '@/components/public-cards/PublicCardsPage';

export const metadata: Metadata = {
  title: '公开角色卡 - MahoShojo Generator',
  description: '浏览已公开且审核通过的角色卡。',
};

export default function PublicCardsRoute() {
  return <PublicCardsPage />;
}
