import { addDays, addMonths, startOfDay, startOfWeek } from 'date-fns';

import { RepeatFreq, TimeAttribute } from './enums';
import { describeRepeat } from './repeat-next';
import { timeAnchor, type RepeatRule, type TaskTime } from './task';

/**
 * 从一句话里识别时间与重复（"自动识别日程"的本地启发式实现）。
 *
 * "明天下午3点开会"   → 标题「开会」+ 固定时间明天 15:00
 * "每周五晚上7点健身" → 标题「健身」+ 重复每周五 + 下一个周五 19:00
 * "下个月10号前交合同" → 标题「交合同」+ 截止下月 10 号 23:59
 *
 * 设计原则：
 * - 纯函数、不依赖 React Native，方便单测；
 * - 这是能力层关闭时的降级方案，也是日常主力 —— 大多数场景不需要大模型；
 * - 识别不出的情况一律返回 null，上层自然落到收集箱，绝不瞎猜；
 * - **不猜，但也不丢**：拿不准的连"一半"都不认（见下面重复与日期的顺序说明）。
 *
 * 覆盖面参照滴答清单的"智能识别日期"（官方示例：周五下午3点开会 / 每月25号还信用卡 /
 * 下个月10号前完成合同 / 每周五晚上7点健身 / 今晚8点提醒吃药 / 明年6月1日）。
 * 它靠云端语义模型，我们靠本地正则 —— 所以只做**词形明确**的部分，
 * 语义含糊的（"过几天"、"月底"、"下下周内"）宁可不认。
 */

export interface ParsedSchedule {
  /** 去掉时间词与重复词后的正文 */
  title: string;
  /** 识别出的时间；null = 没识别到 */
  time: TaskTime | null;
  /** 识别出的重复；null = 没识别到 */
  repeat: RepeatRule | null;
  /** 人类可读的时间，如 "明天 15:00" */
  label: string | null;
  /** 人类可读的重复，如 "每周五" */
  repeatLabel: string | null;
  /** 命中的时间片段原文 */
  matched: string | null;
  /** 命中的重复片段原文 */
  repeatMatched: string | null;
}

/** 文本片段区间，用于把"重复"和"时间"两段从标题里一次切干净 */
interface Span {
  start: number;
  end: number;
}

const WEEKDAY_OF: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

const DAY_WORD = '(今天|今日|今晚|明晚|明天|明日|后天|大后天|(?:这|本)?周末)';
const WEEKDAY_WORD = '((?:下下?|本|这)?(?:周|星期|礼拜)[一二三四五六日天])';
const DATE_WORD =
  '(下下?个?月\\d{1,2}[日号]|本个?月\\d{1,2}[日号]|\\d{1,2}月\\d{1,2}[日号]|\\d{1,2}[日号])';
const DATE_EXPR = `(?:${DAY_WORD}|${WEEKDAY_WORD}|${DATE_WORD})`;
/**
 * 时刻。捕获组（相对整体 = base）：
 * base+1 整体 / base+2 时段词 / base+3 小时 / base+4 分或"半" / base+5 冒点时 / base+6 冒点分
 *
 * 数字与"点/分"之间允许空格：「早上 7 点」是贴备忘时最常见的写法。
 * 小时位**中文数字也算数**（"下午五点"）：一至十、十X、两，最多两个字
 * （2026-10-08 补，此前只认阿拉伯数字，"下午五点"会安静地落成"当天截止 23:59"）。
 */
const TIME_EXPR =
  '((凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*(\\d{1,2}|[一二两三四五六七八九十]{1,2})\\s*[点时]\\s*(半|(\\d{1,2})\\s*分?)?|(\\d{1,2}):(\\d{2}))';
const RANGE_SEP = '(?:到|至|~|～|—|–|-|——)';
/** 时段里第二段 TIME_EXPR 的整体组下标：第一段占 1..7，所以第二段整体是 8 */
const RANGE_END_BASE = 8;

