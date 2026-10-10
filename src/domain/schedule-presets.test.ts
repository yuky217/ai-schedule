import { describe, expect, it } from 'vitest';

import { TimeAttribute } from './enums';
import { createTask } from './factory';
import {
  buildAllDayTime,
  buildPlacedTime,
  buildRescheduledTime,
  buildRetimedSpanTime,
  buildScheduleTime,
  buildSemanticTime,
  buildSpanTime,
  buildTimeOnDay,
  SCHEDULE_PRESETS,
  SEMANTIC_TARGETS,
} from './schedule-presets';
import { timeAnchor } from './task';

/**
 * 安排预设的换算。
 *
 * 「稍后」这类相对型预设走的是"现在 + N 分钟"，不再要求用户
 * 在滚轮上对齐一个具体钟点 —— 相对时间本身就是意图。
 */

describe('buildScheduleTime', () => {
  it('时钟型：落在本日的指定钟点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'today-pm')!;
    const base = new Date(2026, 9, 7, 0, 30);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    expect(new Date(time.startAt!).getHours()).toBe(14);
    expect(new Date(time.startAt!).getDate()).toBe(7);
  });

  it('时钟型跨天：明天的钟点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'tomorrow-due')!;
    const base = new Date(2026, 9, 7, 23, 0);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Deadline);
    const due = new Date(time.dueAt!);
    expect(due.getDate()).toBe(8);
    expect(due.getHours()).toBe(23);
  });

  it('稍后：现在 + 2 小时，不落回整点', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'later')!;
    const base = new Date(2026, 9, 7, 13, 7);
    const time = buildScheduleTime(preset, base);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const at = new Date(time.startAt!);
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(7);
    expect(at.getDate()).toBe(7);
  });

  it('稍后跨天：深夜点「稍后」落到明天', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'later')!;
    const base = new Date(2026, 9, 7, 23, 30);
    const at = new Date(buildScheduleTime(preset, base).startAt!);
    expect(at.getDate()).toBe(8);
    expect(at.getHours()).toBe(1);
    expect(at.getMinutes()).toBe(30);
  });
});

/**
 * 语义词片：用「哪天」说话。
 *
 * 2026-10-07 是周三，所以 10-10 是周六、10-11 是周日、10-12 是下周一。
 * 边界都取"未来的那一天"，**任何一天点「周末」都不能落回过去**。
 */
