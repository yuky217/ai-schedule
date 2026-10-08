/**
 * 固定日程（考试）的提醒时刻。
 *
 * 为什么不复用任务的「提前 N 分钟」：任务是你自己排的事，提前量是个偏好，
 * 所以它有个可调字段；考试是学校定的、一学期就那么几场、忘掉一场的代价很大，
 * 该什么时候提醒有明确答案 —— 那就别把它做成一个要用户先想一遍的旋钮。
 *
 * 规则（定死）：
 * - **前一天 20:00** 响一次 —— 那是学生规划第二天的时刻，"明天 14:30 考高等数学
 *   · 教B216"，复习、证件、考场都还来得及安排。
 * - 这条排不上（导入时已经过了前一天 20:00，比如晚上十点才想起导入明天的考试）
 *   → 退到**开考前 1 小时**。宁可晚一点，也别一声不吭。
 * - 两个时刻都过去了（考试已经开始）→ 不排。马后炮不是提醒。
 *
 * 纯 TypeScript（可单测），不碰 RN / Expo / 数据库。真正的排程在
 * `entry/notifications.syncEventReminders`，它只信这里的时刻，不再自己算一遍 ——
 * 两份规则一旦分叉，界面说的和系统弹的就不是一回事了。
 */

import { describeEvent, describeEventTime, type CalEvent } from './event';

/** 前一天晚上几点提醒（本地时刻） */
export const EVENT_EVE_HOUR = 20;
/** 兜底提前量：开考前多少分钟 */
export const EVENT_SOON_LEAD_MINUTES = 60;

export interface EventFire {
  at: Date;
  /** true = 前一天晚上那次；false = 开考前 1 小时的兜底那次（正文措辞不同） */
  onEve: boolean;
}

/** 这场考试什么时候提醒；null = 不会响 */
export function eventFireAt(event: CalEvent, now: Date = new Date()): EventFire | null {
  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) return null;
  // 已经开始（或早就过去）的事不提醒 —— 与任务的"过点不补排"同一条规矩
  if (start.getTime() <= now.getTime()) return null;

  // 前一天 20:00。用 setDate/setHours 而不是减 24 小时：
  // 后者在夏令时切换那天会错一小时，前者永远是"前一天的晚上八点"。
  const eve = new Date(start);
  eve.setDate(eve.getDate() - 1);
  eve.setHours(EVENT_EVE_HOUR, 0, 0, 0);
  if (eve.getTime() > now.getTime()) return { at: eve, onEve: true };

  const soon = new Date(start.getTime() - EVENT_SOON_LEAD_MINUTES * 60_000);
  if (soon.getTime() > now.getTime()) return { at: soon, onEve: false };

  return null;
}

/**
 * 通知正文（标题用考试名）。
 * 前一天那次说"明天"，兜底那次说"开考" —— 用户扫一眼就知道是哪一种。
 */
export function describeEventFire(event: CalEvent, fire: EventFire): string {
  if (fire.onEve) return `明天 ${describeEvent(event)}`;
  const head = `${describeEventTime(event)} 开考`;
  return event.location ? `${head} · ${event.location}` : head;
}
