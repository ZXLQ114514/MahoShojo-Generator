import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/AdminPage';

export const metadata: Metadata = {
  title: '管理员工作台 - MahoShojo Generator',
  description: '管理公开角色卡和用户状态',
  robots: { index: false, follow: false },
};

export default function AdminRoute() {
  return <AdminPage />;
}
