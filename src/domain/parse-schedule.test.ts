import { describe, expect, it } from 'vitest';

import { parseSchedule } from './parse-schedule';

/**
 * 固定"现在" = 2026-10-07（周三）10:00。
 * 时间相关的断言都用本地时间构造再转 ISO，避免跟着机器时区漂。
 * 本周：周一 10/5、周三 10/7（今天）、周五 10/9、周六 10/10、周日 10/11。
 */
const NOW = new Date(2026, 9, 7, 10, 0, 0);
const at = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();

describe('日期 + 时刻', () => {
  it('明天下午3点开会', () => {
    const r = parseSchedule('明天下午3点开会', NOW);
    expect(r.title).toBe('开会');
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 15, 0));
    expect(r.label).toBe('明天 15:00');
    expect(r.repeat).toBeNull();
  });

  it('今晚8点提醒吃药', () => {
    const r = parseSchedule('今晚8点提醒吃药', NOW);
    expect(r.title).toBe('提醒吃药');
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 20, 0));
  });

  it('周五下午3点开会 → 本周五（还没到）', () => {
    const r = parseSchedule('周五下午3点开会', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 9, 15, 0));
  });

  it('只有日期 → 落到当天结束，不是开始时间', () => {
    const r = parseSchedule('10月8日交表', NOW);
    expect(r.time?.dueAt).toBe(at(2026, 10, 8, 23, 59));
    expect(r.time?.startAt).toBeNull();
  });

  it('只有时刻 → 今天，已经过了就顺延到明天', () => {
    const r = parseSchedule('早上 7 点跑步', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 7, 0));
    expect(r.title).toBe('跑步');
    expect(r.repeat).toBeNull();
  });

  it('24 小时写法 14:30 也得认（这是个存在很久的旧 bug）', () => {
    const r = parseSchedule('明天 14:30 复盘', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 14, 30));
    expect(r.title).toBe('复盘');
  });

  it('带冒点的时段也要认（14:00 到 15:30）', () => {
    const r = parseSchedule('明天 14:00 到 15:30 评审', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 14, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 8, 15, 30));
    expect(r.title).toBe('评审');
  });
});

describe('重复', () => {
  it('每周五晚上7点健身 —— 不能读成"这周五"，那是一次性的', () => {
    const r = parseSchedule('每周五晚上7点健身', NOW);
    expect(r.repeat).toEqual({ freq: 'weekly', interval: 1, byWeekday: [5] });
    expect(r.repeatLabel).toBe('每周五');
    expect(r.title).toBe('健身');
    expect(r.time?.startAt).toBe(at(2026, 10, 9, 19, 0));
  });

  it('每天8点吃药 —— 今天的已经过了，第一期落明天', () => {
    const r = parseSchedule('每天8点吃药', NOW);
    expect(r.repeat).toEqual({ freq: 'daily', interval: 1 });
    expect(r.repeatLabel).toBe('每天');
    expect(r.title).toBe('吃药');
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 8, 0));
  });

  it('工作日早上9点打卡', () => {
    const r = parseSchedule('工作日早上9点打卡', NOW);
    expect(r.repeat).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] });
    expect(r.repeatLabel).toBe('工作日');
    expect(r.title).toBe('打卡');
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 9, 0));
  });

  it('每周一三五跑步 —— 第一期是眼下最近的那次，不是列表首项', () => {
    const r = parseSchedule('每周一三五跑步', NOW);
    expect(r.repeat?.byWeekday).toEqual([1, 3, 5]);
    expect(r.title).toBe('跑步');
    // 今天就是周三（在列表里）⇒ 第一期就是今天，而**不是**日期规则匹配到的"下周一"
    const day = new Date(r.time!.dueAt!);
    expect([1, 3, 5]).toContain(day.getDay());
    expect(day.getTime()).toBeGreaterThan(NOW.getTime());
    expect(day.getTime()).toBeLessThan(new Date(2026, 9, 12, 0, 0).getTime());
  });

  it('每周末打扫 —— 是周六周日两天，不是"每周"', () => {
    const r = parseSchedule('每周末打扫', NOW);
    expect(r.repeat).toEqual({ freq: 'weekly', interval: 1, byWeekday: [0, 6] });
    expect(r.repeatLabel).toContain('周六');
    expect(r.repeatLabel).toContain('周日');
    expect(r.title).toBe('打扫');
  });

  it('每月25号还信用卡 → 本月25号（还没到）', () => {
    const r = parseSchedule('每月25号还信用卡', NOW);
    expect(r.repeat).toEqual({ freq: 'monthly', interval: 1 });
    expect(r.repeatLabel).toBe('每月');
    expect(r.title).toBe('还信用卡');
    expect(r.time?.dueAt).toBe(at(2026, 10, 25, 23, 59));
  });

  it('每2天浇花 → 间隔型', () => {
    const r = parseSchedule('每2天浇花', NOW);
    expect(r.repeat).toEqual({ freq: 'daily', interval: 2 });
    expect(r.title).toBe('浇花');
  });
});

