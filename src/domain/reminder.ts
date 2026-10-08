import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { TaskStatus, TimeAttribute } from './enums';
import type { TaskKind } from './enums';
import { nextOccurrence } from './repeat-next';
import { taskAnchor, type RepeatRule, type Task } from './task';

/**
 * 「这条任务的提醒到底几点响」。
 *
 * 为什么放 domain：判定必须与 entry/notifications.scheduleTaskReminder
 * 用同一套规则（**有没有设提醒**、有明确时间、时间在未来、提前量已过退准点），
 * 否则界面显示的会和实际排出去的不是一回事。
 * 更重要的背景：提醒调度有四个**静默失败口**（没设、无时间、已过、权限、环境），
 * 失败时用户收不到任何反馈 —— 这里负责把"排没排上"变成可见的文字。
 *
 * ## 提前量的三种状态（2026-10-08 用户拍板）
 *
 * `reminderMinutesBefore`：**`null` = 不提醒**（默认就是它）、`0` = 准点、`>0` = 提前 N 分钟。
 *
 * 以前 `null` 和 `0` 是一回事（都当准点响），于是"没点过提醒那一格"的人也照样被提醒，
 * 而且 chip 上显示成灰的「提醒」、行为上却会响 —— 界面说没设，实际设了。
 * 现在 `null` 有明确含义，而且与**课表**的同一个字段名取得了一致（那边一直是 null = 不提醒）。
 */

/** 下一次提醒的触发时刻；null = 这条任务不会响 */
export function nextFireAt(task: Task, now: Date = new Date()): Date | null {
  // 口径只有一处（reminderFireTimes），这里只是取"最早的那个" ——
  // 界面说的"下一次几点响"与调度真正排出去的时刻必须是同一个答案。
  return reminderFireTimes(task, { now })[0] ?? null;
}

/**
 * 一条重复任务一次往后排几天。
 *
 * 与课表取同一个数（`syncCourseReminders` 的 days），理由也一样：
 * 一次性通知在安卓上有数量上限，一次排太多会被系统**静默丢掉一部分**
 * （最难查的那种 bug）；而那么远的提醒本来就该随任务改动重排 ——
 * 每次启动把这个窗口补满即可。
 */
export const REMINDER_WINDOW_DAYS = 7;

/**
 * 这条任务接下来要在**哪几个时刻**响（按时间升序）。
 *
 * 这是调度的**唯一口径**：`nextFireAt`（界面显示）、`scheduleTaskReminder`
 * （真正排通知）、启动补排三处都走它，所以"界面说的"和"手机会响的"必然一致。
 *
 * - 没设提醒（`null`）/ 已完成 / 没有时间 → `[]`，一条都不排；
 * - **单次任务 → 0 或 1 个时刻**，且不受窗口限制（一周后的一次性安排也要响）；
 * - **重复任务 → 未来 `days` 天内的每一期**，另外**无条件带上最近的一期** ——
 *   "每月 25 号"的下一期可能落在 7 天之外，若被窗口裁掉，这条任务就**一条提醒都不会有**
 *   （功能看着在、实际从不响，是最糟的一类 bug）。
 *
 * 提前量已过、但准点还没到时退回准点（与排程同一取舍：响得晚比不响好）。
 */
