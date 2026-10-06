import { addDays, startOfDay, startOfWeek } from 'date-fns';

import { TimeAttribute } from './enums';
import type { TaskTime } from './task';

/**
 * 从一句话里识别时间（"自动识别日程"的本地启发式实现）。
 *
 * "明天下午3点开会" → 标题「开会」+ 固定时间明天 15:00
 * "周五前交报告"    → 标题「交报告」+ 截止周五 23:59
 *
 * 设计原则：
 * - 纯函数、不依赖 React Native，方便单测；
 * - 这是能力层关闭时的降级方案，也是日常主力 —— 大多数场景不需要大模型；
 * - 识别不出的情况一律返回 time: null，上层自然落到收集箱，绝不瞎猜。
 */

export interface ParsedSchedule {
  /** 去掉时间词后的正文 */
  title: string;
  /** 识别出的时间；null = 没识别到 */
  time: TaskTime | null;
  /** 命中的原始片段，如 "明天下午3点" */
  matched: string | null;
  /** 人类可读的识别结果，如 "明天 15:00"，用于输入框下方的提示 */
  label: string | null;
}

const WEEKDAY_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

const DAY_WORD = '(今天|今晚|明晚|明天|后天|大后天)';
const WEEKDAY_WORD = '((?:下下?)?(?:周|星期)[一二三四五六日天])';
const DATE_WORD = '(\\d{1,2}月\\d{1,2}[日号]|\\d{1,2}[日号])';
const DATE_EXPR = `(?:${DAY_WORD}|${WEEKDAY_WORD}|${DATE_WORD})`;
const TIME_EXPR =
  '((上午|早上|清晨|中午|下午|傍晚|晚上|夜里)?\\s*(\\d{1,2})[点时](?:半|(\\d{1,2})分?)?|(\\d{1,2}):(\\d{2}))';

