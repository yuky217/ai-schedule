import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIODS,
  DEFAULT_PERIOD_PLAN,
  buildPeriods,
  describeClock,
  describePeriodSpan,
  parseClock,
  periodById,
  periodSpan,
  readPeriodPlan,
  resizePeriods,
  sanitizePeriods,
  type ClassPeriod,
} from './timetable';

describe('describeClock', () => {
  it('补零成 HH:mm', () => {
    expect(describeClock(480)).toBe('08:00');
    expect(describeClock(0)).toBe('00:00');
    expect(describeClock(1439)).toBe('23:59');
  });

  it('超过一天/负数回绕，不出现 24:xx', () => {
    expect(describeClock(1440)).toBe('00:00');
    expect(describeClock(-60)).toBe('23:00');
  });
});

describe('parseClock', () => {
  it.each([
    ['8:00', 480],
    ['08:00', 480],
    ['8：00', 480],
    ['8点30', 510],
    ['14:00-14:45', 840],
    [' 9 : 05 ', 545],
  ])('%s → %i', (input, expected) => {
    expect(parseClock(input)).toBe(expected);
  });

  it('认不出来返回 null（交给调用方决定提示还是回退）', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('8:70')).toBeNull();
  });
});

describe('periodSpan', () => {
  it('首节到末节合成一段（中间课间也算在内）', () => {
    expect(periodSpan(DEFAULT_PERIODS, 1, 2)).toEqual({ start: 480, end: 580 });
  });

  it('单节就是它自己', () => {
    expect(periodSpan(DEFAULT_PERIODS, 3, 3)).toEqual({ start: 600, end: 645 });
  });

  it('作息表里没有这一节就返回 null —— 宁可不出，也别画错位置', () => {
    expect(periodSpan(DEFAULT_PERIODS, 15, 16)).toBeNull();
    expect(periodById(DEFAULT_PERIODS, 99)).toBeNull();
  });

  it('describePeriodSpan 给出可读时段', () => {
    expect(describePeriodSpan(DEFAULT_PERIODS, 1, 2)).toBe('08:00–09:40');
    expect(describePeriodSpan(DEFAULT_PERIODS, 15, 16)).toBe('');
  });
});

describe('buildPeriods / readPeriodPlan（三个数 ↔ 整张表）', () => {
  it('从三个数推出整张表', () => {
    const periods = buildPeriods({ firstStart: 8 * 60, classMinutes: 45, breakMinutes: 10 }, 3);
    expect(periods).toEqual([
      { index: 1, start: 480, end: 525 },
      { index: 2, start: 535, end: 580 },
      { index: 3, start: 590, end: 635 },
    ]);
  });

  it('课间为 0 = 连着上，不报错也不吞节', () => {
    const periods = buildPeriods({ firstStart: 480, classMinutes: 45, breakMinutes: 0 }, 2);
    expect(periods).toEqual([
      { index: 1, start: 480, end: 525 },
      { index: 2, start: 525, end: 570 },
    ]);
  });

  it('离谱的输入被夹到合理范围，不产出"排到第二天"的表', () => {
    const tooLong = buildPeriods({ firstStart: 480, classMinutes: 5000, breakMinutes: 5000 }, 1);
    expect(tooLong[0]).toEqual({ index: 1, start: 480, end: 480 + 180 });
    // 节数也有上限：不许一次生成 999 节
    expect(buildPeriods({ firstStart: 480, classMinutes: 45, breakMinutes: 10 }, 999)).toHaveLength(20);
  });

  it('读回来：默认作息读出的正好是默认那三个数', () => {
    expect(readPeriodPlan(DEFAULT_PERIODS)).toEqual(DEFAULT_PERIOD_PLAN);
  });

  it('读回来取"最常见"的值，不被手调过的那一节带偏', () => {
    // 第 3 节被单独调过（10:05 而不是 10:00），45/10 仍是这张表的主流
    const tweaked: ClassPeriod[] = DEFAULT_PERIODS.map((p) =>
      p.index === 3 ? { ...p, start: p.start + 5, end: p.end + 5 } : p,
    );
    expect(readPeriodPlan(tweaked)).toEqual(DEFAULT_PERIOD_PLAN);
  });

  it('空表读不出东西 → null（调用方退回默认值）', () => {
    expect(readPeriodPlan([])).toBeNull();
  });
});

