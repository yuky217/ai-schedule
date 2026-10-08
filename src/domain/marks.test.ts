import { describe, expect, it } from 'vitest';

import { MarkKind } from './enums';
import { createMark } from './factory';
import { nextMarkDate } from './marks';

/** 2026-10-08 15:30 —— 特意挑下午，验证"几点钟"不影响"落在哪天" */
const NOW = new Date(2026, 9, 8, 15, 30);

const ymd = (d: Date | null): string | null =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

describe('nextMarkDate：纪念日在日历上的落点', () => {
  it('不重复的倒数日：落在它本身那天', () => {
    const mark = createMark({ title: '出发日', date: '2026-12-01' });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2026-12-01');
  });

  it('不重复、已过去的倒数日：仍落在它本身那天（翻回那个月可见）', () => {
    const mark = createMark({ title: '高考', date: '2026-06-07' });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2026-06-07');
  });

  it('年度重复、今年还没到：落在今年那一次', () => {
    const mark = createMark({ title: '她的生日', date: '2020-12-20', repeatYearly: true });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2026-12-20');
  });

  it('年度重复、今年已过：滚到明年那一次', () => {
    const mark = createMark({ title: '生日', date: '1998-03-05', repeatYearly: true });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2027-03-05');
  });

  it('年度重复、今天就是那天：落在今天', () => {
    const mark = createMark({ title: '在一起纪念', date: '2020-10-08', repeatYearly: true });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2026-10-08');
  });

  it('正数日不重复：落在起点那天（过去）', () => {
    const mark = createMark({ title: '在一起', kind: MarkKind.CountUp, date: '2025-02-14' });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2025-02-14');
  });

  it('正数日年度重复：落在下一次周年', () => {
    const mark = createMark({
      title: '入职',
      kind: MarkKind.CountUp,
      date: '2024-09-01',
      repeatYearly: true,
    });
    expect(ymd(nextMarkDate(mark, NOW))).toBe('2027-09-01');
  });

  it('日期不合法：没有落点', () => {
    const mark = createMark({ title: '坏日期', date: '不是一个日期' });
    expect(nextMarkDate(mark, NOW)).toBeNull();
  });
});
