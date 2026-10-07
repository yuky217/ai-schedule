/**
 * 课表文本解析 —— 把从教务系统复制/导出的文字变成课程草稿。
 *
 * 为什么要有这一层：教务系统的"导出"十有八九不给你标准格式
 * （有的是制表符表格，有的是带换行的卡片式，有的干脆只能全选复制）。
 * 与其祈祷某个固定格式，不如写一个**宽容**的解析器：
 *
 *   第一层：表头定角色。带表头（"课程名称 | 星期 | 节次 | 周次 | 教室 | 教师"）的
 *           一行式表格最可靠，按列的角色取值。
 *   第二层：内容兜底。没有表头、或者列对不上时，逐格猜这一格是星期/节次/周次/地点。
 *
 * 解析结果一律是**草稿**：界面必须先给用户看一眼、确认后再入库
 * （导入这件事绝不能"点一下就替用户写入 20 门课"）。
 *
 * 纯 TypeScript（可单测）。
 */

import { WeekParity, sanitizeSessions, type CourseSession } from './course';
import { parseClock } from './timetable';

export interface CourseDraft {
  title: string;
  teacher: string | null;
  location: string | null;
  sessions: CourseSession[];
  /** 需要用户核对的点（缺周次、缺节次、认不出教室…） */
  warnings: string[];
  /** 原始文本片段，界面折叠展示 */
  raw: string[];
}

export interface ParseResult {
  courses: CourseDraft[];
  /** 整段都读不出东西时的说明 */
  problems: string[];
}

export interface ParseOptions {
  /** 文本里没写周次时按这个补（默认整学期 1-18 周） */
  defaultWeeks?: { start: number; end: number };
  /** 文本里没写星期时按这个补（网格粘贴里常见：整列都是同一天） */
  fallbackWeekday?: number;
}

const DEFAULT_WEEKS = { start: 1, end: 18 } as const;

/** 全角 → 半角，顺便统一各种破折号与括号；解析前必须先过这一道 */
function normalize(text: string): string {
  return text
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .replace(/[–—－~～至]/g, '-')
    .replace(/\u00a0|\u3000/g, ' ');
}

const WEEKDAY_CHARS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

/** '周一' / '星期一' / '礼拜三' / '周7' → 0-6；认不出返回 null */
export function parseWeekdayToken(text: string): number | null {
  const matched = /(?:星期|周|礼拜)\s*([一二三四五六日天]|\d)/.exec(text);
  if (!matched) return null;
  const token = matched[1]!;
  if (/\d/.test(token)) {
    const n = Number(token);
    return n === 7 ? 0 : n >= 0 && n <= 6 ? n : null;
  }
  const value = WEEKDAY_CHARS[token];
  return value === undefined ? null : value;
}

/** 区间连接符的各种写法（全角/波浪/至）—— 直接调这些小解析器时也要认 */
const SEP = '[-~～–—－至]';

/** '第1-2节' / '1~2节' / '1,2节' / '第3节' */
export function parsePeriodSpan(text: string): { start: number; end: number } | null {
  const range =
    new RegExp(`(\\d{1,2})\\s*${SEP}\\s*(\\d{1,2})\\s*节`).exec(text) ??
    /(\d{1,2})\s*[,、]\s*(\d{1,2})\s*节/.exec(text);
  if (range) return { start: Number(range[1]), end: Number(range[2]) };
  const single = /(\d{1,2})\s*节/.exec(text);
  if (single) {
    const n = Number(single[1]);
    return { start: n, end: n };
  }
  return null;
}

/** '第1-16周(单)' / '1~8周' / '第5周' / '单周'（只有单双周时区间交给调用方补） */
export function parseWeekSpan(
  text: string,
  fallback: { start: number; end: number },
): { start: number; end: number; parity: WeekParity } | null {
  const parity: WeekParity = /单\s*周|\(\s*单\s*\)|单/.test(text)
    ? WeekParity.Odd
    : /双\s*周|\(\s*双\s*\)|双/.test(text)
      ? WeekParity.Even
      : WeekParity.All;
  const range = new RegExp(`(\\d{1,2})\\s*${SEP}\\s*(\\d{1,2})\\s*周`).exec(text);
  if (range) {
    return { start: Number(range[1]), end: Number(range[2]), parity };
  }
  const single = /(\d{1,2})\s*周/.exec(text);
  if (single) {
    const n = Number(single[1]);
    return { start: n, end: n, parity };
  }
  // 只写了"单周/双周"，没写区间 —— 用整学期兜住（用户可在预览里改）
  if (parity !== WeekParity.All) return { ...fallback, parity };
  return null;
}