export function reminderFireTimes(
  task: Task,
  options: { days?: number; now?: Date } = {},
): Date[] {
  if (task.status === TaskStatus.Done) return [];
  // 没设提醒 = 不打扰。先于"有没有时间"判：没设就不该响，跟时间无关
  if (task.reminderMinutesBefore == null) return [];

  const anchor = taskAnchor(task);
  if (!anchor) return [];
  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime())) return [];

  const now = options.now ?? new Date();
  const offset = task.reminderMinutesBefore;
  const days = options.days != null && options.days > 0 ? options.days : REMINDER_WINDOW_DAYS;

  /** 某一期"该在什么时候响"；null = 这一期已经不值得排了 */
  const fireOf = (occurrence: Date): Date | null => {
    const fire = new Date(occurrence.getTime() - offset * 60_000);
    if (fire.getTime() > now.getTime()) return fire;
    // 提前量时刻已过、但准点还没到 → 退回准点（响得晚比不响好）
    if (offset > 0 && occurrence.getTime() > now.getTime()) return occurrence;
    return null;
  };

  const fires: Date[] = [];
  const first = fireOf(anchorAt);
  if (first) fires.push(first);

  // 单次任务到此为止：它只有这一期
  if (!task.repeat) return fires;

  const rule = task.repeat;
  // 锚点可能在过去（几天没完成，时间还停在上一期）—— 先滚到第一个还没到的期。
  // 上限 3660 与 advanceRepeatingTask 取同一个数：十年日任务足够兜底，也不会转不完。
  let occurrence = new Date(anchorAt);
  let guard = 0;
  const firstPending = () => {
    while (occurrence.getTime() <= now.getTime() && guard < 3660) {
      const next = nextOccurrence(rule, occurrence);
      if (!next) return null;
      occurrence = next;
      guard += 1;
    }
    return occurrence.getTime() > now.getTime() ? occurrence : null;
  };

  const start = firstPending();
  if (!start) return fires;

  const startFire = fireOf(start);
  // 锚点自身还在未来时，上面已经排过它了（first），这里别排重
  if (startFire && !fires.some((d) => d.getTime() === startFire.getTime())) fires.push(startFire);

  const windowEnd = now.getTime() + days * 86_400_000;
  let cursor = start;
  for (let i = 0; i < 366; i += 1) {
    const next = nextOccurrence(rule, cursor);
    if (!next || next.getTime() > windowEnd) break;
    const fire = fireOf(next);
    if (fire) fires.push(fire);
    cursor = next;
  }

  return fires.sort((a, b) => a.getTime() - b.getTime());
}

/** 提醒状态的一句话说明（详情页「提醒」行下方的状态字） */
export function describeNextFire(task: Task, now: Date = new Date()): string {
  if (task.status === TaskStatus.Done) return '已完成，不再提醒';

  const anchor = taskAnchor(task);
  if (!anchor) return '定个时间才会提醒';

  if (task.reminderMinutesBefore == null) return '还没有提醒，想要就挑一个提前量';

  const anchorAt = new Date(anchor);
  if (Number.isNaN(anchorAt.getTime()) || anchorAt.getTime() <= now.getTime()) {
    return '时间已过，这次不会再提醒';
  }

  const fire = nextFireAt(task, now);
  return `将在 ${format(fire!, 'M月d日 HH:mm', { locale: zhCN })} 提醒你`;
}

/**
 * 「有明显的准备动作」的词 —— 命中就把默认提前量抬到 1 小时。
 *
 * 这些词共同点：**光知道"几点出发"没用，你得提前开始收拾**。
 * 「出发 / 赶 + 交通工具 / 收拾行李 / 出门 / 接人送人」就是这类。
 *
 * ## 为什么只认这几个，而不是"开会 / 课 / 交"
 *
 * 词表越宽，命中的越可能是**自称**而不是**行为**：
 * "课程设计答辩"里有「课」、"会议纪要整理"里有「会」，
 * 都会被误抬到提前 1 小时。而**猜错的提醒用户根本不知道去哪儿改** ——
 * 与 `extractLocation` 同一个取舍：**只认明确词形，宁可不认，绝不瞎认**。
 *
 * `赶` 必须带交通工具（"赶飞机"算，"赶工/赶紧"不算）；
 * `接 / 送` 必须带人（"接电话"不算）。
 */
const PREP_ACTION =
  /出发|出门|动身|启程|上路|收拾|打包|整理行李|装行李|赶(?:飞机|火车|高铁|车|班车|大巴|轮渡|船)|[接送](?:人|机|站|朋友|同学|老师|孩子)/;