describe('resizePeriods（共几节）', () => {
  it('砍尾巴：只截掉末尾，前面每一节原样留着', () => {
    const ten = resizePeriods(DEFAULT_PERIODS, 10);
    expect(ten).toHaveLength(10);
    expect(ten[9]).toEqual(DEFAULT_PERIODS[9]);
  });

  it('加尾巴：按最后一节的节奏接着排（时长与课间照抄）', () => {
    const thirteen = resizePeriods(DEFAULT_PERIODS, 13);
    expect(thirteen).toHaveLength(13);
    // 第 12 节 21:45–22:30、课间 10 → 第 13 节 22:40–23:25
    expect(thirteen[12]).toEqual({ index: 13, start: 22 * 60 + 40, end: 23 * 60 + 25 });
  });

  it('加尾巴时**不动手调过的那几节**（学校下午晚上各从几点开始不一样）', () => {
    // 第 5 节被单独挪到 14:30 —— 加两节不该把这个改动抹掉
    const tweaked: ClassPeriod[] = DEFAULT_PERIODS.map((p) =>
      p.index === 5 ? { ...p, start: 14 * 60 + 30, end: 15 * 60 + 15 } : p,
    );
    const more = resizePeriods(tweaked, 14);
    expect(more).toHaveLength(14);
    expect(more[4]!.start).toBe(14 * 60 + 30);
  });

  it('课间为 0 的表往下延也不重叠', () => {
    const tight = buildPeriods({ firstStart: 480, classMinutes: 45, breakMinutes: 0 }, 2);
    const three = resizePeriods(tight, 3);
    expect(three[2]).toEqual({ index: 3, start: 570, end: 615 });
  });

  it('夹在 1~20 之间；空表退回默认作息', () => {
    expect(resizePeriods(DEFAULT_PERIODS, 0)).toHaveLength(1);
    expect(resizePeriods(DEFAULT_PERIODS, 999)).toHaveLength(20);
    expect(resizePeriods([], 3)).toEqual(buildPeriods(DEFAULT_PERIOD_PLAN, 3));
  });

  it('节数不变时原样返回（不会顺手重排）', () => {
    expect(resizePeriods(DEFAULT_PERIODS, DEFAULT_PERIODS.length)).toEqual([...DEFAULT_PERIODS]);
  });
});

describe('sanitizePeriods', () => {
  it('排序 + 同节号去重（留第一条）+ 丢掉起止不合理的行', () => {
    const input: ClassPeriod[] = [
      { index: 3, start: 600, end: 645 },
      { index: 1, start: 480, end: 525 },
      { index: 1, start: 500, end: 545 },
      { index: 2, start: 600, end: 500 },
    ];
    expect(sanitizePeriods(input)).toEqual([
      { index: 1, start: 480, end: 525 },
      { index: 3, start: 600, end: 645 },
    ]);
  });

  it('允许"第 5 节早于第 4 节"（有学校把晚上排在前面），只按节号排序', () => {
    const input: ClassPeriod[] = [
      { index: 5, start: 300, end: 345 },
      { index: 4, start: 600, end: 645 },
    ];
    expect(sanitizePeriods(input).map((p) => p.index)).toEqual([4, 5]);
  });
});

/**
 * 晚课是常态，不是例外 —— 用户 2026-10-08 的原话："课表结束时间要考虑有晚课啊"。
 *
 * 他学校的作息是 上午 1-4 节 / 下午 5-8 节 / 晚上 9-11 节。默认作息要是只排到
 * 下午，第 9 节以后的课**算不出时刻**（`periodSpan` 返回 null），
 * 那门课就会从网格和日历里直接消失 —— 比"没时间"更糟：数据在、画不出来。
 */
describe('默认作息表：排到晚上，第 9 节起是晚课', () => {
  it('至少排到第 11 节，末节在 21:00 之后结束', () => {
    expect(DEFAULT_PERIODS.length).toBeGreaterThanOrEqual(11);
    expect(DEFAULT_PERIODS[DEFAULT_PERIODS.length - 1]!.end).toBeGreaterThan(21 * 60);
  });

  it('第 9 节从 18:00 以后开始（不能是下午课的延续）', () => {
    expect(periodById(DEFAULT_PERIODS, 9)!.start).toBeGreaterThanOrEqual(18 * 60);
  });

  it('晚上第 9-10 节算得出时刻：19:00–20:40', () => {
    expect(describePeriodSpan(DEFAULT_PERIODS, 9, 10)).toBe('19:00–20:40');
  });

  it('第 11 节也画得出来（有的学校晚课有三节）', () => {
    expect(describePeriodSpan(DEFAULT_PERIODS, 11, 11)).toBe('20:50–21:35');
  });
});