describe('buildSemanticTime', () => {
  const wed = new Date(2026, 9, 7, 14, 30);

  const noTime = () => createTask({ title: '某件事' });
  const withFixed = (day: number, hour: number, minute = 0) => ({
    ...createTask({ title: '有时间的' }),
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: new Date(2026, 9, day, hour, minute).toISOString(),
      endAt: null,
      dueAt: null,
    },
  });
  const withDeadline = (day: number, hour: number) => ({
    ...createTask({ title: '有截止的' }),
    time: {
      attribute: TimeAttribute.Deadline,
      startAt: null,
      endAt: null,
      dueAt: new Date(2026, 9, day, hour, 0).toISOString(),
    },
  });
  const dueDate = (time: ReturnType<typeof buildSemanticTime>) =>
    new Date(time!.dueAt ?? time!.startAt!);

  it('没时间的任务：落到当天 23:59 截止，而不是上午 9 点', () => {
    const time = buildSemanticTime(noTime(), 'today', wed)!;
    expect(time.attribute).toBe(TimeAttribute.Deadline);
    const due = new Date(time.dueAt!);
    expect(due.getDate()).toBe(7);
    expect(due.getHours()).toBe(23);
    expect(due.getMinutes()).toBe(59);
  });

  it('明天 = 次日', () => {
    expect(dueDate(buildSemanticTime(noTime(), 'tomorrow', wed)).getDate()).toBe(8);
  });

  it('周末 = 本周六', () => {
    expect(dueDate(buildSemanticTime(noTime(), 'weekend', wed)).getDate()).toBe(10);
  });

  it('周末：周六当天就是今天', () => {
    const sat = new Date(2026, 9, 10, 8, 0);
    expect(dueDate(buildSemanticTime(noTime(), 'weekend', sat)).getDate()).toBe(10);
  });

  it('周末：周日给下一个周六，不给刚过去的昨天', () => {
    const sun = new Date(2026, 9, 11, 8, 0);
    expect(dueDate(buildSemanticTime(noTime(), 'weekend', sun)).getDate()).toBe(17);
  });

  it('下周 = 下周一', () => {
    expect(dueDate(buildSemanticTime(noTime(), 'nextWeek', wed)).getDate()).toBe(12);
  });

  it('下周：周一当天给下周一，不给今天', () => {
    const mon = new Date(2026, 9, 12, 9, 0);
    expect(dueDate(buildSemanticTime(noTime(), 'nextWeek', mon)).getDate()).toBe(19);
  });

  it('下周：周日给明天（就是下周一）', () => {
    const sun = new Date(2026, 9, 11, 9, 0);
    expect(dueDate(buildSemanticTime(noTime(), 'nextWeek', sun)).getDate()).toBe(12);
  });

  it('已有时间的任务：只换日期，时刻与属性都不动', () => {
    const time = buildSemanticTime(withFixed(8, 9, 15), 'weekend', wed)!;
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const at = new Date(time.startAt!);
    expect(at.getDate()).toBe(10);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(15);
  });

  it('已有截止的任务：挪日期但仍然是截止', () => {
    const time = buildSemanticTime(withDeadline(8, 18), 'tomorrow', wed)!;
    expect(time.attribute).toBe(TimeAttribute.Deadline);
    const due = new Date(time.dueAt!);
    expect(due.getDate()).toBe(8);
    expect(due.getHours()).toBe(18);
  });

  it('稍后 = 现在 + 2 小时，不落回整点', () => {
    const base = new Date(2026, 9, 7, 13, 7);
    const time = buildSemanticTime(noTime(), 'later', base)!;
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const at = new Date(time.startAt!);
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(7);
  });

  it('词片的标签就是界面文案', () => {
    expect(SEMANTIC_TARGETS.map((t) => t.label)).toEqual(['今天', '明天', '周末', '下周', '稍后']);
  });
});

/**
 * 拖边改时段 + 拖块保时长（2026-10-08）。
 *
 * 之前日历拖拽一律把 endAt 写回 null —— 有时长的块拖一次就"缩"回半小时，
 * 时长根本没有入口。现在：拽上下边 = 写始末两个刻度；拖整块 = 位置变、长度不变。
 */
describe('buildRetimedSpanTime / 时长保留', () => {
  const withSpan = (day: number, startHour: number, endHour: number) => ({
    ...createTask({ title: '有时长的' }),
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: new Date(2026, 9, day, startHour, 0).toISOString(),
      endAt: new Date(2026, 9, day, endHour, 0).toISOString(),
      dueAt: null,
    },
  });

  it('拽边：始末两个刻度都写回，endAt 从此有了', () => {
    const task = withSpan(8, 9, 10);
    const time = buildRetimedSpanTime(task, 8 * 60 + 30, 10 * 60 + 30)!;
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    expect(new Date(time.startAt!).getHours()).toBe(8);
    expect(new Date(time.startAt!).getMinutes()).toBe(30);
    expect(new Date(time.endAt!).getHours()).toBe(10);
    expect(new Date(time.endAt!).getMinutes()).toBe(30);
  });

  it('没 endAt 的块拽边后也有了 endAt', () => {
    const task = withSpan(8, 9, 10);
    const bare = { ...task, time: { ...task.time, endAt: null } };
    const time = buildRetimedSpanTime(bare, 9 * 60, 9 * 60 + 45)!;
    expect(time.endAt).not.toBeNull();
    expect(new Date(time.endAt!).getMinutes()).toBe(45);
  });

  it('结束不晚于开始（倒挂）返回 null，不该落库', () => {
    const task = withSpan(8, 9, 10);
    expect(buildRetimedSpanTime(task, 10 * 60, 9 * 60)).toBeNull();
  });

  it('截止型任务没有"始末"，返回 null', () => {
    const task = {
      ...createTask({ title: '截止', dueAt: new Date(2026, 9, 8, 23, 59).toISOString() }),
    };
    expect(buildRetimedSpanTime(task, 9 * 60, 10 * 60)).toBeNull();
  });

  it('拖整块：位置变、时长不变（两小时的会拖到下午还是两小时）', () => {
    const task = withSpan(8, 9, 11);
    const time = buildPlacedTime(task, new Date(2026, 9, 8), 14 * 60)!;
    expect(new Date(time.startAt!).getDate()).toBe(8);
    expect(new Date(time.startAt!).getHours()).toBe(14);
    expect(new Date(time.endAt!).getHours()).toBe(16);
  });

  it('拖整块改期（月视图）：时长同样跟着走', () => {
    const task = withSpan(8, 9, 11);
    const time = buildRescheduledTime(task, new Date(2026, 9, 20))!;
    expect(new Date(time.startAt!).getDate()).toBe(20);
    expect(new Date(time.startAt!).getHours()).toBe(9);
    expect(new Date(time.endAt!).getDate()).toBe(20);
    expect(new Date(time.endAt!).getHours()).toBe(11);
  });

  it('没定过时长的块拖整块：仍然没有 endAt（不替用户编一个）', () => {
    const task = withSpan(8, 9, 11);
    const bare = { ...task, time: { ...task.time, endAt: null } };
    const time = buildPlacedTime(bare, new Date(2026, 9, 8), 14 * 60)!;
    expect(time.endAt).toBeNull();
  });
});

