/**
 * 固定日程（考试这类"到点发生"的事）—— 与"任务"并列的独立实体。
 *
 * 为什么不把考试塞进任务表：
 * 1. 考试没有"完成态"。考完不需要被勾掉 —— 界面上"完成的考试"只会让人疑惑
 *    （它还该出现在日历的那天吗？）。它只是"那一天那个时段有这件事"。
 * 2. 考试不参与专注、待办、完成率这些任务口径。硬塞进去，回顾页就得
 *    到处写"排除考试"的补丁。
 * 3. 数据来源不同：考试从教务系统整批导入（自带时间与地点），任务是逐条记的。
 *
 * 纪念日目前仍在 marks 表：它是"倒数几天的标记"（不带时刻、不进时间轴），
 * 语义与这里的"带时刻的固定日程"不同，将来真要统一再做迁移，不急。
 *
 * 纯 TypeScript（可单测），不依赖 RN / Expo。
 */

import type { BaseEntity } from './base';
import { isoAtMinutes } from '@/utils/datetime';

export const EventKind = {
  /** 考试（教务系统导入） */
  Exam: 'exam',
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface CalEvent extends BaseEntity {
  kind: string;
  title: string;
  location: string | null;
  note: string | null;
  /** ISO 时刻（本地时间对应的 UTC ISO 串，与任务的时间同格式） */
  startAt: string;
  /** null = 不带结束时刻（少见；教务数据总有结束时间） */
  endAt: string | null;
  /** 'exam-import' = 教务系统整批导入；'manual' = 手动建 */
  source: string;
}

/** 同一本地日的 key（yyyy-MM-dd） */
const dayKeyOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 那一天有哪些固定日程，按开始时刻排（同刻按标题，保证顺序稳定） */
export function eventsOnDay(events: readonly CalEvent[], date: Date): CalEvent[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return events
    .filter((event) => !event.deletedAt && dayKeyOf(event.startAt) === key)
    .sort(
      (a, b) =>
        a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title, 'zh'),
    );
}

/** '14:30–16:30'；没有结束时刻就只给开始 */
export function describeEventTime(event: CalEvent): string {
  const clock = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return event.endAt ? `${clock(event.startAt)}–${clock(event.endAt)}` : clock(event.startAt);
}

/** '14:30–16:30 · 教B216' —— 日视图考试行与导入预览共用这一份口径 */
export function describeEvent(event: CalEvent): string {
  return [describeEventTime(event), event.location].filter(Boolean).join(' · ');
}

/**
 * 某天 + 起止分钟 → 这场考试的起止时刻（手动加一场考试时用）。
 *
 * 与日程的 `schedule-presets.buildSpanTime` 共用同一个换算（`isoAtMinutes`）：
 * "手动加一场考试"和"在日历上拖出一段日程"在"某天几点到几点"这件事上
 * 没有第二种算法 —— 各写一份的话，考试与日程的日子迟早会差一天。
 *
 * 结束不晚于开始返回 null（界面已经拦住，这里是最后一道）。
 */
export function buildEventSpan(
  date: Date,
  startMinutes: number,
  endMinutes: number,
): { startAt: string; endAt: string } | null {
  if (Number.isNaN(date.getTime())) return null;
  if (Math.round(endMinutes) <= Math.round(startMinutes)) return null;
  return {
    startAt: isoAtMinutes(date, startMinutes),
    endAt: isoAtMinutes(date, endMinutes),
  };
}
