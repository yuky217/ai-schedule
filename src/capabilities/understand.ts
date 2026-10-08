import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { RepeatFreq, TimeAttribute } from '@/domain/enums';
import type { ParsedSchedule } from '@/domain/parse-schedule';
import { describeReminder } from '@/domain/repeat-next';
import { normalizeTaskTime, timeAnchor, type RepeatRule, type TaskTime } from '@/domain/task';

import type { CapabilitySpec } from './types';

/**
 * 能力「理解」（主文档 3.1 Understand）：一段自然语言 → 结构化日程。
 *
 * **它是第一个接了真实模型的能力**（2026-10-08），因为这里是本地正则最吃力、
 * 而模型最占便宜的地方：正则只认"词形明确"的时间（见 parse-schedule 的取舍），
 * 而真实的输入是"下周三下午的会改到周五了，提前半小时叫我"这种句子。
 *
 * 三条设计上的硬约束：
 *
 * 1. **只做理解，不做决定。** 输出结构与本地解析器 `ParsedSchedule` **完全同构**，
 *    于是下游（quickCapture、resolveReminderMinutes、分流规则）一行都不用改 ——
 *    谁来解析是同一件事，谁都不许绕开既有口径。
 * 2. **不合格就整体作废**（`parse` 返回 null）。少字段、时间不成形、没有名字，
 *    一律退回本地识别 —— 一条被理解错的日程，用户看不出来是错的。
 * 3. **不猜。** 提示词里明说看不出来就填 null。宁可少识别一个时间，
 *    也不能替用户编一个他没说的时间。
 */

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 与 parse-schedule 的 TITLE_MAX 对齐：收集箱一行放得下 */
const TITLE_MAX = 40;

/** 提前量的合理上限：一周。超过它的"提前量"多半是模型在自由发挥 */
const REMINDER_MAX_MINUTES = 7 * 24 * 60;

export const understandSpec: CapabilitySpec<ParsedSchedule> = {
  system: (now) => `你是一个中文日程解析器。用户会给你一段话（可能是一句随口的话，也可能是粘来的一整段通知），你要抽取其中的日程信息。

现在是 ${format(now, 'yyyy-MM-dd HH:mm')}（周${WEEKDAY_ZH[now.getDay()]}）。

只输出一个 JSON 对象，不要输出解释、不要用 markdown 代码块。字段如下：
{
  "title": "这件事的名字。粘一整段通知时取它真正的那一行标题，不要带时间、地点、'关于…的通知'这类外壳。不超过 20 字",
  "timeKind": "fixed | deadline | none",
  "startAt": "本地时间，形如 2026-10-08T15:00。timeKind=fixed 时必填，其余为 null",
  "endAt": "结束时间，没有就 null",
  "dueAt": "截止时间。timeKind=deadline 时必填，其余为 null",
  "timeLabel": "这个时间的自然说法，如「明天 15:00」「10月14日 19:00」；没有时间就 null",
  "location": "地点；没提到就 null",
  "repeat": "null，或 {\"freq\":\"daily|weekly|monthly\",\"interval\":1,\"byWeekday\":[1,3,5]}",
  "reminderSpecified": "布尔。用户明确要求提醒（说了「提醒我」「叫我」「别让我忘」）才是 true",
  "reminderMinutes": "提前几分钟。用户说了具体时长就给数字（提前半小时=30，准点=0）；只说提醒没说多久就给 null",
  "note": "与这件事有关的其它信息（要求、注意事项、要带什么）；没有就 null"
}

规则：
- 相对时间一律换算成具体日期：今天、明天、后天、周五、下周三、三天后。
- oneTime 与截止要分清：「周三 14:00 开会」是 fixed；「周三前交材料」是 deadline。
- **不猜**：看不出来的字段一律填 null，不要编造时间或地点。
- 只输出 JSON。`,
  user: (text) => text,
  parse: (raw, ctx) => parseUnderstood(raw, ctx.now),
};

/**
 * 把模型返回的 JSON 校验、映射成与本地解析器同构的结构。
 * 返回 null = 这份结果不能用（调用方退回本地识别）。
 */
export function parseUnderstood(raw: unknown, now: Date): ParsedSchedule | null {
  if (typeof raw !== 'object' || raw == null) return null;
  const obj = raw as Record<string, unknown>;

  const title = readTitle(obj);
  if (!title) return null;

  const time = readTime(obj);
  // 说了"是某个时刻的事"却给不出合法时间 —— 说明它没理解对，整份作废
  if (!time.ok) return null;
  // 说了有属性却一个锚点都没填 → 按"没时间"算（与读写库的同一条口径）
  const normalized = time.time ? normalizeTaskTime(time.time) : null;
  const finalTime = normalized && normalized.attribute !== TimeAttribute.None ? normalized : null;

  const location = readOptionalString(obj.location);
  const reminder = readReminder(obj);

  return {
    title: title.text,
    note: mergeNote(title.overflow, readOptionalString(obj.note)),
    time: finalTime,
    location,
    // 命中的"原文片段"只有本地正则才知道（它靠区间切标题）——
    // 模型给的是结构化结果，这几个展示字段一律为 null，不假装知道
    locationMatched: null,
    repeat: readRepeat(obj.repeat),
    reminder: reminder.reminder,
    reminderUnspecified: reminder.reminderUnspecified,
    reminderLabel: reminder.reminderLabel,
    reminderMatched: null,
    label: readLabel(obj, finalTime, now),
    repeatLabel: null,
    matched: null,
    repeatMatched: null,
  };
}