/** '08:00-09:40' / '8:00~9:40' → 两个钟点（分钟） */
export function parseClockSpan(text: string): { start: number; end: number } | null {
  const matched = new RegExp(`(\\d{1,2}:\\d{2})\\s*${SEP}\\s*(\\d{1,2}:\\d{2})`).exec(text);
  if (!matched) return null;
  const start = parseClock(matched[1]!);
  const end = parseClock(matched[2]!);
  if (start == null || end == null) return null;
  return { start, end };
}

/** 看起来像教室的格子（"教一101 / 3号楼 / 体育馆 / 综实 A203 / 逸夫楼南203"） */
function looksLikeLocation(cell: string): boolean {
  if (!cell || cell.length > 16) return false;
  if (/节|周|星期|老师|教师/.test(cell)) return false;
  if (/(楼|室|馆|场|机房|实验|中心|校区|区|号|阶|楼栋)/.test(cell)) return true;
  // "教一101""A203""西12" 这类：汉字/字母 + 门牌号，且不带"节/周"等课表词
  return /^[\u4e00-\u9fa5A-Za-z]{1,6}[A-Za-z]?\d{2,4}$/.test(cell);
}

/** 看起来像"课程名单独一行"的格子（有字、无数字、不太长） */
function looksLikeTitleOnly(line: string): boolean {
  const text = line.trim();
  if (text.length < 2 || text.length > 20) return false;
  if (/\d/.test(text)) return false;
  if (/节|周|星期|礼拜|老师|教师|课程表|作息/.test(text)) return false;
  return /^[\u4e00-\u9fa5A-Za-z()（）·、\-—\s]+$/.test(text);
}

/** 明确写了教师的格子 */
function looksLikeTeacher(cell: string): boolean {
  return /(老师|教师|教授|讲师|助教)/.test(cell);
}

type ColumnRole = 'name' | 'weekday' | 'period' | 'week' | 'location' | 'teacher' | 'clock' | 'unknown';

/** 表头行 → 每列的角色。认不出表头就返回 null（走内容兜底） */
export function columnRoles(headerCells: readonly string[]): ColumnRole[] | null {
  const roles: ColumnRole[] = [];
  let hits = 0;
  for (const cell of headerCells) {
    const text = cell.replace(/\s/g, '');
    let role: ColumnRole = 'unknown';
    if (/课程名称|课程名|课程$|名称|科目/.test(text)) role = 'name';
    else if (/星期|周几|星期几/.test(text)) role = 'weekday';
    else if (/节次|节$|节数/.test(text)) role = 'period';
    else if (/周次|周数|起止周|上课周/.test(text)) role = 'week';
    else if (/教室|地点|上课地点|场地/.test(text)) role = 'location';
    else if (/^(教师|老师|任课教师|授课教师|教师姓名|任课老师)$/.test(text)) role = 'teacher';
    else if (/时间|时刻/.test(text)) role = 'clock';
    if (role !== 'unknown') hits += 1;
    roles.push(role);
  }
  // 至少认出一个有意义的角色，才算表头（否则宁可走兜底，别把数据行当表头吃掉）
  return hits >= 2 ? roles : null;
}

