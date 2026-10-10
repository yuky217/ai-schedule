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

  it('今晚8点提醒吃药 —— 「提醒」是指令，标题只剩「吃药」', () => {
    const r = parseSchedule('今晚8点提醒吃药', NOW);
    expect(r.title).toBe('吃药');
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 20, 0));
    // 提了提醒但没写提前多久 → 交给上层按类型定（这里不猜）
    expect(r.reminder).toBeNull();
    expect(r.reminderUnspecified).toBe(true);
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

  /*
   * 光一个时刻 + 前 —— 最常见的写法，此前**整条漏掉**：
   * 带日期的截止式要求必须有日期词，于是「12点前交」被 ③ 的"只有时刻"接走，
   * 落成"固定时间 12:00"，在日历上变成一个**要出席的事件**。
   * 它其实是个截止：提醒该提前 1 小时、过了该进"已过期"。
   */
  it('12点前交 —— 不带日期也是截止，不是"12:00 有个会"', () => {
    const r = parseSchedule('12点前交', NOW);
    expect(r.time?.attribute).toBe('deadline');
    expect(r.time?.dueAt).toBe(at(2026, 10, 7, 12, 0));
    expect(r.time?.startAt).toBeNull();
    expect(r.title).toBe('交');
    expect(r.label).toBe('12:00 前');
  });

  it('三点半前给我 / 18:00前提交 —— 中文数字与冒点写法都算', () => {
    expect(parseSchedule('三点半前给我', NOW).time?.dueAt).toBe(at(2026, 10, 7, 3, 30));
    expect(parseSchedule('18:00前提交', NOW).time?.dueAt).toBe(at(2026, 10, 7, 18, 0));
  });

  it('带日期的写法仍走原来那条（label 说"明天"，比"今天"精确）', () => {
    const r = parseSchedule('明天下午3点前交材料', NOW);
    expect(r.label).not.toBe('15:00 前');
    expect(r.time?.dueAt).toBe(at(2026, 10, 8, 15, 0));
  });

  it('不是截止的写法不受影响 —— "3点后再说"、"提前半小时出发"', () => {
    expect(parseSchedule('3点后再说', NOW).time?.attribute).not.toBe('deadline');
    expect(parseSchedule('提前半小时出发', NOW).time?.attribute).not.toBe('deadline');
  });
});

/**
 * 「明显的准备动作」——只服务于提醒默认值，所以判据必须**窄**：
 * 只认"要不要提前收拾"，不认"这件事是什么"。
 */
