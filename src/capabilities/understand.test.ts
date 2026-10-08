import { describe, expect, it } from 'vitest';

import { RepeatFreq, TimeAttribute } from '@/domain/enums';

import { parseUnderstood } from './understand';

/**
 * 「模型给的东西能不能信」—— 这道校验是整条 AI 链路的闸门。
 *
 * 它守的不是"模型会不会答错"（那没法保证），而是**答错之后会不会被写进库**：
 * 名字空、时间不成形、日期不存在，一律 `null` → 调用方退回本地识别。
 * 一条被理解错的日程，用户是看不出来错的 —— 所以这里的每一条都得钉死。
 */

const NOW = new Date(2026, 9, 7, 12, 0); // 周三中午

/** 模型"标准回答"的样子，各用例只改自己关心的字段 */
const base = {
  title: '开会',
  timeKind: 'fixed',
  startAt: '2026-10-08T15:00',
  endAt: null,
  dueAt: null,
  timeLabel: null,
  location: null,
  repeat: null,
  reminderSpecified: false,
  reminderMinutes: null,
  note: null,
};

const parse = (overrides: Record<string, unknown>) => parseUnderstood({ ...base, ...overrides }, NOW);

describe('parseUnderstood：名字', () => {
  it('正常读出标题与时间', () => {
    const r = parse({});
    expect(r!.title).toBe('开会');
    expect(r!.time!.attribute).toBe(TimeAttribute.Fixed);
    expect(new Date(r!.time!.startAt!).getHours()).toBe(15);
  });

  it('没有名字 → 整份作废（空标题的任务比不识别更糟）', () => {
    expect(parse({ title: '   ' })).toBeNull();
    expect(parse({ title: null })).toBeNull();
  });

  it('粘一整段通知：标题过长就截断，**截掉的部分进备注，一个字不丢**', () => {
    const long = '关于组织全校学生参加本年度秋季运动会开幕式彩排工作的通知，请全体同学按时到场并穿着统一服装';
    const r = parse({ title: long, note: '服装要求：白上衣' });
    expect(r!.title.length).toBe(40);
    expect(r!.note).toContain(long);
    expect(r!.note).toContain('服装要求');
  });

  it('模型把 null 写成字符串"null"也要当没写', () => {
    expect(parse({ location: 'null', note: 'null' })!.location).toBeNull();
    expect(parse({ location: 'null' })!.note).toBeNull();
  });
});

describe('parseUnderstood：时间', () => {
  it('timeKind=none → 没有时间，但结果**有效**（记一件待办不该被退回本地）', () => {
    const r = parse({ timeKind: 'none', startAt: null, dueAt: null });
    expect(r!.time).toBeNull();
    expect(r!.title).toBe('开会');
  });

  it('截止型落在 dueAt 上', () => {
    const r = parse({ timeKind: 'deadline', startAt: null, dueAt: '2026-10-14T12:00' });
    expect(r!.time!.attribute).toBe(TimeAttribute.Deadline);
    expect(new Date(r!.time!.dueAt!).getHours()).toBe(12);
    expect(r!.time!.startAt).toBeNull();
  });

  it('说了 fixed 却没给时间 → 作废（这不是"没时间"，是没理解对）', () => {
    expect(parse({ timeKind: 'fixed', startAt: null })).toBeNull();
    expect(parse({ timeKind: 'fixed', startAt: '下周随便吧' })).toBeNull();
  });

  it('不存在的日期（2 月 30 日）不能被 Date 悄悄顺延成 3 月 2 日', () => {
    expect(parse({ timeKind: 'fixed', startAt: '2026-02-30T09:00' })).toBeNull();
  });

  it('模型硬塞了时区标记 → 按它写的字面时间读（那才是它想表达的当地时间）', () => {
    const r = parse({ startAt: '2026-10-08T15:00:00Z' });
    expect(new Date(r!.time!.startAt!).getHours()).toBe(15);
  });

  it('模型漏了 timeKind，但有 startAt → 按发生时间处理（不白丢）', () => {
    const r = parse({ timeKind: undefined });
    expect(r!.time!.attribute).toBe(TimeAttribute.Fixed);
  });

  it('标签：模型没给 timeLabel 时自己算，今天/明天/后天说得清', () => {
    expect(parse({ timeLabel: null, startAt: '2026-10-07T20:00' })!.label).toBe('今天 20:00');
    expect(parse({ timeLabel: null, startAt: '2026-10-08T09:00' })!.label).toBe('明天 09:00');
    expect(parse({ timeLabel: null, startAt: '2026-10-20T09:00' })!.label).toBe('10月20日 09:00');
    // 模型自己给的标签优先（它说的更自然）
    expect(parse({ timeLabel: '下周三下午三点' })!.label).toBe('下周三下午三点');
  });
});

describe('parseUnderstood：重复与提醒', () => {
  it('每周一三五：去重、按周一到周日排、interval 缺省为 1', () => {
    const r = parse({
      repeat: { freq: 'weekly', interval: undefined, byWeekday: [5, 1, 1, 3] },
    });
    expect(r!.repeat).toEqual({ freq: RepeatFreq.Weekly, interval: 1, byWeekday: [1, 3, 5] });
  });

  it('每天 / 每月：不看 byWeekday（那是周的字段）', () => {
    expect(parse({ repeat: { freq: 'daily', interval: 1, byWeekday: [1] } })!.repeat).toEqual({
      freq: RepeatFreq.Daily,
      interval: 1,
    });
  });

  it('非法重复（freq 不认识 / interval 是 0）→ 当作不重复，不硬凑', () => {
    expect(parse({ repeat: { freq: 'yearly', interval: 1 } })!.repeat).toBeNull();
    expect(parse({ repeat: { freq: 'daily', interval: 0 } })!.repeat).toEqual({
      freq: RepeatFreq.Daily,
      interval: 1,
    });
  });

  it('提了提醒但没说多久 → 交给类型默认值（不是"不提醒"，也不是擅自定一个数）', () => {
    const r = parse({ reminderSpecified: true, reminderMinutes: null });
    expect(r!.reminder).toBeNull();
    expect(r!.reminderUnspecified).toBe(true);
  });

  it('写明了提前量 → 用它', () => {
    const r = parse({ reminderSpecified: true, reminderMinutes: 30 });
    expect(r!.reminder).toBe(30);
    expect(r!.reminderUnspecified).toBe(false);
  });

  it('**没要求提醒 → 一个字都不许自作主张**（默认安静比默认打扰安全）', () => {
    const r = parse({ reminderSpecified: false, reminderMinutes: 30 });
    expect(r!.reminder).toBeNull();
    expect(r!.reminderUnspecified).toBe(false);
  });

  it('离谱的提前量（超过一周）当作没说量', () => {
    const r = parse({ reminderSpecified: true, reminderMinutes: 999999 });
    expect(r!.reminder).toBeNull();
    expect(r!.reminderUnspecified).toBe(true);
  });
});
