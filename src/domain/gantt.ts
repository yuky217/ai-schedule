import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

import { hasAnyTime } from './task';

/**
 * 甘特图的布局计算（主文档 5.3：**甘特图只是视图，不是新实体**）。
 *
 * 所以这里不引入任何"甘特"数据，只做一件事：把一堆带起止时间的实体
 * （容器 / 任务）投影到同一条时间轴上，算出每一行占的横向比例。
 *
 * 抽成纯函数有两个好处：
 * 1. 时间轴范围、"只有一天的点标记怎么画"这类边界能单测，不用靠肉眼看图；
 * 2. 视图层只剩"把比例乘成像素"，将来加缩放/拖拽不用重算范围。
 */

export type GanttKind = 'container' | 'task';

export interface GanttItem {
  id: string;
  label: string;
  kind: GanttKind;
  /** 起止时间（ISO）。容器用 startAt/endAt，任务用 startAt/dueAt */
  startAt?: string | null;
  endAt?: string | null;
  dueAt?: string | null;
  /** 已完成的画成浅色 */
  done?: boolean;
  /** 右上角小标签（如"项目""文件夹""日程"） */
  badge?: string;
}

export interface GanttRow {
  item: GanttItem;
  start: Date;
  end: Date;
  /** 0..1，相对时间轴起点 */
  left: number;
  /** 0..1，相对时间轴总长 */
  width: number;
  /** 只有单一时间点（当天、无跨度）—— 视图层画成小圆点而不是长条 */
  point: boolean;
}

export interface GanttLayout {
  rows: GanttRow[];
  from: Date;
  to: Date;
  /** 时间轴跨越的自然日数 */
  days: number;
  /** 今天在时间轴上的位置 0..1；今天不在范围内时为 null */
  todayRatio: number | null;
}

/** 时间轴最少显示两周 —— 只排了两天却铺满整屏会让人误判节奏 */
const MIN_DAYS = 14;
/** 两端各留一点空白，避免条子顶到边上 */
const PAD_DAYS = 2;

const toDay = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
};

interface Parsed {
  item: GanttItem;
  start: Date;
  end: Date;
}

function parseItems(items: GanttItem[]): Parsed[] {
  const parsed: Parsed[] = [];
  for (const item of items) {
    const start = toDay(item.startAt) ?? toDay(item.endAt) ?? toDay(item.dueAt);
    const end = toDay(item.endAt) ?? toDay(item.dueAt) ?? start;
    if (!start || !end) continue;
    const [a, b] = start.getTime() <= end.getTime() ? [start, end] : [end, start];
    parsed.push({ item, start: a, end: b });
  }
  return parsed;
}

export function layoutGantt(items: GanttItem[], now: Date = new Date()): GanttLayout {
  const today = startOfDay(now);
  const parsed = parseItems(items);

  // 一条都没有：给一个"今天往后两周"的空轴，而不是崩溃或空白一片
  if (!parsed.length) {
    const from = addDays(today, -PAD_DAYS);
    const to = addDays(from, MIN_DAYS);
    return { rows: [], from, to, days: MIN_DAYS, todayRatio: PAD_DAYS / MIN_DAYS };
  }

  let min = parsed[0].start.getTime();
  let max = parsed[0].end.getTime();
  for (const row of parsed) {
    min = Math.min(min, row.start.getTime());
    max = Math.max(max, row.end.getTime());
  }
  // 今天一定在轴上 —— 甘特图没有"今天"这条参照线就失去意义
  min = Math.min(min, today.getTime());
  max = Math.max(max, today.getTime());

  const from = addDays(new Date(min), -PAD_DAYS);
  let to = addDays(new Date(max), PAD_DAYS);
  if (differenceInCalendarDays(to, from) < MIN_DAYS) to = addDays(from, MIN_DAYS);

  const span = to.getTime() - from.getTime();
  const ratio = (d: Date) => (d.getTime() - from.getTime()) / span;
  const days = Math.max(1, differenceInCalendarDays(to, from));

  const rows: GanttRow[] = parsed.map((row) => {
    const point = differenceInCalendarDays(row.end, row.start) === 0;
    const left = ratio(row.start);
    const right = ratio(addDays(point ? row.start : row.end, 1));
    return {
      item: row.item,
      start: row.start,
      end: row.end,
      left,
      width: Math.max(0, right - left),
      point,
    };
  });

  const rawToday = ratio(today);
  return {
    rows,
    from,
    to,
    days,
    todayRatio: rawToday >= 0 && rawToday <= 1 ? rawToday : null,
  };
}

