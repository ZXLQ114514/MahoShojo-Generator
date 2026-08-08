import type { Metadata } from 'next';

import { CharacterReportAnalysisPage } from '@/components/character/CharacterReportAnalysisPage';

export const metadata: Metadata = {
  title: '角色战报分析 - MahoShojo Generator',
  description: '统计当前账号的角色卡关联战报，并按时间、上传人和样本数量生成分析结论。',
};

export default function CharacterReportAnalysisRoute() {
  return <CharacterReportAnalysisPage />;
}
