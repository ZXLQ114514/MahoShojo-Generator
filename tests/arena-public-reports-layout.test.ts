import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const readProjectFile = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('/arena-reports layout', () => {
  test('public report cards keep the dark panel styling', () => {
    const source = readProjectFile('components/arena/PublicBattleReportsPage.tsx');

    expect(source).toContain('bg-slate-900/90');
    expect(source).toContain('text-slate-200');
    expect(source).toContain('text-slate-300');
  });

  test('kd chart keeps the chart-only collapse structure', () => {
    const source = readProjectFile('components/arena/PublicBattleReportKDChart.tsx');

    expect(source).toContain('isCollapsed');
    expect(source).toContain('aria-controls="public-battle-kd-chart-details"');
    expect(source).toContain('hidden={isCollapsed}');
  });
});