export function parseSchedule(raw: string, now: Date = new Date()): ParsedSchedule {
  const text = raw.trim();
  if (!text) return empty('');

  /*
   * ① 先认重复，而且**在原文上认**。
   *
   * 「每周五」里含「周五」，如果先跑日期规则，「每周五晚上7点」会被读成
   * 「这周五晚上7点」—— 一次性的。这个错法最难受的地方是**看起来完全正常**：
   * 时间对、星期对，只是它再也不会在下周五出现。所以顺序不能反。
   */
  const rep = extractRepeat(text);

  /*
   * ② 时间同样在**原文**上认，而不是在"抠掉重复之后的残文"上认。
   *
   * 反例：「每周五前交报告」——重复片段是「每周五」、截止锚点是「周五前」，
   * 两段在原文里**重叠**。谁先抠谁，另一个就找不到了（先抠重复 → 剩「前交报告」，
   * 认不出日期，于是一条"每周五之前交"的任务变成了没有任何期限的重复任务）。
   * 所以两段各记各的区间，最后一起切。
   */
  const tm = parseTime(text, now);

  const spans = [...(rep?.spans ?? []), ...(tm?.spans ?? [])];
  const stripped = removeSpans(text, spans);
  const title = stripped || text;

  /*
   * ③ 重复里已经写明周几时，**第一期以它为准**。
   *
   * 「每周一三五跑步」里的「周一」只是列表的第一项，不代表第一期就在周一 ——
   * 用户等的是眼下最近的那一次。日期规则只会匹配到列表里的第一个「周X」，
   * 于是好端端一条"每周一三五"会显示成"下周一才开始"。同理「每周五」在
   * 今天正好是周五、而时刻已过时，也该顺延到下周而不是显示一个过去的时刻。
   */
  const aligned =
    rep?.repeat.freq === RepeatFreq.Weekly && rep.repeat.byWeekday?.length
      ? alignToWeekdays(tm?.time ?? null, rep.repeat.byWeekday, now)
      : (tm?.time ?? null);

  return {
    title,
    time: aligned,
    repeat: rep?.repeat ?? null,
    label: tm?.label ?? null,
    repeatLabel: rep?.label ?? null,
    matched: tm?.raw ?? null,
    repeatMatched: rep?.raw ?? null,
  };
}

function empty(text: string): ParsedSchedule {
  return {
    title: text,
    time: null,
    repeat: null,
    label: null,
    repeatLabel: null,
    matched: null,
    repeatMatched: null,
  };
}

/* ------------------------------------------------------------------ */
/* 重复                                                                */
/* ------------------------------------------------------------------ */

interface RepeatHit {
  repeat: RepeatRule;
  label: string;
  spans: Span[];
  raw: string;
}

/**
 * 认重复。**按"越具体越靠前"排**，命中一个就收工：
 * 「每周末」必须排在「每周」之前，否则"末"字不匹配周几字符类时会掉到「每周」兜底，
 * 把"每周末"读成"每周"（每周一次 vs 每周两次，差一倍）。
 *
 * 不做「每年」：`RepeatFreq` 里没有 yearly，而"每年"的场景（生日、年检、纪念日）
 * 主文档已经划给**纪念日**实体了（`marks.repeat_yearly`）。在这里造一个存不进
 * UI 的规则，就是"留了个没人能碰到的字段" —— 宁可少认一个，也不留半截能力。
 */
function extractRepeat(text: string): RepeatHit | null {
  const make = (rule: RepeatRule, matched: string, index: number): RepeatHit => ({
    repeat: rule,
    label: describeRepeat(rule),
    spans: [{ start: index, end: index + matched.length }],
    raw: matched,
  });

  /** 每个候选返回 RepeatRule 与命中的正则匹配；按顺序取第一个命中的 */
  const candidates: Array<() => { rule: RepeatRule; m: RegExpExecArray } | null> = [
    // 每周末 / 每个双休日 → 周六 + 周日
    () => {
      const m = /每(?:个)?(?:周末|双休日?)/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: [0, 6] }, m } : null;
    },
    // 工作日 / 每个工作日
    () => {
      const m = /(?:每(?:个)?)?工作日/.exec(text);
      return m
        ? { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: [1, 2, 3, 4, 5] }, m }
        : null;
    },
    // 每周一三五 / 每周一 / 每星期一
    () => {
      const re = new RegExp(`每(?:周|星期|礼拜)([一二三四五六日天]{1,7})`);
      const m = re.exec(text);
      if (!m) return null;
      const days = [
        ...new Set([...m[1]!].map((c) => WEEKDAY_OF[c]).filter((d): d is number => d != null)),
      ].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (!days.length) return null;
      return { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: days }, m };
    },
    // 每隔 2 天 / 每 3 周 / 每 2 个月
    () => {
      const m = /每(?:隔)?(\d{1,2}|[一二两三四五六七八九十])(?:\s*个)?(天|周|月)/.exec(text);
      if (!m) return null;
      const n = cnOrDigit(m[1]!);
      if (!n || n < 1 || n > 99) return null;
      const freq =
        m[2] === '天' ? RepeatFreq.Daily : m[2] === '周' ? RepeatFreq.Weekly : RepeatFreq.Monthly;
      return { rule: { freq, interval: n }, m };
    },
    // 每月25号
    () => {
      const m = /每(?:个)?月(\d{1,2})[日号]/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Monthly, interval: 1 }, m } : null;
    },
    // 每天 / 每日 / 每一天
    () => {
      const m = /每(?:一)?[天日]/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Daily, interval: 1 }, m } : null;
    },
    // 每周（不带周几）
    () => {
      const m = /每(?:周|星期|礼拜)/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Weekly, interval: 1 }, m } : null;
    },
    // 每月（不带日期）
    () => {
      const m = /每(?:个)?月/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Monthly, interval: 1 }, m } : null;
    },
  ];

  for (const candidate of candidates) {
    const hit = candidate();
    if (hit) return make(hit.rule, hit.m[0], hit.m.index);
  }
  return null;
}

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function cnOrDigit(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  return CN_NUM[s] ?? null;
}

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/* ------------------------------------------------------------------ */