describe('prepAction', () => {
  it('出发 / 赶交通工具 / 收拾行李 / 接人 → true', () => {
    for (const text of [
      '19:00 出发去机场',
      '明天赶高铁回家',
      '收拾行李',
      '晚上 8 点接人',
      '出门买药',
    ]) {
      expect(parseSchedule(text, NOW).prepAction, text).toBe(true);
    }
  });

  it('「开会 / 上课 / 交材料」→ false（那是性质，不是行为）', () => {
    for (const text of ['下午 3 点开会', '课程设计答辩', '12点前交材料', '晚上七点背单词']) {
      expect(parseSchedule(text, NOW).prepAction, text).toBe(false);
    }
  });

  it('「赶」必须带交通工具、「接」必须带人（赶紧 / 接电话不算）', () => {
    expect(parseSchedule('赶紧处理一下', NOW).prepAction).toBe(false);
    expect(parseSchedule('接个电话', NOW).prepAction).toBe(false);
    expect(parseSchedule('赶飞机', NOW).prepAction).toBe(true);
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

/**
 * 提醒识别（2026-10-08）。
 *
 * 规则是"**没提就不提醒**"，所以这一层的每一句话都在决定"要不要发通知" ——
 * 动词是入场券（光有"提前半小时"可能是行程），写明的量优先于类型默认值。
 */
describe('提醒', () => {
  it('提前半小时提醒我 → 30 分钟，并把它从标题里切掉', () => {
    const r = parseSchedule('明天下午3点开会，提前半小时提醒我', NOW);
    expect(r.reminder).toBe(30);
    expect(r.reminderUnspecified).toBe(false);
    expect(r.reminderLabel).toBe('提前 30 分钟');
    expect(r.reminderMatched).toContain('提前半小时');
    expect(r.title).toBe('开会');
  });

  it('阿拉伯数字与小时都认', () => {
    expect(parseSchedule('10月8日 12:00 前交表，提前30分钟提醒', NOW).reminder).toBe(30);
    expect(parseSchedule('10月8日 12:00 前交表，提前1小时提醒我', NOW).reminder).toBe(60);
    expect(parseSchedule('10月8日 12:00 前交表，提前两小时叫我', NOW).reminder).toBe(120);
  });

  it('准点提醒 → 0（不是"没写"）', () => {
    const r = parseSchedule('明天9点开会，准点提醒我', NOW);
    expect(r.reminder).toBe(0);
    expect(r.reminderUnspecified).toBe(false);
    expect(r.title).toBe('开会');
  });

  it('只提了提醒没给量 → 交给类型默认值，这里不猜', () => {
    const r = parseSchedule('明天9点开会，记得提醒我', NOW);
    expect(r.reminder).toBeNull();
    expect(r.reminderUnspecified).toBe(true);
    expect(r.title).toBe('开会');
  });

  it('没有提醒动词 → 一个字都不认（"提前半小时出发"不是提醒）', () => {
    const r = parseSchedule('明天9点出发，提前半小时出门', NOW);
    expect(r.reminder).toBeNull();
    expect(r.reminderUnspecified).toBe(false);
    expect(r.reminderMatched).toBeNull();
  });

  it('切到什么都不剩时退一步：留着「提醒我」当标题，也不给空标题', () => {
    const r = parseSchedule('明天9点提醒我', NOW);
    expect(r.title.trim().length).toBeGreaterThan(0);
    expect(r.reminderUnspecified).toBe(true);
  });

  it('整段通知里没有提醒动词 → 不认（"关于…通知"里的"通知"不算）', () => {
    const r = parseSchedule('关于团委大会的通知\n时间：10月14日 19:00\n地点：211', NOW);
    expect(r.reminder).toBeNull();
    expect(r.reminderUnspecified).toBe(false);
  });
});

describe('不猜：认不出来就一个字都不认', () => {
  it('纯粹的待办不带上任何时间', () => {
    const r = parseSchedule('买菜', NOW);
    expect(r.time).toBeNull();
    expect(r.repeat).toBeNull();
    expect(r.title).toBe('买菜');
  });

  it('含糊的时间词一概不认 —— 落进待办，好过排到错的日子', () => {
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

/**
 * 用户真实粘贴进来的一整段通知（2026-10-08 原样给的，一个字没改）。
 *
 * 这一段的意义在于：**词形明确的那些时间词，本来就已经认得出来**（下面第一条断言
 * 第一次跑就是绿的）—— 卡住的地方从来不是"看不懂 19:00-21:50"，
 * 而是三百字的通知会整段变成日程标题。所以这一组测试盯的是**标题与备注怎么分**。
 */
describe('粘一整段通知：标题只取它真正的那一行', () => {
  const NOTICE = [
    '#关于团委大会暨团委素质拓展活动开展通知',
    '各位委员、部长、干事，你们好！',
    '🎊为了帮助干事更快地融入团委大家庭，增进新老成员之间的了解与信任，加强各部门之间的沟通与协作，团委决定开展第一次团委大会暨团委素质拓展活动，现有以下安排：',
    '1️⃣活动时间及地点：',
    '🕖时间：10月14日（下周三） 晚19:00-21:50',
    '🏠地点："一站式"学生社区211',
    '2️⃣服装要求👔：统一上白下黑（白色上装，黑色下装）',
    '3️⃣本次活动原则上需全员参加，下附有本次团委大会请假条，若有特殊情况需以正当理由填写请假条，并于【10月14日 12：00】前交给部门部长❗',
    '🌸若对活动安排有任何疑问，欢迎随时咨询！期待第一次团委大会暨大团建圆满举行！🎉🎉🥰🥰@所有人',
  ].join('\n');

  it('时间照旧认出来（整段文本不妨碍词形匹配）', () => {
    const r = parseSchedule(NOTICE, NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 14, 19, 0));
    expect(r.time?.endAt).toBe(at(2026, 10, 14, 21, 50));
    expect(r.label).toBe('10月14日 周三 19:00–21:50');
  });

  it('标题 = 第一行的名字，并剥掉"关于…通知"这层壳', () => {
    expect(parseSchedule(NOTICE, NOW).title).toBe('团委大会暨团委素质拓展活动开展');
  });

  it('地点进 location 字段，引号剥掉；备注里不再重复一份', () => {
    const r = parseSchedule(NOTICE, NOW);
    expect(r.location).toBe('"一站式"学生社区211');
    expect(r.note).not.toContain('一站式');
  });

  it('备注留下的是"除了名字/时间/地点之外的原文"，一条不丢', () => {
    const note = parseSchedule(NOTICE, NOW).note ?? '';
    expect(note).toContain('服装要求');
    expect(note).toContain('请假条');
    expect(note).toContain('@所有人');
  });

  it('时间行不留渣：时间已经进了字段，备注里不再重复一份', () => {
    expect(parseSchedule(NOTICE, NOW).note).not.toContain('（下周三）');
  });
});

describe('标题提炼只在多行时才动手', () => {
  it('单行输入行为完全不变：不提炼、备注为空', () => {
    const r = parseSchedule('明天下午3点开会', NOW);
    expect(r.title).toBe('开会');
    expect(r.note).toBeNull();
  });

  it('第一行是寒暄时往后找，不拿"各位…你们好"当名字', () => {
    const text = ['各位同学：', '运动会彩排', '10月9日 上午9:00 田径场'].join('\n');
    expect(parseSchedule(text, NOW).title).toBe('运动会彩排');
  });

  it('"地方跟时间写在同一行"时地方要留下 —— 别把"田径场"当时间渣清掉', () => {
    const text = ['运动会彩排', '10月9日 上午9:00 田径场'].join('\n');
    expect(parseSchedule(text, NOW).note).toContain('田径场');
  });

  it('"时间：另行通知"一个字都没被抠过，不许删', () => {
    const text = ['家长会', '时间：另行通知'].join('\n');
    expect(parseSchedule(text, NOW).note).toContain('另行通知');
  });

  it('一行都挑不出像样的标题时，退回整段（宁长不猜）', () => {
    const text = ['各位：', '好'].join('\n');
    const r = parseSchedule(text, NOW);
    expect(r.title).toContain('各位');
  });
});

/**
 * 地点（2026-10-08 用户拍板开字段）。
 *
 * 立场和别的识别一样：**只认写明标签的那种**，认不出就原样留在备注里。
 * 不认「在体育馆开会」这类 —— 中文里"在"字太常见，认错地点比认不出糟得多
 * （用户会按着错的地方出门）。
 */
describe('地点：只认 "标签：值" 那种写法', () => {
  it('常见的几种标签都认', () => {
    const cases: Array<[string, string]> = [
      ['明天9点开会 地点：教一101', '教一101'],
      ['明天9点开会 活动地点：教一101', '教一101'],
      ['明天9点 地址：三号楼201', '三号楼201'],
      ['明天9点 场地：体育馆', '体育馆'],
      ['明天9点 集合地点：三教门口', '三教门口'],
    ];
    for (const [text, want] of cases) {
      expect(parseSchedule(text, NOW).location, text).toBe(want);
    }
  });

  it('值的边界：不吞后面的那句话，也不跨到下一个标签', () => {
    // 「请」处停下 —— 地点拿到手，"请提前到"还留在正文里
    const a = parseSchedule('明天9点开会 地点：教一101 请提前到', NOW);
    expect(a.location).toBe('教一101');
    expect(a.title).toContain('请提前到');

    // 逗号处停下（标题行写长一点，别撞上"两个字不算标题"那条既有判据）
    const b = parseSchedule('10月9日开运动会彩排\n地点：教一101，请提前到', NOW);
    expect(b.location).toBe('教一101');
    expect(b.note).toContain('请提前到');
  });

  it('引号：包住整个地点的壳剥掉，只是强调的引号留着', () => {
    expect(parseSchedule('开会 地点："人民大会堂"', NOW).location).toBe('人民大会堂');
    expect(parseSchedule('开会 地点：「三教101」', NOW).location).toBe('三教101');
    // "一站式"是原话里的强调引号，与后面的 211 一起才是完整地点，剥掉会剩个孤零零的闭引号
    expect(parseSchedule('开会 地点："一站式"学生社区211', NOW).location).toBe(
      '"一站式"学生社区211',
    );
  });

  it('"写了等于没写"的值不认，那行原样留在备注里', () => {
    const text = ['家长会', '地点：另行通知'].join('\n');
    const r = parseSchedule(text, NOW);
    expect(r.location).toBeNull();
    expect(r.note).toContain('另行通知');
  });

  it('不认「地点在xxx」：没有标签冒号的写法一律放过（"在家工作"是地点还是状态？）', () => {
    const r = parseSchedule('明天在体育馆开会', NOW);
    expect(r.location).toBeNull();
  });

  it('地点与时间重叠时给时间让路 —— 宁可没认出地点，也不能少一个时刻', () => {
    // 「地点：」的值里裹着时刻：认它就会连时刻一起切走，所以整个不认，时间照常识出
    const r = parseSchedule('开会 地点：明天10点楼下集合', NOW);
    expect(r.location).toBeNull();
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 10, 0));
  });
});

describe('时段词单独出现 → 默认时刻（2026-10-11 指令对照表）', () => {
  it('晚上跑步 → 今天 20:00', () => {
    const r = parseSchedule('晚上跑步', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 20, 0));
    expect(r.title).toBe('跑步');
  });

  it('下午去取快递 → 今天 13:00（"下午1点"）', () => {
    const r = parseSchedule('下午去取快递', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 13, 0));
  });

  it('时段默认已过 → 顺延明天（早上 = 7 点）', () => {
    const r = parseSchedule('早上背单词', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 7, 0));
  });

  it('日期 + 光杆时段词："明天晚上交" → 明天 20:00 固定，不是截止', () => {
    const r = parseSchedule('明天晚上交', NOW);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 20, 0));
    expect(r.time?.dueAt).toBeNull();
    expect(r.title).toBe('交');
  });
});

