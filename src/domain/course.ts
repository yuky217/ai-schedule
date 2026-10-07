/**
 * 课程（课程表）—— 与"任务"并列的独立实体。
 *
 * 为什么不把课表塞进任务表：
 * 1. 任务有"完成态"，课没有。一节课上完不需要被勾掉，下周它还得在。
 * 2. 课表描述的是**一个学期的时间框架**（第 1-16 周、每周三 3-4 节），
 *    不是"某天要做的一件事"。硬塞进去会让任务列表被 20 门课灌满，
 *    也会把"完成率/回顾"这些口径污染掉。
 * 3. 课表的时刻来自**作息表**（第几节），任务是具体钟点，换算方式不同。
 *
 * 纯 TypeScript（可单测），不依赖 RN / Expo。
 */

import { parseDayKey, toDayKey } from '@/utils/datetime';

import type { BaseEntity } from './base';
import { periodSpan, type ClassPeriod } from './timetable';

/** 单双周：一门课可能只上前半段周、或者隔周上 */
export const WeekParity = {
  /** 每周（默认） */
  All: 'all',
  /** 单周 */
  Odd: 'odd',
  /** 双周 */
  Even: 'even',
} as const;
export type WeekParity = (typeof WeekParity)[keyof typeof WeekParity];

/**
 * 一次上课安排（"周三 3-4 节，第 1-16 周，单周，教一 101"）。
 * 一门课可以有多次（周一 1-2 节 + 周四 5-6 节 = 两条 session）。
 */
export interface CourseSession {
  /** 0 = 周日 … 6 = 周六（跟 Date.getDay() 一致，别自己发明顺序） */
  weekday: number;
  /** 起始节（1 起） */
  startPeriod: number;
  /** 结束节（含） */
  endPeriod: number;
  /** 起始周（1 起，含） */
  startWeek: number;
  /** 结束周（含） */
  endWeek: number;
  parity: WeekParity;
  /** 单次地点覆盖（多数时候用课程的地点，但这门课换教室也常见） */
  location?: string | null;
}

export interface Course extends BaseEntity {
  title: string;
  teacher?: string | null;
  location?: string | null;
  note?: string | null;
  /** 取色板下标（配色在界面层决定，领域层不碰颜色） */
  colorIndex: number;
  sessions: CourseSession[];
  /** 上课提醒提前量（分钟）；null = 不提醒 */
  reminderMinutesBefore?: number | null;
}

/**
 * 学期：把"第几周"落到具体日期的唯一依据。
 * startDayKey 必须是**第 1 周的周一**（否则整张课表的周次全错，
 * 所以设置项里会用 startOfWeek(weekStartsOn: 1) 兜底）。
 */
export interface Term {
  /** 'YYYY-MM-DD'，第 1 周的周一 */
  startDayKey: string;
  totalWeeks: number;
  periods: readonly ClassPeriod[];
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 课表按周一打头显示（跟日历一致），周日在最后 */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const weekdayLabel = (weekday: number): string => WEEKDAY_LABELS[weekday] ?? '';

/** 同一天的一节课（已换算好时刻），界面直接用 */
export interface CourseSlot {
  course: Course;
  session: CourseSession;
  date: Date;
  /** 当天第几分钟 */
  start: number;
  end: number;
}

/** 那一天的课，按"开学第几天"排序用的天数差（本地日） */
function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 864e5);
}

/**
 * 某个日期是学期第几周（1 起）。
 * 学期开始之前返回 0 或负数，学期之后超出 totalWeeks ——
 * **刻意不夹到范围内**：调用方拿它跟 session 的周次区间比较即可，
 * 夹边界会把"还没开学"的课也算成第 1 周。
 */
export function weekIndexOf(term: Term, date: Date): number | null {
  const start = parseDayKey(term.startDayKey);
  if (!start) return null;
  return Math.floor(dayDiff(start, date) / 7) + 1;
}

/** 这一周（第几周）是否正好落在 session 的周次区间与单双周要求里 */
export function isSessionActiveOnWeek(session: CourseSession, weekIndex: number): boolean {
  if (weekIndex < session.startWeek || weekIndex > session.endWeek) return false;
  if (session.parity === WeekParity.Odd) return weekIndex % 2 === 1;
  if (session.parity === WeekParity.Even) return weekIndex % 2 === 0;
  return true;
}

/** 这节课在指定日期上不上（星期 + 周次都要对上） */
export function sessionOccursOn(session: CourseSession, date: Date, term: Term): boolean {
  if (session.weekday !== date.getDay()) return false;
  const week = weekIndexOf(term, date);
  if (week == null) return false;
  return isSessionActiveOnWeek(session, week);
}