export function parseSchedule(raw: string, now: Date = new Date()): ParsedSchedule {
  const text = raw.trim();
  const miss = (): ParsedSchedule => ({ title: text, time: null, matched: null, label: null });
  if (!text) return miss();

  // ① 截止式："周五前交报告" / "明天下午3点前交" / "10月8日前"
  const deadline = new RegExp(`${DATE_EXPR}\\s*(?:${TIME_EXPR}\\s*)?之?前`).exec(text);
  if (deadline) {
    const dateWord = deadline[1] ?? deadline[2] ?? deadline[3];
    const date = dateWord ? resolveDate(dateWord, now) : null;
    if (date) {
      const timeInMatch = new RegExp(TIME_EXPR).exec(deadline[0]);
      const hm = timeInMatch ? to24h(timeInMatch) : null;
      const due = new Date(date);
      due.setHours(hm ? hm.hour : 23, hm ? hm.minute : 59, 0, 0);
      const title = stripWords(text, [deadline[0]]);
      return {
        title: title || text,
        time: deadlineTime(due),
        matched: deadline[0],
        label: `${dateLabel(date)}${hm ? ` ${hmLabel(due)}` : ''}前`,
      };
    }
  }

  // ② 相对时间："3小时后吃药" / "半小时后" / "20分钟后"
  const rel = /(半|\d{1,2})个?小时后|(\d{1,3})分钟后/.exec(text);
  if (rel) {
    const d = new Date(now.getTime());
    if (rel[1]) d.setMinutes(d.getMinutes() + (rel[1] === '半' ? 30 : Number(rel[1]) * 60));
    else d.setMinutes(d.getMinutes() + Number(rel[2]));
    const title = stripWords(text, [rel[0]]);
    return {
      title: title || text,
      time: fixedTime(d),
      matched: rel[0],
      label: rel[1] ? `${rel[1] === '半' ? '半' : rel[1]}小时后` : `${rel[2]}分钟后`,
    };
  }

  // ③ 日期 + 时刻："明天下午3点开会" / "10月8日 14:00 复盘"
  const dateMatch = new RegExp(DATE_EXPR).exec(text);
  const timeMatch = new RegExp(TIME_EXPR).exec(text);

  if (dateMatch) {
    const date = resolveDate(pickGroup(dateMatch), now);
    if (date) {
      const hm = timeMatch ? to24h(timeMatch) : null;
      const title = stripWords(text, [dateMatch[0], timeMatch?.[0]]);
      if (hm) {
        const d = new Date(date);
        d.setHours(hm.hour, hm.minute, 0, 0);
        return {
          title: title || text,
          time: fixedTime(d),
          matched: `${dateMatch[0]}${timeMatch ? timeMatch[0] : ''}`.trim(),
          label: `${dateLabel(date)} ${hmLabel(d)}`,
        };
      }
      // 今晚 / 明晚 不带钟点 → 默认 20:00
      const evening = /^(今晚|明晚)$/.test(pickGroup(dateMatch));
      if (evening) {
        const d = new Date(date);
        d.setHours(20, 0, 0, 0);
        return {
          title: title || text,
          time: fixedTime(d),
          matched: dateMatch[0],
          label: `${dateLabel(date)} 20:00`,
        };
      }
      return {
        title: title || text,
        time: deadlineTime(new Date(date.setHours(23, 59, 0, 0))),
        matched: dateMatch[0],
        label: `${dateLabel(date)} · 截止当天`,
      };
    }
  }

  // ④ 只有时刻："晚上8点跑步" → 今天，过了就顺延到明天
  if (timeMatch) {
    const hm = to24h(timeMatch);
    if (hm) {
      const d = startOfDay(now);
      d.setHours(hm.hour, hm.minute, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      const title = stripWords(text, [timeMatch[0]]);
      return {
        title: title || text,
        time: fixedTime(d),
        matched: timeMatch[0],
        label: `${describeDay(d, now)} ${hmLabel(d)}`,
      };
    }
  }

  return miss();
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

/** DATE_EXPR 有三个捕获分支，取真正命中的那个 */
function pickGroup(m: RegExpExecArray): string {
  for (let i = m.length - 1; i >= 1; i--) {
    if (m[i] !== undefined) return m[i];
  }
  return m[0];
}

function stripWords(text: string, words: Array<string | undefined>): string {
  let out = text;
  for (const w of words) {
    if (w) out = out.replace(w, ' ');
  }
  return out
    .replace(/^这个\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。、,.；;：:的]+|[\s，。、,.；;：:]+$/g, '')
    .trim();
}

/** 把中文日期词换算成具体某一天（当天 0 点） */
function resolveDate(word: string, now: Date): Date | null {  const day0 = startOfDay(now);

  switch (word) {
    case '今天':
    case '今晚':
      return day0;
    case '明天':
    case '明晚':
      return addDays(day0, 1);
    case '后天':
      return addDays(day0, 2);
    case '大后天':
      return addDays(day0, 3);
  }

  // 下周三 / 下下周五 / 周三 / 星期日
  const wd = word.match(/^(下下?)?(?:周|星期)([一二三四五六日天])$/);
  if (wd) {
    const target = WEEKDAY_NUM[wd[2]];
    const monday = startOfWeek(day0, { weekStartsOn: 1 });
    const indexFromMonday = (target + 6) % 7;
    if (wd[1]) {
      // "下周X" = 下一周的同一天
      const weeksAhead = wd[1] === '下' ? 1 : 2;
      return addDays(monday, weeksAhead * 7 + indexFromMonday);
    }
    // "周X" = 最近的一个（含今天，过了就算下周）
    let candidate = addDays(monday, indexFromMonday);
    if (candidate.getTime() < day0.getTime()) candidate = addDays(candidate, 7);
    return candidate;
  }

  // 10月8日 / 8号 / 8日
  const md = word.match(/^(\d{1,2})月(\d{1,2})[日号]$/);
  if (md) {
    const d = new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]));
    if (d.getTime() < day0.getTime()) d.setFullYear(d.getFullYear() + 1);
    return startOfDay(d);
  }
  const dOnly = word.match(/^(\d{1,2})[日号]$/);
  if (dOnly) {
    const d = new Date(now.getFullYear(), now.getMonth(), Number(dOnly[1]));
    if (d.getTime() < day0.getTime()) d.setMonth(d.getMonth() + 1);
    return startOfDay(d);
  }

  return null;
}

/** "下午3点 / 中午12点半 / 14:30" → 24 小时制。
 *  TIME_EXPR 的分组：1=整体 2=时段词 3=小时 4=分/半 5=冒点时 6=冒点分 */
function to24h(m: RegExpExecArray): { hour: number; minute: number } | null {
  if (m[5] !== undefined && m[6] !== undefined) {
    const hour = Number(m[5]);
    const minute = Number(m[6]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  const hourRaw = Number(m[3]);
  if (Number.isNaN(hourRaw) || hourRaw > 24) return null;
  const minute = m[4] === '半' ? 30 : m[4] ? Number(m[4]) : 0;
  const period = m[2]?.trim();
  let hour = hourRaw;
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
    if (hour < 12) hour += 12;
  } else if (period === '中午') {
    if (hour < 6) hour += 12;
  }
  if (hour > 23) hour -= 24; // "晚上12点" 视作 0 点
  return { hour, minute };
}

function fixedTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Fixed, startAt: d.toISOString(), endAt: null, dueAt: null };
}

function deadlineTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: d.toISOString() };
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

function dateLabel(d: Date): string {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 864e5);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY_ZH[d.getDay()]}`;
}

function describeDay(d: Date, now: Date): string {
  return startOfDay(d).getTime() === startOfDay(now).getTime() ? '今天' : '明天';
}

function hmLabel(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