interface TimeHit {
  time: TaskTime;
  label: string;
  spans: Span[];
  raw: string;
}

function spanOf(m: RegExpExecArray): Span {
  return { start: m.index, end: m.index + m[0].length };
}

function parseTime(text: string, now: Date): TimeHit | null {
  // ① 截止式："周五前交报告" / "明天下午3点前交" / "下个月10号前完成合同"
  const deadline = new RegExp(`${DATE_EXPR}\\s*(?:${TIME_EXPR}\\s*)?之?前`).exec(text);
  if (deadline) {
    const dateWord = deadline[1] ?? deadline[2] ?? deadline[3];
    const date = dateWord ? resolveDate(dateWord, now) : null;
    if (date) {
      const inner = new RegExp(TIME_EXPR).exec(deadline[0]);
      const hm = inner ? to24h(inner, 1) : null;
      const due = new Date(date);
      due.setHours(hm ? hm.hour : 23, hm ? hm.minute : 59, 0, 0);
      return {
        time: deadlineTime(due),
        label: `${dateLabel(date, now)}${hm ? ` ${clock(due)}` : ''}前`,
        spans: [spanOf(deadline)],
        raw: deadline[0],
      };
    }
  }

  // ② 相对时间："3小时后吃药" / "20分钟后" / "3天后交"（"两个小时后"的"两"也算）
  const rel = /(半|两|\d{1,2})\s*个?\s*小时后|(\d{1,3})\s*分钟后|(\d{1,2})\s*天后/.exec(text);
  if (rel) {
    const d = new Date(now.getTime());
    let label: string;
    if (rel[1]) {
      const hours = rel[1] === '两' ? 2 : Number(rel[1]);
      d.setMinutes(d.getMinutes() + (rel[1] === '半' ? 30 : hours * 60));
      label = rel[1] === '半' ? '半小时后' : `${hours} 小时后`;
    } else if (rel[2]) {
      d.setMinutes(d.getMinutes() + Number(rel[2]));
      label = `${rel[2]} 分钟后`;
    } else {
      d.setDate(d.getDate() + Number(rel[3]));
      label = `${rel[3]} 天后`;
    }
    return { time: fixedTime(d), label, spans: [spanOf(rel)], raw: rel[0] };
  }

  const dateMatch = new RegExp(DATE_EXPR).exec(text);
  const rangeMatch = execTime(new RegExp(`${TIME_EXPR}\\s*${RANGE_SEP}\\s*${TIME_EXPR}`), text);
  const timeMatch = rangeMatch ? null : execTime(new RegExp(TIME_EXPR), text);

  // ③ 日期 + 时刻 / 时段："明天下午3点开会" / "周三 14:00 复盘" / "明天2点到4点"
  if (dateMatch) {
    const date = resolveDate(pickGroup(dateMatch), now);
    if (date) {
      const daySpan = spanOf(dateMatch);

      if (rangeMatch) {
        const rawStart = to24h(rangeMatch, 1);
        const start = rawStart ? eveningShift(rawStart, pickGroup(dateMatch)) : null;
        const end = to24h(rangeMatch, RANGE_END_BASE);
        if (start && end) {
          const from = new Date(date);
          from.setHours(start.hour, start.minute, 0, 0);
          const to = new Date(date);
          const endMinutes = normalizeEnd(start, end);
          to.setHours(endMinutes.hour, endMinutes.minute, 0, 0);
          if (to.getTime() <= from.getTime()) to.setDate(to.getDate() + 1);
          return {
            time: {
              attribute: TimeAttribute.Fixed,
              startAt: from.toISOString(),
              endAt: to.toISOString(),
              dueAt: null,
            },
            label: `${dateLabel(date, now)} ${clock(from)}–${clock(to)}`,
            spans: [daySpan, spanOf(rangeMatch)],
            raw: `${dateMatch[0]}${rangeMatch[0]}`,
          };
        }
      }

      const rawHm = timeMatch ? to24h(timeMatch, 1) : null;
      const hm = rawHm ? eveningShift(rawHm, pickGroup(dateMatch)) : null;
      if (hm) {
        const d = new Date(date);
        d.setHours(hm.hour, hm.minute, 0, 0);
        return {
          time: fixedTime(d),
          label: `${dateLabel(date, now)} ${clock(d)}`,
          spans: [daySpan, ...(timeMatch ? [spanOf(timeMatch)] : [])],
          raw: `${dateMatch[0]}${timeMatch ? timeMatch[0] : ''}`,
        };
      }

      // 今晚 / 明晚 不带钟点 → 20:00
      if (/^(今晚|明晚)$/.test(pickGroup(dateMatch))) {
        const d = new Date(date);
        d.setHours(20, 0, 0, 0);
        return {
          time: fixedTime(d),
          label: `${dateLabel(date, now)} 20:00`,
          spans: [daySpan],
          raw: dateMatch[0],
        };
      }

      // 只有日期 → 截止到当天结束
      const due = new Date(date);
      due.setHours(23, 59, 0, 0);
      return {
        time: deadlineTime(due),
        label: `${dateLabel(date, now)} · 截止当天`,
        spans: [daySpan],
        raw: dateMatch[0],
      };
    }
  }

  // ④ 只有时段："下午2点到4点" → 今天/明天
  if (rangeMatch) {
    const start = to24h(rangeMatch, 1);
    const end = to24h(rangeMatch, RANGE_END_BASE);
    if (start && end) {
      const from = new Date(startOfDay(now));
      from.setHours(start.hour, start.minute, 0, 0);
      if (from.getTime() <= now.getTime()) from.setDate(from.getDate() + 1);
      const endMinutes = normalizeEnd(start, end);
      const to = new Date(from);
      to.setHours(endMinutes.hour, endMinutes.minute, 0, 0);
      if (to.getTime() <= from.getTime()) to.setDate(to.getDate() + 1);
      return {
        time: {
          attribute: TimeAttribute.Fixed,
          startAt: from.toISOString(),
          endAt: to.toISOString(),
          dueAt: null,
        },
        label: `${describeDay(from, now)} ${clock(from)}–${clock(to)}`,
        spans: [spanOf(rangeMatch)],
        raw: rangeMatch[0],
      };
    }
  }

  // ⑤ 只有时刻："晚上8点跑步" → 今天，过了就顺延到明天
  if (timeMatch) {
    const hm = to24h(timeMatch, 1);
    if (hm) {
      const d = new Date(startOfDay(now));
      d.setHours(hm.hour, hm.minute, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return {
        time: fixedTime(d),
        label: `${describeDay(d, now)} ${clock(d)}`,
        spans: [spanOf(timeMatch)],
        raw: timeMatch[0],
      };
    }
  }

  return null;
}

/**
 * 把时间锚点挪到"离现在最近的某个 byWeekday 那天"，时刻保留。
 *
 * 只在重复已经写明周几时调用 —— 那是用户亲口说的日子，比日期规则从
 * 「每周一三五」里匹配到的第一个「周一」可靠得多。挪不动的（没有锚点、
 * 或者两周内都找不到）原样返回，不硬凑。
 */
function alignToWeekdays(time: TaskTime | null, days: number[], now: Date): TaskTime | null {
  if (!time) return null;
  // 锚点只有一处出处（domain/task.ts），这儿不自己判 startAt/dueAt
  const iso = timeAnchor(time);
  if (!iso) return time;
  const src = new Date(iso);
  if (Number.isNaN(src.getTime())) return time;

  for (let offset = 0; offset < 14; offset += 1) {
    const d = addDays(startOfDay(now), offset);
    if (!days.includes(d.getDay())) continue;
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
    if (d.getTime() <= now.getTime()) continue;
    const nextIso = d.toISOString();
    return time.attribute === TimeAttribute.Deadline
      ? { ...time, dueAt: nextIso }
      : { ...time, startAt: nextIso };
  }
  return time;
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

/** 中文数字小时：「五」→5、「十二」→12、「十」→10、「两」→2；纯数字原样 */
function cnHour(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const map: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const ones = map[s[1]!];
    return ones != null ? 10 + ones : null;
  }
  const tens = map[s[0]!];
  if (tens == null) return null;
  if (s[1] === '十') return tens * 10;
  const ones = map[s[1]!];
  return ones != null ? tens * 10 + ones : tens;
}

/**
 * 在原文上找时刻，但**跳过「周X点」这种假时刻**。
 *
 * 中文数字进了小时位之后，"周五点外卖"里的「五点」会被读成下午五点 ——
 * 以前只认阿拉伯数字时这个误读不存在，所以闸必须一起加。命中后看一眼前
 * 一个字：是 周/期/礼/拜 且命中的开头是中文数字，就当作没看见，从下一格重试。
 */
function execTime(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    // 注意 `includes('')` 恒为 true —— 开头命中的（prev 为空串）绝不能跳
    const prev = m.index > 0 ? text[m.index - 1] : '';
    if (prev && '周星期礼拜'.includes(prev) && /^[一二两三四五六七八九十]/.test(m[0])) continue;
    return m;
  }
  return null;
}

