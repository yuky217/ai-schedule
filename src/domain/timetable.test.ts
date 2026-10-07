import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIODS,
  describeClock,
  describePeriodSpan,
  parseClock,
  periodById,
  periodSpan,
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
