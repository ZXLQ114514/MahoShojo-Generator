import type { Metadata } from 'next';

import { ContinuousBattleReportUploadPage } from '@/components/arena/ContinuousBattleReportUploadPage';

export const metadata: Metadata = {
  title: '上传连续战报 - MahoShojo Generator',
  description: '将浏览器中的连续战报章节打包为一条竞技场战报。',
};

export default function ContinuousBattleReportUploadRoute() {
  return <ContinuousBattleReportUploadPage />;
}