/** 把一行切成格子：优先制表符，其次连续 2 个以上空格 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  // 没有任何分隔记号、但一行里同时出现"星期 + 节次"：按单空格再切一次
  // （浏览器里全选复制常常把整行的多个格子压成单空格）
  if (/(?:星期|周|礼拜)/.test(line) && /节/.test(line)) {
    return line.split(/\s+/).map((c) => c.trim()).filter(Boolean);
  }
  return [line.trim()];
}

interface SessionCell {
  weekday: number | null;
  weekdayText: string | null;
  periods: { start: number; end: number } | null;
  weeks: { start: number; end: number; parity: WeekParity } | null;
  location: string | null;
  teacher: string | null;
  clock: { start: number; end: number } | null;
  name: string | null;
}

function emptyCell(): SessionCell {
  return {
    weekday: null, weekdayText: null, periods: null, weeks: null,
    location: null, teacher: null, clock: null, name: null,
  };
}

/**
 * 从一个没有列角色的格子里，把**所有**能认出来的东西一次抽出来。
 *
 * 为什么不能"一格只认一个字段"：教务系统里的格子经常是复合的
 * （"周一 1-2节 1-16周"挤在一格、"高等数学 教一101"挤在一格），
 * 只认第一个匹配项会把星期和节次丢掉一个 —— 踩过。
 */
function extractFromText(cell: string, out: SessionCell, leftovers: string[]): void {
  let matched = false;

  const weekday = parseWeekdayToken(cell);
  if (weekday != null) {
    out.weekday ??= weekday;
    out.weekdayText ??= cell;
    matched = true;
  }
  const periods = parsePeriodSpan(cell);
  if (periods) {
    out.periods ??= periods;
    matched = true;
  }
  const weeks = parseWeekSpan(cell, DEFAULT_WEEKS);
  if (weeks) {
    out.weeks ??= weeks;
    matched = true;
  }
  const clock = parseClockSpan(cell);
  if (clock) {
    out.clock ??= clock;
    matched = true;
  }
  if (looksLikeLocation(cell) && !out.location) {
    out.location = cell;
    return;
  }
  if (looksLikeTeacher(cell) && !out.teacher) {
    out.teacher = cell;
    return;
  }
  if (matched) {
    // 已知片段之外剩下的文字，才是课程名的候选（"高等数学 周一 1-2节" → "高等数学"）
    const residue = cell
      .replace(/(?:星期|周|礼拜)\s*[一二三四五六日天\d]/g, ' ')
      .replace(/\d{1,2}\s*-\s*\d{1,2}\s*[节周]([^ ]*)/g, ' ')
      .replace(/\d{1,2}\s*[节周]([^ ]*)/g, ' ')
      .replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, ' ')
      .trim();
    if (residue.length >= 2) leftovers.push(residue);
    return;
  }
  leftovers.push(cell);
}

/** 逐格分类：按列角色取，没有角色的格子走内容抽取 */
function classifyCells(cells: readonly string[], roles: readonly ColumnRole[] | null): SessionCell {
  const out = emptyCell();
  const leftovers: string[] = [];

  cells.forEach((cell, index) => {
    if (!cell) return;
    const role = roles?.[index] ?? 'unknown';
    switch (role) {
      case 'name':
        out.name ??= cell;
        return;
      case 'weekday': {
        const weekday = parseWeekdayToken(cell);
        if (weekday != null) {
          out.weekday = weekday;
          out.weekdayText = cell;
        } else leftovers.push(cell);
        return;
      }
      case 'period': {
        const periods = parsePeriodSpan(cell);
        if (periods) out.periods = periods;
        else leftovers.push(cell);
        return;
      }
      case 'week': {
        const weeks = parseWeekSpan(cell, DEFAULT_WEEKS);
        if (weeks) out.weeks = weeks;
        else leftovers.push(cell);
        return;
      }
      case 'clock': {
        const clock = parseClockSpan(cell);
        if (clock) out.clock = clock;
        else leftovers.push(cell);
        return;
      }
      case 'location':
        out.location ??= cell;
        return;
      case 'teacher':
        out.teacher ??= cell;
        return;
      default:
        extractFromText(cell, out, leftovers);
    }
  });

  // 剩下的格子：没有名字就拿它当课程名（**优先没有数字的那个** ——
  // "高等数学" 比 "教一101" 更像课程名），其余的并进地点/丢弃
  if (!out.name && leftovers.length) {
    const clean = leftovers.filter((c) => !/\d/.test(c));
    const pool = clean.length ? clean : leftovers;
    const candidate = [...pool].sort((a, b) => b.length - a.length)[0];
    if (candidate) {
      out.name = candidate;
      leftovers.splice(leftovers.indexOf(candidate), 1);
    }
  }
  if (!out.location && leftovers.length) {
    const place = leftovers.find((c) => looksLikeLocation(c));
    if (place) out.location = place;
  }
  return out;
}