/** DATE_EXPR 有三个捕获分支，取真正命中的那个 */
function pickGroup(m: RegExpExecArray): string {
  for (let i = m.length - 1; i >= 1; i--) {
    if (m[i] !== undefined) return m[i]!;
  }
  return m[0];
}

/**
 * 把若干区间从文本里切掉，**有重叠就合并**。
 * 「每周五前交报告」里「每周五」与「周五前」重叠，分开切会剩一堆碎字，
 * 合并成一段再切才能得到干净的「交报告」。
 */
function removeSpans(text: string, spans: Span[]): string {
  if (!spans.length) return cleanTitle(text);
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += `${text.slice(cursor, span.start)} `;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return cleanTitle(out);
}

function cleanTitle(text: string): string {
  return text
    .replace(/^这个\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。、,.；;：:的于在]+|[\s，。、,.；;：:的]+$/g, '')
    .trim();
}

/** 把中文日期词换算成具体某一天（当天 0 点） */
function resolveDate(word: string, now: Date): Date | null {
  const day0 = startOfDay(now);

  switch (word) {
    case '今天':
    case '今日':
    case '今晚':
      return day0;
    case '明天':
    case '明日':
    case '明晚':
      return addDays(day0, 1);
    case '后天':
      return addDays(day0, 2);
    case '大后天':
      return addDays(day0, 3);
  }

  // 周末 → 本周六（已经过了这周六就顺延到下周）
  if (/^(?:这|本)?周末$/.test(word)) {
    const monday = startOfWeek(day0, { weekStartsOn: 1 });
    const sat = addDays(monday, 5);
    return sat.getTime() < day0.getTime() ? addDays(sat, 7) : sat;
  }

  // 下周三 / 下下周五 / 周三 / 星期日 / 本周三
  const wd = word.match(/^(下下?|本|这)?(?:周|星期|礼拜)([一二三四五六日天])$/);
  if (wd) {
    const target = WEEKDAY_OF[wd[2]!]!;
    const monday = startOfWeek(day0, { weekStartsOn: 1 });
    const indexFromMonday = (target + 6) % 7;
    if (wd[1] === '下') return addDays(monday, 7 + indexFromMonday);
    if (wd[1] === '下下') return addDays(monday, 14 + indexFromMonday);
    // "周X" = 最近的一个（含今天，过了就算下周）
    let candidate = addDays(monday, indexFromMonday);
    if (candidate.getTime() < day0.getTime()) candidate = addDays(candidate, 7);
    return candidate;
  }

  // 下个月10号 / 本月25号
  const relativeMonth = word.match(/^(下下?|本)个?月(\d{1,2})[日号]$/);
  if (relativeMonth) {
    const offset = relativeMonth[1] === '下' ? 1 : relativeMonth[1] === '下下' ? 2 : 0;
    const base = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), offset);
    const day = Number(relativeMonth[2]);
    if (day < 1 || day > daysInMonth(base)) return null;
    return startOfDay(new Date(base.getFullYear(), base.getMonth(), day));
  }

  // 10月8日 / 8号 / 8日
  const md = word.match(/^(\d{1,2})月(\d{1,2})[日号]$/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12) return null;
    let d = new Date(now.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1) return null; // 2月30日 这种不存在的日期
    if (d.getTime() < day0.getTime()) d = new Date(now.getFullYear() + 1, month - 1, day);
    return startOfDay(d);
  }
  const dOnly = word.match(/^(\d{1,2})[日号]$/);
  if (dOnly) {
    const day = Number(dOnly[1]);
    if (day < 1 || day > daysInMonth(now)) return null;
    let d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d.getTime() < day0.getTime()) d = addMonths(d, 1);
    return startOfDay(d);
  }

  return null;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * 时段的结束时刻。
 * 「下午2点到4点」里第二段没带时段词，直接读会得到 4:00 —— 比开始还早。
 * 差在 12 小时以内时补一个下午，跨天（比如「晚上10点到凌晨2点」）不补。
 */