/** 某天的课（含时刻换算）；作息表里查不到节次的安排会被跳过（不静默画错位置） */
export function coursesOnDate(courses: readonly Course[], date: Date, term: Term): CourseSlot[] {
  const slots: CourseSlot[] = [];
  for (const course of courses) {
    if (course.deletedAt) continue;
    for (const session of course.sessions) {
      if (!sessionOccursOn(session, date, term)) continue;
      const span = periodSpan(term.periods, session.startPeriod, session.endPeriod);
      if (!span) continue;
      slots.push({ course, session, date, start: span.start, end: span.end });
    }
  }
  // 排序必须确定性：先按开始时刻，再按课程名（首字母/编码序）—— 同一时段的课不能随机换位
  return slots.sort(
    (a, b) => a.start - b.start || a.course.title.localeCompare(b.course.title, 'zh'),
  );
}

/** 一周的课表（7 天，周一打头），课表视图直接消费 */
export function weekGrid(
  courses: readonly Course[],
  weekStart: Date,
  term: Term,
): Array<{ date: Date; slots: CourseSlot[] }> {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset);
    return { date, slots: coursesOnDate(courses, date, term) };
  });
}

/**
 * "现在这节课，或者下一节课"。
 * 正在上的课优先（start ≤ now ≤ end），否则往后找 7 天内最近的一节。
 * 找不到返回 null —— 首页据此显示"今天没课"，而不是硬凑一条。
 */
export function nextCourse(
  courses: readonly Course[],
  term: Term,
  now: Date = new Date(),
): CourseSlot | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const slots = coursesOnDate(courses, date, term);
    for (const slot of slots) {
      if (offset === 0) {
        if (slot.end < nowMinutes) continue; // 已经下课
        return slot;
      }
      return slot;
    }
  }
  return null;
}

/** 这节课是"正在上"还是"还没到" */
export function describeSlotTiming(slot: CourseSlot, now: Date = new Date()): string {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const sameDay = toDayKey(slot.date) === toDayKey(now);
  if (sameDay && nowMinutes >= slot.start && nowMinutes <= slot.end) return '正在上';
  if (sameDay) return '今天';
  const diff = dayDiff(now, slot.date);
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${diff} 天后`;
}

/** '第 1-16 周' / '第 1-16 周（单）' */
export function describeWeeks(session: CourseSession, totalWeeks?: number): string {
  const sameWeek = session.startWeek === session.endWeek;
  const range = sameWeek ? `第 ${session.startWeek} 周` : `第 ${session.startWeek}-${session.endWeek} 周`;
  const parity =
    session.parity === WeekParity.Odd ? '（单）' : session.parity === WeekParity.Even ? '（双）' : '';
  if (!parity && totalWeeks && session.startWeek === 1 && session.endWeek >= totalWeeks) {
    return '全学期';
  }
  return `${range}${parity}`;
}

/** '第 3-4 节' / '第 5 节' */
export function describePeriods(session: CourseSession): string {
  return session.startPeriod === session.endPeriod
    ? `第 ${session.startPeriod} 节`
    : `第 ${session.startPeriod}-${session.endPeriod} 节`;
}

/** '周三 第 3-4 节 · 第 1-16 周（单）' */
export function describeSession(session: CourseSession, totalWeeks?: number): string {
  return `${weekdayLabel(session.weekday)} ${describePeriods(session)} · ${describeWeeks(session, totalWeeks)}`;
}

/** 一次完整描述：'周三 第 3-4 节 10:00–11:40 · 教一 101' */
export function describeSlot(slot: CourseSlot, periods: readonly ClassPeriod[]): string {
  const span = periodSpan(periods, slot.session.startPeriod, slot.session.endPeriod);
  const clock = span
    ? `${String(Math.floor(span.start / 60)).padStart(2, '0')}:${String(span.start % 60).padStart(2, '0')}–${String(Math.floor(span.end / 60)).padStart(2, '0')}:${String(span.end % 60).padStart(2, '0')}`
    : '';
  const place = slot.session.location ?? slot.course.location;
  return [describePeriods(slot.session), clock, place].filter(Boolean).join(' · ');
}

/**
 * 清理导入/手输来的安排：丢掉星期或节次非法的行，规整周次区间，
 * 并**按周几+节次排序**（保证同一门课的多次安排在界面上顺序稳定）。
 */
export function sanitizeSessions(input: readonly CourseSession[]): CourseSession[] {
  return input
    .filter(
      (s) =>
        Number.isInteger(s.weekday) &&
        s.weekday >= 0 &&
        s.weekday <= 6 &&
        s.startPeriod >= 1 &&
        s.endPeriod >= s.startPeriod &&
        s.startWeek >= 1 &&
        s.endWeek >= s.startWeek,
    )
    .map((s) => ({ ...s, location: s.location ?? null }))
    .sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod);
}

/** 这门课有没有"现在还在上"的安排（首页/日历高亮用） */
export function isCourseActiveNow(course: Course, term: Term, now: Date = new Date()): boolean {
  return coursesOnDate([course], now, term).some(
    (slot) => now.getHours() * 60 + now.getMinutes() >= slot.start && now.getHours() * 60 + now.getMinutes() <= slot.end,
  );
}