describe('裸时刻的"最近有效"= 钟面就近（2026-10-11 拍板）', () => {
  const AFTERNOON = new Date(2026, 9, 7, 16, 0, 0); // 周三 16:00

  it('下午4点说"9点" → 今天 21:00（今天上午已过，就近取今晚）', () => {
    const r = parseSchedule('9点提醒我', AFTERNOON);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 21, 0));
  });

  it('下午4点说"11点半" → 今天 23:30', () => {
    const r = parseSchedule('11点半交作业', AFTERNOON);
    expect(r.time?.startAt).toBe(at(2026, 10, 7, 23, 30));
  });

  it('已经晚于该钟面的今天面 → 明天（"2点"在 16:00 = 明天 02:00）', () => {
    const r = parseSchedule('2点喂猫', AFTERNOON);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 2, 0));
  });

  it('冒点写法是 24 小时制，不就近：16:00 说"9:30" → 明天 9:30', () => {
    const r = parseSchedule('9:30 站会', AFTERNOON);
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 9, 30));
  });

  it('带时段词的不就近："晚上8点"过了就是明天 20:00（用户亲口说的晚上）', () => {
    const r = parseSchedule('晚上8点跑步', new Date(2026, 9, 7, 21, 0, 0));
    expect(r.time?.startAt).toBe(at(2026, 10, 8, 20, 0));
  });
});