function normalizeEnd(
  start: { hour: number; minute: number },
  end: { hour: number; minute: number },
): { hour: number; minute: number } {
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (endMin > startMin) return end;
  if (endMin + 12 * 60 > startMin) return { hour: end.hour + 12, minute: end.minute };
  return end;
}

/**
 * 把时刻正则的某一组解析成 24 小时制。
 *
 * `base` = 该 TIME_EXPR 的**整体**捕获组下标（单独用时 1；时段里第二段是 8）。
 *
 * TIME_EXPR 有 **7** 个捕获组，不是 6 个 —— 分那一段是 `(半|(\d{1,2})分?)`，
 * 里面还嵌着一个数字组。按 6 个数会把"冒点时"读到"分的数字"上，
 * 结果是 `14:30` 这种写法**永远解析不出来**（老代码就是这么错的，且没人发现，
 * 因为"明天 14:30 复盘"会安静地退化成"明天截止"）。
 *   整体 / 时段词 / 小时 / 分或半 / 分的数字 / 冒点时 / 冒点分
 */
function to24h(m: RegExpExecArray, base: number): { hour: number; minute: number } | null {
  const colonHour = m[base + 5];
  const colonMinute = m[base + 6];
  if (colonHour !== undefined && colonMinute !== undefined) {
    const hour = Number(colonHour);
    const minute = Number(colonMinute);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  const hourRaw = cnHour(m[base + 2] ?? '');
  if (hourRaw == null || hourRaw > 24) return null;
  const minutePart = m[base + 3];
  const minute = minutePart === '半' ? 30 : minutePart ? Number(minutePart) : 0;
  if (minute > 59) return null;
  const period = m[base + 1]?.trim();
  let hour = hourRaw;
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
    if (hour < 12) hour += 12;
  } else if (period === '中午') {
    if (hour < 6) hour += 12;
  }
  if (hour > 23) hour -= 24; // "晚上12点" 视作 0 点
  return { hour, minute };
}

/**
 * 「今晚 / 明晚」自己就带着"晚上"这层意思 —— 所以「今晚8点」是 20:00，不是早上 8 点。
 *
 * 这层意思来自**日期词**而不是时刻词，所以 to24h 看不见它（「8点」单独看没有歧义，
 * 就是这个歧义让「今晚8点提醒吃药」被排到了当天早上）。
 * 只在 1–11 点补半天：12 点以上本来就是晚上，硬补会翻到第二天去。
 */
function eveningShift(
  hm: { hour: number; minute: number },
  dateWord: string | undefined,
): { hour: number; minute: number } {
  if (!dateWord || !/^(今晚|明晚)$/.test(dateWord)) return hm;
  if (hm.hour >= 1 && hm.hour < 12) return { hour: hm.hour + 12, minute: hm.minute };
  return hm;
}

function fixedTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Fixed, startAt: d.toISOString(), endAt: null, dueAt: null };
}

function deadlineTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: d.toISOString() };
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

function dateLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 864e5);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY_ZH[d.getDay()]}`;
}

function describeDay(d: Date, now: Date): string {
  return startOfDay(d).getTime() === startOfDay(now).getTime() ? '今天' : '明天';
}

function clock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