/**
 * 空地上拖出一个时段（2026-10-10）：日历时间轴上"长按空白处拖动"新建日程走的换算。
 *
 * 它与 `buildRetimedSpanTime` 共用同一段实现 —— 这两条路必须给出**同一天同一时刻**，
 * 否则"拖出来新建的"和"拖完再调整的"会落在不同的地方，而用户完全看不出为什么。
 */
describe('buildSpanTime / 某天 + 起止分钟', () => {
  it('把起止分钟落到指定的那一天上', () => {
    const time = buildSpanTime(new Date(2026, 9, 8), 14 * 60, 15 * 60 + 30)!;
    const start = new Date(time.startAt!);
    expect(start.getDate()).toBe(8);
    expect(start.getHours()).toBe(14);
    expect(start.getMinutes()).toBe(0);
    expect(new Date(time.endAt!).getHours()).toBe(15);
    expect(new Date(time.endAt!).getMinutes()).toBe(30);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
  });

  it('时分带进结果：9:45 就是 9:45，不被抹成整点', () => {
    const time = buildSpanTime(new Date(2026, 9, 8), 9 * 60 + 45, 10 * 60 + 15)!;
    expect(new Date(time.startAt!).getMinutes()).toBe(45);
    expect(new Date(time.endAt!).getMinutes()).toBe(15);
  });

  it('倒挂（结束不晚于开始）返回 null —— 不建零长度的日程', () => {
    const day = new Date(2026, 9, 8);
    expect(buildSpanTime(day, 10 * 60, 9 * 60)).toBeNull();
    expect(buildSpanTime(day, 10 * 60, 10 * 60)).toBeNull();
  });

  it('非法日期返回 null', () => {
    expect(buildSpanTime(new Date('nope'), 9 * 60, 10 * 60)).toBeNull();
  });

  it('越界的分钟夹回一天之内（拖到时间轴外面的兜底）', () => {
    const time = buildSpanTime(new Date(2026, 9, 8), -30, 30 * 60)!;
    expect(new Date(time.startAt!).getHours()).toBe(0);
    expect(new Date(time.endAt!).getHours()).toBe(23);
    expect(new Date(time.endAt!).getMinutes()).toBe(59);
  });

  it('⭐ 与 buildRetimedSpanTime 同一口径：同一天同一对刻度落成同一个时刻', () => {
    const task = {
      ...createTask({ title: '先有的一条' }),
      time: {
        attribute: TimeAttribute.Fixed,
        startAt: new Date(2026, 9, 8, 9, 0).toISOString(),
        endAt: null,
        dueAt: null,
      },
    };
    const fromScratch = buildSpanTime(new Date(2026, 9, 8), 8 * 60 + 30, 10 * 60 + 30)!;
    const fromTask = buildRetimedSpanTime(task, 8 * 60 + 30, 10 * 60 + 30)!;
    expect(fromScratch.startAt).toBe(fromTask.startAt);
    expect(fromScratch.endAt).toBe(fromTask.endAt);
  });
});