describe('每年重复（2026-10-11 拍板： yearly 进任务，不再只归纪念日）', () => {
  it('每年3月6日体检 → yearly + 3月6日（今年的已过就明年）', () => {
    const r = parseSchedule('每年3月6日体检', NOW);
    expect(r.repeat).toEqual({ freq: 'yearly', interval: 1 });
    expect(r.repeatLabel).toBe('每年');
    // 没写钟点 → 截止当天结束（与"每月25号"同一待遇）
    expect(r.time?.dueAt).toBe(at(2027, 3, 6, 23, 59));
    expect(r.title).toBe('体检');
    // 重复词与日期词重叠，标题里一个字都不留
    expect(r.title).not.toContain('3月');
  });

  it('每年12月31日 20:00 跨年聚会 → yearly + 固定时刻', () => {
    const r = parseSchedule('每年12月31日20:00跨年聚会', NOW);
    expect(r.repeat).toEqual({ freq: 'yearly', interval: 1 });
    expect(r.time?.startAt).toBe(at(2026, 12, 31, 20, 0));
  });

  it('光杆"每年体检"也认', () => {
    const r = parseSchedule('每年体检', NOW);
    expect(r.repeat).toEqual({ freq: 'yearly', interval: 1 });
    expect(r.title).toBe('体检');
  });
});