/** 标题：必填。超长截断，**截掉的部分不丢**，进备注 */
function readTitle(obj: Record<string, unknown>): { text: string; overflow: string | null } | null {
  const raw = readOptionalString(obj.title);
  if (!raw) return null;
  const text = raw.slice(0, TITLE_MAX);
  return { text, overflow: raw.length > TITLE_MAX ? raw : null };
}

/** 备注：模型给的 + 标题截断掉的部分，都不丢 */
function mergeNote(overflow: string | null, note: string | null): string | null {
  const parts = [overflow, note].filter((part): part is string => Boolean(part));
  if (!parts.length) return null;
  return [...new Set(parts)].join('\n');
}

/**
 * 时间的读法 —— 三种结局，不是两种：
 * - `ok: true, time: null`：这件事确实没有时间（timeKind=none），**正常**；
 * - `ok: true, time: {…}`：读到了完整的时间；
 * - `ok: false`：**说了是"某时刻的事"却给不出合法时间**（"startAt": "下周随便吧"）。
 *   这不是"没时间"，是没理解对 —— 整份结果作废，退回本地识别。
 *   区分开这两种很要紧：把前者当异常会让"记一件待办"也要退回本地，
 *   把后者当正常则会静默把一条该有时间的日程变成无时间任务。
 */
type TimeRead = { ok: true; time: TaskTime | null } | { ok: false };

/** 时间。**只认模型给的"本地墙钟时间"**（`2026-10-08T15:00`）。
 * 顺手剥掉它可能自作主张加上的时区标记（Z / +08:00）—— 它想表达的
 * 本来就是当地时间，按字面读数比按 UTC 换算更接近它的意思。
 */
function readTime(obj: Record<string, unknown>): TimeRead {
  const kind = obj.timeKind;

  if (kind === 'none') return { ok: true, time: null };

  const wantsFixed = kind === 'fixed' || (kind === undefined && obj.startAt != null);
  const wantsDeadline = kind === 'deadline' || (kind === undefined && obj.dueAt != null);

  if (wantsFixed) {
    const start = parseLocalTime(obj.startAt);
    if (!start) return { ok: false };
    const end = parseLocalTime(obj.endAt);
    return {
      ok: true,
      time: {
        attribute: TimeAttribute.Fixed,
        startAt: start.toISOString(),
        endAt: end ? end.toISOString() : null,
        dueAt: null,
      },
    };
  }

  if (wantsDeadline) {
    const due = parseLocalTime(obj.dueAt);
    if (!due) return { ok: false };
    return {
      ok: true,
      time: {
        attribute: TimeAttribute.Deadline,
        startAt: null,
        endAt: null,
        dueAt: due.toISOString(),
      },
    };
  }

  // 没给 timeKind、也没给任何时间字段 —— 当作没时间（不猜）
  return { ok: true, time: null };
}

const LOCAL_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/;

/** `2026-10-08T15:00` → 本地时间。形不成合法日期就返回 null（不猜） */
function parseLocalTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const stripped = value.trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '');
  const m = LOCAL_TIME.exec(stripped);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), 0, 0);
  // 2 月 30 日这类不存在的日期会被 Date 悄悄顺延 —— 这里必须挡住
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

function readRepeat(value: unknown): RepeatRule | null {
  if (typeof value !== 'object' || value == null) return null;
  const obj = value as Record<string, unknown>;

  const freq =
    obj.freq === 'daily'
      ? RepeatFreq.Daily
      : obj.freq === 'weekly'
        ? RepeatFreq.Weekly
        : obj.freq === 'monthly'
          ? RepeatFreq.Monthly
          : null;
  if (!freq) return null;

  const rawInterval = typeof obj.interval === 'number' ? Math.round(obj.interval) : 1;
  const interval = rawInterval >= 1 && rawInterval <= 99 ? rawInterval : 1;

  if (freq !== RepeatFreq.Weekly) return { freq, interval };
  const weekdays = Array.isArray(obj.byWeekday)
    ? [...new Set(obj.byWeekday.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6))].sort(
        (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
      )
    : [];
  return weekdays.length ? { freq, interval, byWeekday: weekdays } : { freq, interval };
}

/** 提醒：与本地解析同构的四个字段（"写明了量" / "提了没给量" / "没提"） */
function readReminder(obj: Record<string, unknown>): Pick<
  ParsedSchedule,
  'reminder' | 'reminderUnspecified' | 'reminderLabel'
> {
  if (obj.reminderSpecified !== true) {
    return { reminder: null, reminderUnspecified: false, reminderLabel: null };
  }
  const raw = obj.reminderMinutes;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= REMINDER_MAX_MINUTES) {
    const minutes = Math.round(raw);
    return { reminder: minutes, reminderUnspecified: false, reminderLabel: describeReminder(minutes) };
  }
  // 提了提醒但没说多久 —— 由 domain/reminder 按事情类型给默认值
  return { reminder: null, reminderUnspecified: true, reminderLabel: '提醒' };
}

function readLabel(obj: Record<string, unknown>, time: TaskTime | null, now: Date): string | null {
  const given = readOptionalString(obj.timeLabel);
  if (given) return given;
  if (!time) return null;
  const iso = timeAnchor(time);
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  // 与本地识别同一口径：今天/明天/后天优先，再远就写日期
  const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day0(at) - day0(now)) / 86_400_000);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return `今天 ${clock}`;
  if (diff === 1) return `明天 ${clock}`;
  if (diff === 2) return `后天 ${clock}`;
  return format(at, 'M月d日 HH:mm', { locale: zhCN });
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
}
