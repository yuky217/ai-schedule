import { endOfDay, format, isSameDay, startOfDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';

/** 统一时间口径：实体里一律存 ISO 字符串，展示时才格式化 */

export const nowIso = (): string => new Date().toISOString();

export const toIso = (d: Date): string => d.toISOString();

export const toDate = (iso: string | null | undefined): Date | null =>
  iso ? new Date(iso) : null;

export const startOfDayIso = (d: Date = new Date()): string => startOfDay(d).toISOString();

export const endOfDayIso = (d: Date = new Date()): string => endOfDay(d).toISOString();

/** 是否落在同一天 */
export const isSameDayIso = (a: string | null | undefined, b: Date = new Date()): boolean => {
  const d = toDate(a);
  return d ? isSameDay(d, b) : false;
};

/** 偏移若干天的某个整点：atTimeOn(1, 9) = 明天 09:00 */
export const atTimeOn = (dayOffset: number, hours: number, minutes = 0): string => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

/** "10月5日 星期一"，中文长日期 */
export const formatDateLong = (d: Date = new Date()): string =>
  format(d, 'M月d日 EEEE', { locale: zhCN });

/** "10月5日" */
export const formatMonthDay = (d: Date = new Date()): string => format(d, 'M月d日');

export const formatTime = (iso: string | null | undefined): string =>
  iso ? format(new Date(iso), 'HH:mm') : '';

export const formatDayTime = (iso: string | null | undefined): string =>
  iso ? format(new Date(iso), 'M月d日 HH:mm') : '';

/**
 * 'YYYY-MM-DD' → 本地当天 00:00。
 * 刻意不用 `new Date('2026-10-06')`：那样会按 UTC 解析，东八区会偏移成前一天早上。
 */
export const parseDayKey = (key: string | null | undefined): Date | null => {
  if (!key) return null;
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key.trim());
  if (!matched) return null;
  const d = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Date → 'YYYY-MM-DD'（本地日） */
export const toDayKey = (d: Date): string => format(d, 'yyyy-MM-dd');

/** ISO 时间戳 → 'YYYY-MM-DD'（本地日）；无效则 null */
export const dayKeyOf = (iso: string | null | undefined): string | null => {
  const d = toDate(iso);
  return d ? toDayKey(d) : null;
};

/** 专注计时用：mm:ss 或 h:mm:ss */
export const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

/** 相对今天的自然语言："今天 / 明天 / 已过期 3 天" */
export const describeDue = (iso: string | null | undefined, now: Date = new Date()): string => {
  const d = toDate(iso);
  if (!d) return '';
  const dayDiff = Math.round(
    (startOfDay(d).getTime() - startOfDay(now).getTime()) / 864e5,
  );
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '明天';
  if (dayDiff === 2) return '后天';
  if (dayDiff === -1) return '昨天';
  if (dayDiff < 0) return `已过期 ${Math.abs(dayDiff)} 天`;
  return `${dayDiff} 天后`;
};
