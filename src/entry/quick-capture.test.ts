import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { quickCapture } from './quick-capture';

/**
 * 入口层唯一落库函数（主流程的「记 → 分 → 落」）。
 *
 * 这里只钉一件事：**粘一整段通知之后，落进库里的到底是什么。**
 * 时间识别与标题提炼的算法在 `domain/parse-schedule` 有自己的测试，
 * 这一层要守的是**它们有没有被正确接上** —— 识别对了、但落库时用的是原始文本，
 * 用户看到的还是一条三百字的日程。
 */

const written: Array<Record<string, unknown>> = [];

vi.mock('@/data/repositories/task-repository', () => ({
  taskRepository: {
    create: vi.fn(async (task: Record<string, unknown>) => {
      written.push(task);
    }),
  },
}));

vi.mock('@/data/repositories/idea-repository', () => ({
  ideaRepository: {
    create: vi.fn(async (idea: Record<string, unknown>) => {
      written.push(idea);
    }),
  },
}));

/*
 * 排程器照真实契约来：**没设提醒就不排**（真实现里也是这个 guard）。
 * 如果这里无脑返回一个 id，"没提提醒就不发通知"这条口径就永远测不出来。
 */
vi.mock('./notifications', () => ({
  scheduleTaskReminder: vi.fn(async (task: { reminderMinutesBefore?: number | null }) =>
    task.reminderMinutesBefore == null ? null : 'notification-id',
  ),
}));

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

describe('quickCapture：粘一整段通知', () => {
  beforeEach(() => {
    written.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('落库的标题是提炼过的，不是那三百字原文', async () => {
    const r = await quickCapture({ text: NOTICE });
    expect(r.title).toBe('团委大会暨团委素质拓展活动开展');
    expect(r.route).toBe('calendar');
  });

  it('原文没有丢：地点这些全在备注里', async () => {
    await quickCapture({ text: NOTICE });
    const task = written[0]!;
    expect(String(task.note)).toContain('地点："一站式"学生社区211');
  });

  /*
   * 2026-10-08 用户拍板：**没提提醒就不发通知**。
   * 这段通知里一个字都没提"提醒"，所以它只落到日历上，不会有人来打扰你。
   * （以前只要落到日历就一律排一条准点提醒。）
   */
  it('有时间 → 进日历，但这段通知没提提醒 → 不排通知', async () => {
    const r = await quickCapture({ text: NOTICE });
    const time = written[0]!.time as { startAt: string; endAt: string };
    expect(new Date(time.startAt).getHours()).toBe(19);
    expect(new Date(time.endAt).getHours()).toBe(21);
    expect(written[0]!.reminderMinutesBefore).toBeNull();
    expect(r.reminderScheduled).toBe(false);
  });

  it('文字里写了提前量 → 落库时带上它', async () => {
    const r = await quickCapture({ text: '10月14日 19:00 团委大会，提前半小时提醒我' });
    expect(written[0]!.reminderMinutesBefore).toBe(30);
    expect(r.reminderScheduled).toBe(true);
  });

  it('只提了提醒没给量 → 按事情的类型给默认值（日程 10 分钟）', async () => {
    const r = await quickCapture({ text: '10月14日 19:00 团委大会，记得提醒我' });
    expect(written[0]!.reminderMinutesBefore).toBe(10);
    expect(r.reminderScheduled).toBe(true);
  });

  it('只提了提醒没给量、是截止型 → 提前 1 小时', async () => {
    await quickCapture({ text: '10月14日 12:00 前交请假条，记得提醒我' });
    expect(written[0]!.reminderMinutesBefore).toBe(60);
  });

  it('用户点了「不提醒」→ 压过文字里写的', async () => {
    const r = await quickCapture({
      text: '10月14日 19:00 团委大会，提前半小时提醒我',
      reminderMinutesBefore: null,
    });
    expect(written[0]!.reminderMinutesBefore).toBeNull();
    expect(r.reminderScheduled).toBe(false);
  });

  /*
   * 用户在 chip 里手选过时间之后，**标题照样要提炼** ——
   * 以前"给了时间就跳过整个解析"，那条路会把通知原文原样当标题写进库。
   */
  it('用户手选了时间，标题仍然提炼', async () => {
    const manual = {
      attribute: 'fixed' as const,
      startAt: new Date(2026, 9, 20, 14, 0).toISOString(),
      endAt: null,
      dueAt: null,
    };
    const r = await quickCapture({ text: NOTICE, time: manual });
    expect(r.title).toBe('团委大会暨团委素质拓展活动开展');
    const time = written[0]!.time as { startAt: string };
    expect(new Date(time.startAt).getDate()).toBe(20); // 手动的压过识别的
  });

  it('标成灵感时，想法库拿到的是一字不改的全文', async () => {
    await quickCapture({ text: NOTICE, markedAsInspiration: true });
    const idea = written[0]!;
    expect(String(idea.content)).toContain('地点："一站式"学生社区211');
    expect(String(idea.content)).toContain('关于团委大会暨团委素质拓展活动开展通知');
  });
});