/**
 * 落到某一天（2026-10-08）：待办拖到日期条走的就是它。
 *
 * 与语义词片共用同一份口径，所以这条测试守的其实是"同义词不许给出两种结果"
 * —— 点「明天」和把这条拖到明天那一格，必须落在完全相同的时刻上。
 */
describe('buildTimeOnDay', () => {
  const noTime = () => createTask({ title: '某件事' });
  const wed = new Date(2026, 9, 7, 14, 30);
  const tomorrow = new Date(2026, 9, 8);

  it('没时间的任务：落到那天 23:59 截止，而不是上午 9 点', () => {
    const time = buildTimeOnDay(noTime(), tomorrow)!;
    expect(time.attribute).toBe(TimeAttribute.Deadline);
    const due = new Date(time.dueAt!);
    expect(due.getDate()).toBe(8);
    expect(due.getHours()).toBe(23);
    expect(due.getMinutes()).toBe(59);
  });

  it('已经有时间的任务：只换日期，时刻与属性都不动', () => {
    const task = {
      ...createTask({ title: '有时间的' }),
      time: {
        attribute: TimeAttribute.Fixed,
        startAt: new Date(2026, 9, 7, 9, 15).toISOString(),
        endAt: null,
        dueAt: null,
      },
    };
    const time = buildTimeOnDay(task, new Date(2026, 9, 20))!;
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const at = new Date(time.startAt!);
    expect(at.getDate()).toBe(20);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(15);
  });

  it('还没有任务、手上只有一段时间时也能用（在日历某天新建一件走这条路）', () => {
    // 什么都没解析出来 → 就是那天的 23:59 截止
    expect(buildTimeOnDay({ time: noTime().time }, tomorrow)).toEqual(
      buildTimeOnDay(noTime(), tomorrow),
    );
    // 文字里写了时刻 → 时刻留着，只把日子换到这天
    const withTime = buildTimeOnDay(
      {
        time: {
          attribute: TimeAttribute.Fixed,
          startAt: new Date(2026, 9, 3, 15, 0).toISOString(),
          endAt: null,
          dueAt: null,
        },
      },
      new Date(2026, 9, 20),
    )!;
    const at = new Date(withTime.startAt!);
    expect(at.getDate()).toBe(20);
    expect(at.getHours()).toBe(15);
  });

  it('⭐ 与词片同一口径：点「明天」与拖到明天那一格，结果必须一模一样', () => {
    expect(buildTimeOnDay(noTime(), tomorrow)).toEqual(
      buildSemanticTime(noTime(), 'tomorrow', wed),
    );
  });

  it('非法日期不落库', () => {
    expect(buildTimeOnDay(noTime(), new Date('nope'))).toBeNull();
  });
});

describe('buildAllDayTime：全天（占满一整天）', () => {
  it('整天覆盖 00:00 → 23:59:59，并带上 allDay 标记', () => {
    const time = buildAllDayTime(new Date(2026, 9, 10, 14, 30))!;
    expect(time.allDay).toBe(true);
    expect(time.attribute).toBe(TimeAttribute.Fixed);
    const start = new Date(time.startAt!);
    const end = new Date(time.endAt!);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('⭐ 忽略传入的时刻 —— 全天没有"几点"可言，造个假的 00:00 出来就是撒谎', () => {
    const a = buildAllDayTime(new Date(2026, 9, 10, 0, 0))!;
    const b = buildAllDayTime(new Date(2026, 9, 10, 18, 45))!;
    expect(a.startAt).toBe(b.startAt);
  });

  it('⭐ 锚点仍落在当天 —— 全天如果没锚点，日历窗口就收不到它', () => {
    const time = buildAllDayTime(new Date(2026, 9, 10, 9, 0))!;
    expect(new Date(time.startAt!).getDate()).toBe(10);
    expect(timeAnchor(time)).toBe(time.startAt);
  });

  it('与截止型区分开：全天是"这天都算它"，不是"这天之前交"', () => {
    const time = buildAllDayTime(new Date(2026, 9, 10))!;
    expect(time.dueAt).toBeNull();
  });

  it('非法日期不落库', () => {
    expect(buildAllDayTime(new Date('nope'))).toBeNull();
  });
});