/**
 * 主入口。
 * 策略：先按行切格子，逐行尝试（有表头就按表头角色，没有就按内容猜）；
 * 一行的"星期+节次"凑齐就算一次上课安排，按课程名合并。
 * 全都凑不齐时，退回"自由文本块"扫描（一行里带星期+节次的散句）。
 */
export function parseCourseText(text: string, options: ParseOptions = {}): ParseResult {
  const defaults = options.defaultWeeks ?? DEFAULT_WEEKS;
  const lines = normalize(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const problems: string[] = [];
  const byTitle = new Map<string, CourseDraft>();
  let roles: ColumnRole[] | null = null;
  let parsedAny = false;
  // 教务系统复制出来常常是"一行一个字段"：课程名、地点、教师各占一行。
  // 遇到这类行先记着，等下一行出现"星期+节次"时补上。
  let pendingTitle: string | null = null;
  let pendingLocation: string | null = null;
  let pendingTeacher: string | null = null;
  /** 最近一次成功解析出来的课程：后面的"光秃秃地点/教师"行归它（卡片式格式） */
  let lastDraft: CourseDraft | null = null;

  for (const line of lines) {
    const cells = splitCells(line);
    // 先判"这行像不像数据行"：含"周一"或"1-2节"这类**取值**的行，绝不是表头。
    // 否则 "高等数学 周一 1-2节 … 张三老师" 会因为结尾的"张三老师"命中"教师"
    // 被误判成表头，整行数据被静默吃掉（踩过）。
    const looksLikeData = /(?:星期|周|礼拜)\s*[一二三四五六日天\d]/.test(line) || /\d{1,2}\s*[节周]/.test(line);
    const headerRoles = looksLikeData ? null : columnRoles(cells);
    if (headerRoles) {
      roles = headerRoles;
      continue;
    }
    const info = classifyCells(cells, roles);
    // 缺星期的行：如果这一整块都在同一列（网格粘贴），用整列的星期兜底
    const weekday = info.weekday ?? options.fallbackWeekday ?? null;

    if (weekday == null || !info.periods) {
      // 只处理"整行就是一个字段"的情况（卡片式格式）；
      // 多格的表格行缺信号，说明这行本身不完整，直接跳过
      if (cells.length !== 1) continue;
      const text = line.trim();
      // 单格行可能是课程名，也可能是教室/教师 —— 按内容分派
      const candidate = info.name ?? text;
      if (looksLikeTitleOnly(candidate)) {
        // 新课程名出现 = 上一张卡片结束，清掉上一门留下的零碎
        pendingTitle = candidate;
        pendingLocation = null;
        pendingTeacher = null;
      } else if (looksLikeLocation(text)) {
        pendingLocation = text;
        // 卡片式："课程名 / 星期节次 / 教室 / 教师" —— 教室在节次之后出现，
        // 这时它属于**刚刚解析出来**的那门课，不是下一门
        if (lastDraft && !lastDraft.location) {
          lastDraft.location = text;
          lastDraft.sessions.forEach((s) => {
            if (!s.location) s.location = text;
          });
        }
      } else if (looksLikeTeacher(text)) {
        pendingTeacher = text;
        if (lastDraft && !lastDraft.teacher) lastDraft.teacher = text;
      }
      continue;
    }

    const weeks = info.weeks ?? { ...defaults, parity: WeekParity.All };
    const session: CourseSession = {
      weekday,
      startPeriod: info.periods.start,
      endPeriod: info.periods.end,
      startWeek: weeks.start,
      endWeek: weeks.end,
      parity: weeks.parity,
      location: info.location ?? pendingLocation,
    };
    const title = (info.name ?? pendingTitle ?? '').trim();
    const teacher = info.teacher ?? pendingTeacher;
    if (!title) {
      // 没有课程名：把整行当名字太长，退回"整行原文"作为名字并标记需核对
      const guess = cells.filter(Boolean).join(' ').slice(0, 40);
      if (!guess) continue;
      lastDraft = pushDraft(byTitle, guess, session, { ...info, teacher }, line, [
        '这一行没读到课程名，请核对',
      ]);
    } else {
      lastDraft = pushDraft(byTitle, title, session, { ...info, teacher }, line, []);
    }
    if (!info.weeks && !lastDraft.warnings.includes('没读到周次，按整学期处理')) {
      lastDraft.warnings.push('没读到周次，按整学期处理');
    }
    pendingTitle = null;
    pendingLocation = null;
    pendingTeacher = null;
    parsedAny = true;
  }

  if (!parsedAny) {
    // 兜底：整段里搜"周X … 第N-M节"的散句（有的教务系统复制出来是散文）
    for (const line of lines) {
      const weekday = parseWeekdayToken(line);
      const periods = parsePeriodSpan(line);
      if (weekday == null || !periods) continue;
      const weeks = parseWeekSpan(line, defaults) ?? { ...defaults, parity: WeekParity.All };
      const title = line
        .replace(/(?:星期|周|礼拜)\s*[一二三四五六日天\d]/g, '')
        .replace(/(\d{1,2}\s*-\s*\d{1,2}\s*周[^ ]*|\d{1,2}\s*周[^ ]*)/g, '')
        .replace(/(\d{1,2}\s*-\s*\d{1,2}\s*节|\d{1,2}\s*节)/g, '')
        .replace(/[\t|,，;；]+/g, ' ')
        .trim()
        .slice(0, 40);
      if (!title) continue;
      pushDraft(
        byTitle,
        title,
        {
          weekday,
          startPeriod: periods.start,
          endPeriod: periods.end,
          startWeek: weeks.start,
          endWeek: weeks.end,
          parity: weeks.parity,
          location: null,
        },
        emptyCell(),
        line,
        ['按散句解析，请核对节次与周次'],
      );
      parsedAny = true;
    }
  }

  if (!parsedAny) {
    problems.push('没从这段文字里读到任何"周几 + 第几节"的课程安排。');
    if (!lines.length) problems.push('粘贴的内容是空的。');
  }

  return { courses: [...byTitle.values()], problems };
}

/** 同名课程合并：session 去重（同星期同节次视为同一次），并把地点/教师补齐 */
function pushDraft(
  map: Map<string, CourseDraft>,
  title: string,
  session: CourseSession,
  info: SessionCell,
  rawLine: string,
  warnings: string[],
): CourseDraft {
  const key = title.trim();
  const existing = map.get(key);
  if (existing) {
    const duplicate = existing.sessions.some(
      (s) =>
        s.weekday === session.weekday &&
        s.startPeriod === session.startPeriod &&
        s.endPeriod === session.endPeriod,
    );
    if (!duplicate) existing.sessions.push(session);
    existing.sessions = sanitizeSessions(existing.sessions);
    if (!existing.location && session.location) existing.location = session.location;
    if (!existing.teacher && info.teacher) existing.teacher = info.teacher;
    if (rawLine && !existing.raw.includes(rawLine)) existing.raw.push(rawLine);
    for (const w of warnings) if (!existing.warnings.includes(w)) existing.warnings.push(w);
    return existing;
  }
  const draft: CourseDraft = {
    title: key,
    teacher: info.teacher ?? null,
    location: session.location ?? info.location ?? null,
    sessions: sanitizeSessions([session]),
    warnings: [...warnings],
    raw: rawLine ? [rawLine] : [],
  };
  map.set(key, draft);
  return draft;
}

/** 草稿 → 界面预览用的摘要（供测试与 UI 复用，避免两处各写一套描述） */
export function describeDraft(draft: CourseDraft, totalWeeks?: number): string {
  const parts = draft.sessions.map((s) => {
    const periodText =
      s.startPeriod === s.endPeriod ? `第${s.startPeriod}节` : `第${s.startPeriod}-${s.endPeriod}节`;
    const parity = s.parity === WeekParity.Odd ? '单' : s.parity === WeekParity.Even ? '双' : '';
    const weekText =
      s.startWeek === s.endWeek ? `第${s.startWeek}周` : `第${s.startWeek}-${s.endWeek}周`;
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][s.weekday] ?? '';
    return `周${weekday} ${periodText} ${weekText}${parity}`;
  });
  const suffix = totalWeeks ? `（共 ${totalWeeks} 周）` : '';
  return `${draft.title}：${parts.join('；')}${suffix}`;
}
