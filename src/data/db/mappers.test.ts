import { describe, expect, it } from 'vitest';

import { normalizeContainerKind } from '@/data/db/mappers';
import { ContainerKind } from '@/domain/enums';

/**
 * 「文件夹」这个容器类型已经撤掉，但库里可能还躺着 `kind='folder'` 的老行。
 * 这里守的是：**存量数据一个都不丢** —— 它们照样读得出来，只是归到项目里。
 * （改库去迁移它们不划算：动整张表，收益只是让一列字符串好看一点。）
 */
describe('normalizeContainerKind', () => {
  it('目标还是目标', () => {
    expect(normalizeContainerKind('goal')).toBe(ContainerKind.Goal);
  });

  it('项目还是项目', () => {
    expect(normalizeContainerKind('project')).toBe(ContainerKind.Project);
  });

  it('⭐ 老数据里的 folder 当项目读出来（东西还在，只是那个类型没了）', () => {
    expect(normalizeContainerKind('folder')).toBe(ContainerKind.Project);
  });

  it('认不出的也归项目 —— 绝不让界面拿到一个开天窗的 undefined', () => {
    expect(normalizeContainerKind('文件夹')).toBe(ContainerKind.Project);
    expect(normalizeContainerKind('')).toBe(ContainerKind.Project);
  });
});