describe('截止式', () => {
  it('下个月10号前完成合同', () => {
    const r = parseSchedule('下个月10号前完成合同', NOW);
    expect(r.time?.dueAt).toBe(at(2026, 11, 10, 23, 59));
    expect(r.title).toBe('完成合同');
    expect(r.repeat).toBeNull();
  });

  it('每周五前交报告 —— 重复片段与截止锚点在原文里重叠，两个都得留下', () => {
    const r = parseSchedule('每周五前交报告', NOW);
    expect(r.repeat).toEqual({ freq: 'weekly', interval: 1, byWeekday: [5] });
    expect(r.title).toBe('交报告');
    expect(r.time?.dueAt).not.toBeNull();
    expect(new Date(r.time!.dueAt!).getDay()).toBe(5);
  });

  it('明天下午3点前交材料', () => {
    const r = parseSchedule('明天下午3点前交材料', NOW);
    expect(r.time?.dueAt).toBe(at(2026, 10, 8, 15, 0));
    expect(r.title).toBe('交材料');
  });
});

describe('时间段', () => {
  it('明天下午2点到4点开会 —— 第二段没写时段词，也得算下午', () => {
    const r = parseSchedule('明天下午2点到4点开会', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 14, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 8, 16, 0));
    expect(r.title).toBe('开会');
  });

  it('下午2点到4点开会 → 今天（已过则明天）', () => {
    const r = parseSchedule('下午2点到4点开会', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 14, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 7, 16, 0));
  });

  it('今晚7点到9点看书 —— "晚上"这层意思来自日期词，整段都要往后挪半天', () => {
    const r = parseSchedule('今晚7点到9点看书', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 19, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 7, 21, 0));
  });

  it('跨天的时段不硬补 12 小时（晚上10点到凌晨2点）', () => {
    const r = parseSchedule('晚上10点到凌晨2点值班', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 22, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 8, 2, 0));
  });
});

describe('相对时间', () => {
  it('3天后交作业', () => {
    const r = parseSchedule('3天后交作业', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 10, 10, 0));
    expect(r.title).toBe('交作业');
  });

  it('半小时后开会', () => {
    const r = parseSchedule('半小时后开会', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 10, 30));
  });

  it('20分钟后关火', () => {
    const r = parseSchedule('20分钟后关火', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 10, 20));
  });
});

describe('周末只出现一次时是"这周六"，不是重复', () => {
  it('周末去爬山', () => {
    const r = parseSchedule('周末去爬山', NOW);
    expect(r.repeat).toBeNull();
    expect(new Date(r.time!.dueAt!).getDay()).toBe(6);
  });
});

describe('中文数字时刻', () => {
  it('明天下午五点理线 —— 小时位认中文数字（此前落成 23:59 截止）', () => {
    const r = parseSchedule('明天下午五点理线', NOW);
    expect(r.title).toBe('理线');
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 17, 0));
    expect(r.label).toBe('明天 17:00');
  });

  it('早上七点半跑步 —— 「半」照旧可用', () => {
    const r = parseSchedule('早上七点半跑步', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 7, 30));
    expect(r.title).toBe('跑步');
  });

  it('今晚十一点吃药 —— 两位数「十一」', () => {
    const r = parseSchedule('今晚十一点吃药', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 23, 0));
  });

  it('十点半看电影 —— 没带时段词、不带日期也照认', () => {
    const r = parseSchedule('十点半看电影', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 10, 30));
  });

  it('两个小时后 —— 相对时间里的「两」', () => {
    const r = parseSchedule('两个小时后开会', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 12, 0));
  });

  it('周五点外卖 —— 不是下午五点，是「周五截止当天」（同「周末去爬山」的口径）', () => {
    const r = parseSchedule('周五点外卖', NOW);
    expect(r.repeat).toBeNull();
    expect(r.title).toBe('点外卖');
    expect(r.time?.startAt).toBeNull();
    expect(new Date(r.time!.dueAt!).getDay()).toBe(5);
    expect(new Date(r.time!.dueAt!).getHours()).toBe(23);
  });
});

describe('不猜：认不出来就一个字都不认', () => {
  it('纯粹的待办不带上任何时间', () => {
    const r = parseSchedule('买菜', NOW);
    expect(r.time).toBeNull();
    expect(r.repeat).toBeNull();
    expect(r.title).toBe('买菜');
  });

  it('含糊的时间词一概不认 —— 落进收集箱，好过排到错的日子', () => {
    for (const text of ['过几天再说', '改天聊', '有空的时候整理房间', '月底前搞定']) {
      const r = parseSchedule(text, NOW);
      expect(r.time, text).toBeNull();
      expect(r.repeat, text).toBeNull();
      expect(r.title, text).toBe(text);
    }
  });

  it('空文本不炸', () => {
    const r = parseSchedule('   ', NOW);
    expect(r.time).toBeNull();
    expect(r.repeat).toBeNull();
    expect(r.title).toBe('');
  });
});