/**
 * 「提了提醒、但没说提前多久」时，这件事该提前多久。
 *
 * 分类型给，而不是一律准点（准点对"要出门的事"等于没提醒）：
 * - **截止型**（"12:00 前交请假条"）：提前 1 小时 —— 截止要留出"把它做完"的时间，
 *   准点提醒等于通知你"已经晚了"。
 * - **重复 / 习惯型**（"每天 8 点吃药"、"每周三次跑步"）：准点 —— 到点就该做，
 *   提前 10 分钟没有额外价值。
 * - **有地点的日程**（教室、会议室、别人那儿）：提前 20 分钟 —— 要动身：
 *   走路、换教室、找楼，10 分钟只够你从座位上站起来。
 * - **标题里有明显准备动作**（"19:90 出发去机场"）：提前 1 小时 ——
 *   收拾、出门、赶车都要时间，等到该出发了才提醒等于没提醒。
 * - **其余**（线上会、自己安排的时段）：提前 10 分钟 —— 你只需要"准备开始了"。
 *
 * ## 两条判断依据为什么是它们俩
 *
 * 地点是**结构化字段**（用户填的，或「地点：xxx」识别到的），判断零成本零误判；
 * 准备动作是**标题里的明确词形**，词表窄到几乎不会自伤。
 * 相比之下"开会 vs 自习"要靠猜关键词 —— 猜错的提醒比不给默认值更烦。
 *
 * ## 顺序（别调换）
 *
 * ① 截止型（最硬的时间形态）→ ② 准点档（重复/习惯："到点做"这件事压过一切，
 * 每天 8 点吃药不会因为"有地点"就变成提前 20）→ ③ 准备动作 → ④ 地点 → ⑤ 兜底。
 *
 * 只用在"用户提了提醒但没给量"（"记得提醒我"）那一处。**没提就是不提醒**。
 */
export function defaultReminderMinutes(ctx: {
  kind: TaskKind;
  attribute: TimeAttribute;
  repeat?: RepeatRule | null;
  /** 有地点 = 要动身。传解析出的地点或任务上已填的地点 */
  location?: string | null;
  /** 标题或备注原文，用来找「出发 / 赶飞机」这类准备动作 */
  text?: string | null;
}): number {
  if (ctx.attribute === TimeAttribute.Deadline) return 60;
  if (ctx.repeat || ctx.kind === 'habit') return 0;
  if (ctx.text && PREP_ACTION.test(ctx.text)) return 60;
  if (ctx.location) return 20;
  return 10;
}

/**
 * 这次记录最终该不该提醒、提前多久 —— **一个函数收口**。
 *
 * 界面（chip 上显示什么）与落库（存进 `reminderMinutesBefore` 的值）必须走同一条，
 * 否则会出现"chip 写着提前 10 分钟、库里存的是不提醒"这种两套口径。
 *
 * 优先级：**手动的压过识别的**（用户在 chip 里点过就以他为准，点了「不提醒」也是他点过），
 * 其次用文字里写明的提前量，只有"提了提醒没给量"才落到类型默认，其余一律不提醒。
 */
export function resolveReminderMinutes(args: {
  /** 用户当场在 chip 里设的值；**undefined = 没动过**，null = 明确不要提醒 */
  manual?: number | null;
  /** 文字里写明的提前量（0 = 准点） */
  parsed?: number | null;
  /** 文字里提了提醒但没写提前多久 */
  parsedUnspecified?: boolean;
  kind: TaskKind;
  attribute: TimeAttribute;
  repeat?: RepeatRule | null;
  /** 解析出的地点（"地点：三教101"）。有它就默认提前 20 分钟 */
  location?: string | null;
  /** 原文，用来找「出发 / 赶飞机」这类准备动作 */
  text?: string | null;
}): number | null {
  if (args.manual !== undefined) return args.manual;
  if (args.parsed != null) return args.parsed;
  if (args.parsedUnspecified) {
    return defaultReminderMinutes({
      kind: args.kind,
      attribute: args.attribute,
      repeat: args.repeat,
      location: args.location,
      text: args.text,
    });
  }
  return null;
}
