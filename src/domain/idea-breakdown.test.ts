import { describe, expect, it } from 'vitest';

import {
  BREAKDOWN_STEP_MAX,
  BREAKDOWN_TITLE_MAX,
  planBreakdown,
} from './idea-breakdown';

/**
 * 想法拆解的口径测试。
 *
 * 这一层的规则**肉眼看不出来**：标题该取第一行还是整段、截断之后原文还在不在、
 * 空步骤要不要剔掉 —— 改错了页面照样能跑，只是收集箱里悄悄多出一条巨长任务、
 * 或者用户写的第二条被当成重复吞掉。
 */

describe('planBreakdown', () => {
  it('单行想法：标题就是那一行，note 空着（写两遍是噪音）', () => {
    const plan = planBreakdown('做校园二手书平台', ['看看别人怎么做的', '写一版需求']);
    expect(plan).toEqual({
      title: '做校园二手书平台',
      note: null,
      steps: ['看看别人怎么做的', '写一版需求'],
    });
  });

  it('多行想法：标题取第一行，整段原文留在 note 里', () => {
    const content = '做校园二手书平台\n先从同宿舍楼试起来，别一上来就全校';
    const plan = planBreakdown(content, ['找三个同学聊聊']);
    expect(plan?.title).toBe('做校园二手书平台');
    expect(plan?.note).toBe(content);
  });

  it('前面拖了空行也不影响：取第一个非空行当标题', () => {
    const plan = planBreakdown('\n\n  做校园二手书平台  \n展开一句', ['第一步']);
    expect(plan?.title).toBe('做校园二手书平台');
  });

  it('第一行过长：截断标题，但整段原文一个字都不丢', () => {
    const long = '这是一条特别长的想法'.repeat(6);
    const plan = planBreakdown(long, ['第一步']);
    expect(plan?.title).toHaveLength(BREAKDOWN_TITLE_MAX);
    expect(plan?.note).toBe(long);
    // 截断不等于丢弃：原文必须以某个形式完整留着
    expect(plan?.note).toContain(long.slice(BREAKDOWN_TITLE_MAX));
  });

  it('步骤洗一遍：去空、按原顺序合并重复', () => {
    const plan = planBreakdown('写毕业论文', ['查文献', '  ', '查文献', '定题目', '  查文献  ']);
    expect(plan?.steps).toEqual(['查文献', '定题目']);
  });

  it('步骤超过上限时截到上限，不是无限装', () => {
    const many = Array.from({ length: BREAKDOWN_STEP_MAX + 5 }, (_, i) => `第 ${i + 1} 步`);
    expect(planBreakdown('大工程', many)?.steps).toHaveLength(BREAKDOWN_STEP_MAX);
  });

  it('一个步骤都没写：返回 null，什么都不该落库', () => {
    expect(planBreakdown('写毕业论文', [])).toBeNull();
    expect(planBreakdown('写毕业论文', ['   ', '\n'])).toBeNull();
  });

  it('想法是空的：同样返回 null（空标题的任务没有存在的意义）', () => {
    expect(planBreakdown('   ', ['第一步'])).toBeNull();
  });
});