export interface GanttTick {
  date: Date;
  /** 0..1 */
  ratio: number;
  label: string;
}

/**
 * 轴上刻度：跨度 <= 21 天按天标（只标 1/5/10…），更长则按周标。
 * 手机宽度放不下太多文字，所以标签密度跟着跨度走。
 */
export function ganttTicks(layout: GanttLayout): GanttTick[] {
  const { from, to, days } = layout;
  const span = to.getTime() - from.getTime();
  const step = days <= 21 ? 7 : days <= 60 ? 7 : 14;
  const ticks: GanttTick[] = [];

  for (let offset = 0; offset <= days; offset += step) {
    const date = addDays(from, offset);
    ticks.push({
      date,
      ratio: (date.getTime() - from.getTime()) / span,
      label: days <= 60 ? `${date.getMonth() + 1}/${date.getDate()}` : `${date.getMonth() + 1}月`,
    });
  }
  return ticks;
}

/* ------------------------------------------------------------------ */
/* 拖拽改期                                                            */
/* ------------------------------------------------------------------ */

/**
 * 哪些条子可以被拖动。
 *
 * **只给任务条。** 容器条（目标 / 项目的起止）是这张图的框架，
 * 拖它就意味着"整个项目平移" —— 那按理该把成员任务一起推，
 * 否则框动了、成员没动，图就骗人了。而"整体平移项目"属于另一件事
 * （需要确认弹窗 + 批量改期），不在这一版里（宁可不做，也不做半成品）。
 */
export function canReschedule(item: GanttItem): boolean {
  if (item.kind !== 'task') return false;
  return hasAnyTime(item);
}

/**
 * 把 ISO 时间平移 N 天，**保留原本的时分**（改期不该顺手把 09:00 的会变成 00:00）。
 * 空值原样返回 null：任务只有 dueAt 时，不该因为拖了一下就凭空长出一个 startAt。
 */
export function shiftIsoByDays(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  if (!Number.isFinite(days)) return iso;
  const shift = Math.trunc(days);
  if (!shift) return iso;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return addDays(d, shift).toISOString();
}

/**
 * 手指横向位移 → 平移天数。
 *
 * 轴的宽度对应 `days` 个自然日，所以每天的像素宽 = contentWidth / days。
 * 拖过半格就换天（跟月视图拖拽"过中线才换"的手感一致）。
 *
 * ⚠️ 取整必须先取绝对值再补回符号：JS 的 `Math.round(-2.5)` 是 **-2**，
 * 而 `Math.round(2.5)` 是 3 —— 直接用会变成"往左拖半格不换天、往右拖半格换天"，
 * 用户会觉得拖回来要更远一点。这种不对称在真机上很别扭。
 */
export function daysFromDrag(dxPixels: number, contentWidth: number, days: number): number {
  if (!Number.isFinite(dxPixels) || contentWidth <= 0 || days <= 0) return 0;
  const raw = (dxPixels / contentWidth) * days;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** 拖拽预览文案："往后 3 天" / "往前 2 天" / "原位" */
export function describeDayShift(days: number): string {
  if (!days) return '原位';
  return days > 0 ? `往后 ${days} 天` : `往前 ${Math.abs(days)} 天`;
}
