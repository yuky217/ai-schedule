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

import {
  WeekParity,
  describeWeeks,
  sanitizeSessions,
  weeksFromRange,
  type CourseSession,
} from './course';
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

/** 导入预览里最常出现的那句提示，写成常量免得三处文案不一致 */
const WEEKS_NOT_READ = '没读到周次，按整学期处理';

/** 这门课在教务系统里**本来就没有排上课时间**（实践/网课/待定） */
const NO_TIME_WARNING = '这门课没有上课时间，导入后请补上';

function addWarning(draft: CourseDraft, warning: string): void {
  if (!draft.warnings.includes(warning)) draft.warnings.push(warning);
}

/**
 * 全角 → 半角（数字）、统一各种破折号，解析前必须先过这一道。
 *
 * **刻意不转换括号**：中文课名里的"（3）""（中外联合培养）"很常见，
 * 换成半角之后课名就不再是用户认得的那个样子了（"学术英语(3)"）；
 * 需要认括号的地方（单双周的"(单)/（双）"）正则里两种都写了。
 */
function normalize(text: string): string {
  return text
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
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

/** 文本里读出来的周次 */
export interface ParsedWeeks {
  weeks: number[];
  /** 文本里**明确写了**周次（false = 按整学期兜的，界面要提示核对） */
  explicit: boolean;
}

/**
 * 从一段文字里读出周次。支持**多段**（教务系统里"隔几周上一次"很常见）：
 * '1-16周'、'2-16周(双)'、'4周,8周,12周'、'1-3周,5-7周,9-11周,13-16周'、'单周'
 *
 * 单双周只认**紧跟周次后面**的括注 —— 整段里随便哪个"双"字都当规则的话，
 * "双学位"之类的课名会被读成双周课（踩过的思路，先堵上）。
 */
export function parseWeeks(
  text: string,
  fallback: { start: number; end: number } = DEFAULT_WEEKS,
): ParsedWeeks | null {
  const weeks = new Set<number>();
  const pattern = new RegExp(`(\\d{1,2})\\s*${SEP}\\s*(\\d{1,2})\\s*周|(\\d{1,2})\\s*周`, 'g');
  let matched: RegExpExecArray | null;
  while ((matched = pattern.exec(text)) !== null) {
    const start = Number(matched[1] ?? matched[3]);
    const end = matched[2] ? Number(matched[2]) : start;
    const after = text.slice(matched.index + matched[0].length, matched.index + matched[0].length + 4);
    const parity = /^\s*[（(【\[]?\s*单/.test(after)
      ? WeekParity.Odd
      : /^\s*[（(【\[]?\s*双/.test(after)
        ? WeekParity.Even
        : WeekParity.All;
    for (const week of weeksFromRange(start, end, parity)) weeks.add(week);
  }
  if (weeks.size) return { weeks: [...weeks].sort((a, b) => a - b), explicit: true };
  // 只写了"单周/双周"，没写周数 —— 用整学期兜住（用户可在预览里改）
  if (/单\s*周|[（(]\s*单\s*[）)]/.test(text)) {
    return { weeks: weeksFromRange(fallback.start, fallback.end, WeekParity.Odd), explicit: false };
  }
  if (/双\s*周|[（(]\s*双\s*[）)]/.test(text)) {
    return { weeks: weeksFromRange(fallback.start, fallback.end, WeekParity.Even), explicit: false };
  }
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

const LOCATION_LABELS = '场地|教室|上课地点|上课教室|地点|位置';
const TEACHER_LABELS = '任课教师|授课教师|上课教师|教师姓名|任课老师|教师|老师';

/**
 * 从"标签:取值"里把值取出来："场地:教B112" → "教B112"。
 *
 * 这是教务系统导出文本里**最可靠**的一类信号（标签是它自己写的，
 * 不需要猜）。所以它排在所有"猜"的前面。
 *
 * `allowCommas`：教师名常写成"林德丰,朱宏邦"，地点里基本不会有逗号 ——
 * 所以按用途区分：取地点时逗号算分隔符，取教师时不算。
 */
export function labeledValue(text: string, labels: string, allowCommas = false): string | null {
  const stop = allowCommas ? '[^/\\\\;；|]' : '[^/\\\\;；,，、|]';
  const matched = new RegExp(`(?:${labels})\\s*[:：]\\s*(${stop}+)`).exec(text);
  const value = matched?.[1]?.trim();
  if (!value) return null;
  if (/^(无|暂无|待定|-+)$/.test(value)) return null;
  return value;
}

/** 课程名后缀的课程性质标记：* 理论 / # 实践 / & 实验（教务系统的图例这么定的） */
export function stripCourseKindMark(title: string): string {
  return title.replace(/[\s]*[*#&]\s*$/, '').trim();
}

/**
 * 课程名 = 第一个"节次"记号之前、去掉各种噪声的那一段。
 *
 * 教务系统把课名写在格子最前面（"学术英语(3)* (1-2节)1-16周/校区:…"），
 * 所以"截到节次为止"比"剥掉已知片段再看剩什么"更稳 —— 后者会把
 * 破折号、括号里的数字一起剥掉。**同时打散"理论/实验"两条记录**：
 * "学术英语(3)*" 与 "学术英语(3)&" 截出来同名，于是同一门课的
 * 理论课与实验课会合并成一门课的两个时段，而不是两门课。
 */
function cutCourseName(cell: string): string | null {
  const cut = /\d{1,2}\s*(?:-\s*\d{1,2}\s*)?节/.exec(cell);
  if (!cut) return null;
  const head = cell
    .slice(0, cut.index)
    .replace(/(?:星期|周|礼拜)\s*[一二三四五六日天\d]/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/[\s(（\[【、·:：,，|]+$/, '');
  const name = stripCourseKindMark(head);
  if (name.length < 2 || name.length > 30) return null;
  return name;
}

/** 明确写了教师的格子（**短、且不带标签冒号** —— 一整段文字里冒出"教师"
 *  两个字不是教师名，踩过：整格被当成教师名，课名和地点全丢） */
function looksLikeTeacher(cell: string): boolean {
  const text = cell.trim();
  if (!text || text.length > 12) return false;
  if (/[:：]/.test(text)) return false;
  return /(老师|教师|教授|讲师|助教)/.test(text);
}

/**
 * 整行**只有一个**星期号（"星期一"、"周三"）。
 *
 * 为什么单列出来：从 PDF、或者从课表页里只框选数据区复制时，表头那一行的
 * "星期一/星期二…"会和课程内容**分开**（星期单独成行，课程各自成行）。
 * 只认"行内带星期"的话，这些内容行会被整段丢掉 —— 用户看到的就是
 * "粘了半天，一门课都没认出来"。
 *
 * 措辞刻意收紧到"整行只有星期"：只有行里除了星期什么都没有时，才敢把它
 * 当作**后面几行**的星期上下文。否则"周一至周五上课"这类说明文字会把
 * 后面所有课都带偏。
 */
const SOLE_WEEKDAY = /^(?:星期|周|礼拜)\s*[一二三四五六日天\d]$/;

/** 课程性质标记（`*`/`#`/`&`）后面紧跟的 2-4 个汉字 = 老师："游戏基础设计#舒纲旭(共12周)" */
const TEACHER_AFTER_MARK = /[*#&]\s*([\u4e00-\u9fa5]{2,4})\s*[（(]/;

/**
 * 没有"节次"可截的时候，怎么抠课程名。
 *
 * 用在"其他课程：游戏基础设计#舒纲旭(共12周)/1-12周/无"这类**本来就没有排时间**
 * 的课上（教务系统把它们单列在课表下面）。切法：去掉"其他课程："前缀 →
 * 取第一个 `/` 之前 → 只保留开头连续的中文/字母（遇到 `#`、`(` 就停）。
 *
 * 首字符必须是汉字或字母，且长度 ≥2 —— 这样"1-16周"、"1-2节"这类片段
 * 不会摇身变成课名。
 */
function titleWithoutPeriod(cell: string): string | null {
  const head = cell.replace(/^其他课程\s*[:：]\s*/, '').split(/[/|]/)[0] ?? '';
  const matched = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9（）()·]{1,27}/.exec(head.trim());
  const name = matched?.[0]?.trim();
  if (!name || name.length < 2) return null;
  return stripCourseKindMark(name);
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

/**
 * 网格行的切分：**只认制表符 / 连续空格**，不做"单空格也切"的兜底。
 *
 * 网格靠**列的位置**对齐，乱切会把列错位。踩过的：一行末尾的空列被
 * trim 掉之后，剩下的内容被按单空格切碎，"高等数学"和"(1-2节)1-16周/…"
 * 分到了两个格子 —— 于是课名丢了、课表信息被当成课程名。
 */
function splitGridCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
  return [line.trim()];
}

interface SessionCell {
  weekday: number | null;
  weekdayText: string | null;
  periods: { start: number; end: number } | null;
  weeks: ParsedWeeks | null;
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

  // ① 标签取值优先 —— "场地:教B112/教师:吕晨歌"，标签是教务系统自己写的，不用猜
  if (!out.location) {
    const place = labeledValue(cell, LOCATION_LABELS);
    if (place) {
      out.location = place;
      matched = true;
    }
  }
  if (!out.teacher) {
    const teacher = labeledValue(cell, TEACHER_LABELS, true);
    if (teacher) {
      out.teacher = teacher;
      matched = true;
    }
  }

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
  const weeks = parseWeeks(cell, DEFAULT_WEEKS);
  if (weeks) {
    out.weeks ??= weeks;
    matched = true;
  }
  const clock = parseClockSpan(cell);
  if (clock) {
    out.clock ??= clock;
    matched = true;
  }
  // ② 课程名：截到"节次"为止（教务系统把课名写在最前）
  const cutName = cutCourseName(cell);
  if (cutName) {
    out.name ??= cutName;
    return;
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
        const weeks = parseWeeks(cell, DEFAULT_WEEKS);
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
    // **刻意不 trimEnd**：网格行末尾的空列是"这一天没课"的表达，
    // 砍掉之后列就错位了（踩过）
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
  /** 网格模式：表头那一行（每列是一个星期）。教务系统的课表页就是这种表 */
  let grid: string[] | null = null;
  /** 竖版网格：表头那一行的节次（每列一个），星期在最左列 */
  let columnPeriods: Array<{ start: number; end: number } | null> | null = null;
  /**
   * "当前正在讲哪一天"。只被 SOLE_WEEKDAY（整行只有一个星期号）更新。
   * 用于 PDF / 数据区复制那种"星期单独成行、课程各自成行"的形态。
   */
  let carryWeekday: number | null = null;
  /** 连续出现了几个"整行只有一个星期号"的行（用来识别"表头串"，见下） */
  let weekdayRun = 0;

  /**
   * 把一格内容落成一条安排。
   * 普通行、网格格子、卡片式三处共用它 —— 免得"周次没读到"这类提示写三遍
   * （写三遍的下场是其中一处忘了改，界面上少一句提示，而没人知道）。
   */
  const commit = (
    info: SessionCell,
    weekday: number,
    rowPeriods: { start: number; end: number } | null,
    rawLine: string,
    carried: { title?: string | null; location?: string | null; teacher?: string | null },
  ): CourseDraft | null => {
    const periods = info.periods ?? rowPeriods;
    if (!periods) return null;
    const parsed = info.weeks ?? {
      weeks: weeksFromRange(defaults.start, defaults.end),
      explicit: false,
    };
    const session: CourseSession = {
      weekday,
      startPeriod: periods.start,
      endPeriod: periods.end,
      weeks: parsed.weeks,
      location: info.location ?? carried.location ?? null,
    };
    const title = stripCourseKindMark((info.name ?? carried.title ?? '').trim());
    const teacher = info.teacher ?? carried.teacher ?? null;
    let draft: CourseDraft | null = null;
    if (title) {
      draft = pushDraft(byTitle, title, session, { ...info, teacher }, rawLine, []);
    } else {
      // 没有课程名：退回"这一格原文"当名字，并标记要核对（不静默丢）
      const guess = stripCourseKindMark(rawLine).slice(0, 40);
      if (guess) {
        draft = pushDraft(byTitle, guess, session, { ...info, teacher }, rawLine, [
          '这一格没读到课程名，请核对',
        ]);
      }
    }
    if (!draft) return null;
    if (!parsed.explicit) addWarning(draft, WEEKS_NOT_READ);
    return draft;
  };

  /**
   * 建一门"没有上课时间"的课。
   *
   * 教务系统里有一类课**本来就没排时间**（课表下方单列的
   * "其他课程：游戏基础设计#舒纲旭(共12周)/1-12周/无"），实践课、网课、
   * 时间待定的课都长这样。它不是"解析失败" —— 按成熟课表软件
   * （WakeUp 课程表、超级课程表）的做法，这类课要能进课表，
   * 只是画不进时间网格，用户之后自己补时间。
   */
  const commitTimeless = (
    info: SessionCell,
    rawLine: string,
    carried: { title?: string | null; location?: string | null; teacher?: string | null },
  ): CourseDraft | null => {
    // 先走 titleWithoutPeriod：它能从"其他课程：游戏基础设计#舒纲旭(共12周)/…"
    // 里干净地抠出课名；info.name 在这类行上会把整行当成名字（太脏）
    const title = stripCourseKindMark(
      (titleWithoutPeriod(rawLine) ?? info.name ?? carried.title ?? '').trim(),
    );
    if (!title) return null;
    const teacher =
      info.teacher ?? carried.teacher ?? TEACHER_AFTER_MARK.exec(rawLine)?.[1] ?? null;
    const existing = byTitle.get(title);
    if (existing) {
      if (info.location && !existing.location) existing.location = info.location;
      if (teacher && !existing.teacher) existing.teacher = teacher;
      if (rawLine && !existing.raw.includes(rawLine)) existing.raw.push(rawLine);
      addWarning(existing, NO_TIME_WARNING);
      return existing;
    }
    const draft: CourseDraft = {
      title,
      teacher,
      location: info.location ?? carried.location ?? null,
      sessions: [],
      warnings: [NO_TIME_WARNING],
      raw: rawLine ? [rawLine] : [],
    };
    byTitle.set(title, draft);
    return draft;
  };

  for (const line of lines) {
    /**
     * 整行只有一个星期号 → 记下"现在讲的是哪一天"，给后面那些**没有写星期**
     * 的内容行用（从 PDF / 课表数据区复制就是这种形态）。这一行本身没有
     * 课程内容，认出来就跳过。
     */
    if (SOLE_WEEKDAY.test(line.trim())) {
      const sole = parseWeekdayToken(line.trim());
      if (sole != null) {
        weekdayRun += 1;
        /**
         * 连续第二个起 = 这是**表头串**（"星期一 星期二 …"挤在一块，
         * 课程内容在另一块）。这时最后一个星期根本代表不了后面所有课，
         * 拿它当"当前天"会把整周的课全算到星期五头上 —— 猜错比认不出更糟，
         * 所以直接停用上下文，交给结尾的 problems 去说明。
         */
        carryWeekday = weekdayRun >= 2 ? null : sole;
        continue;
      }
    }
    weekdayRun = 0;

    const cells = splitCells(line);
    const gridCells = splitGridCells(line);

    /**
     * 网格表头：一行里出现 ≥3 个"星期X"。
     * 教务系统课表页全选复制出来就是这种 —— 每列一天，格子里**不含**星期，
     * 星期只出现在表头。不认这一层的话，整张表会被当成"没有星期的行"全部丢掉。
     */
    if (gridCells.filter((cell) => parseWeekdayToken(cell) != null).length >= 3) {
      grid = gridCells;
      columnPeriods = null;
      roles = null;
      continue;
    }

    /**
     * 竖版课表的表头：**表头是节次**（"1-2节 3-4节 5-6节 …"），星期在最左列。
     * 判据：一行里出现 ≥2 个节次、且一个"星期X"都没有、也没有周次/地点标签。
     * 不单独认这一层的话，竖版课表会掉进"普通行"（一行只产一条课），
     * 一天里第二节之后的课全被丢掉 —— 真数据上就是"5 门只认出来 3 门"。
     */
    if (
      gridCells.length >= 2 &&
      gridCells.filter((cell) => parsePeriodSpan(cell) != null).length >= 2 &&
      !/\d{1,2}\s*周/.test(line) &&
      !/(?:场地|教室|地点|教师|老师)[:：]/.test(line)
    ) {
      columnPeriods = gridCells.map((cell) => parsePeriodSpan(cell));
      grid = null;
      roles = null;
      continue;
    }

    /** 竖版课表的数据行：第一格是星期，其余格子按列头给的节次各成一条安排 */
    if (columnPeriods) {
      if (gridCells.length < 2) {
        columnPeriods = null; // 单格行 = 网格结束（后面多半是"其他课程：…"）
      } else {
        const day = parseWeekdayToken((gridCells[0] ?? '').trim());
        if (day != null) {
          for (let index = 1; index < gridCells.length; index += 1) {
            const cell = (gridCells[index] ?? '').trim();
            if (!cell) continue;
            const periods = parsePeriodSpan(cell) ?? columnPeriods[index] ?? null;
            if (!periods) continue;
            if (commit(classifyCells([cell], null), day, periods, cell, {})) parsedAny = true;
          }
        }
        continue;
      }
    }

    if (grid && gridCells.length >= 2) {
      // 节次可能写在这一行的"节次"列里（表头写着"节次"，格子里只有一个数字）
      let rowPeriods: { start: number; end: number } | null = null;
      for (let index = 0; index < gridCells.length; index += 1) {
        const header = (grid[index] ?? '').replace(/\s/g, '');
        if (!/节次|节数|节$/.test(header)) continue;
        const cell = (gridCells[index] ?? '').trim();
        rowPeriods =
          parsePeriodSpan(cell) ??
          (/^\d{1,2}$/.test(cell) ? { start: Number(cell), end: Number(cell) } : null);
        break;
      }
      let committed = 0;
      for (let index = 0; index < Math.min(gridCells.length, grid.length); index += 1) {
        const cell = (gridCells[index] ?? '').trim();
        if (!cell) continue;
        const day = parseWeekdayToken(grid[index] ?? '');
        if (day == null) continue; // 非星期列（时间段/节次/说明列）不当内容
        if (commit(classifyCells([cell], null), day, rowPeriods, cell, {})) parsedAny = true;
        committed += 1;
      }
      /**
       * 还要不要继续按网格读下一行？
       * 「上午 / 下午 / 晚上」「1 / 2 / 3」这类**短标签行**是网格的结构部分，
       * 继续；而一张表后面跟着的普通长文本（"其他课程：…#…/1-12周"）不是，
       * 这时必须退出网格，否则后面的内容会被网格分支整段吞掉。
       */
      const structural = gridCells.every((cell) => cell.trim().length <= 8);
      if (committed > 0 || rowPeriods || structural) continue;
      grid = null;
    }
    // 单格的说明行（"其他课程：…"、"*: 理论 #: 实践"）：网格到此结束
    if (grid && gridCells.length === 1) grid = null;
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
    // 缺星期的行：先用"整行只有一个星期号"记下来的上下文兜（PDF / 数据区
    // 复制时星期单独成行），再退到调用方给的整列星期
    const weekday = info.weekday ?? carryWeekday ?? options.fallbackWeekday ?? null;

    /**
     * ① 没读到节次。
     *    - 读到了周次 → 它**就是一门课**，只是教务系统本来就没给它排时间
     *      （"其他课程：游戏基础设计…/1-12周/无"）。建出来并标注，让用户补。
     *    - 没周次、又是单格 → 当"卡片式"的课程名 / 地点 / 教师行分派。
     *    - 其余（多格又没周次）说明这行本身不完整，跳过。
     */
    if (!info.periods) {
      const text = line.trim();
      if (info.weeks) {
        const draft = commitTimeless(info, text, {
          title: pendingTitle,
          location: pendingLocation,
          teacher: pendingTeacher,
        });
        if (draft) {
          parsedAny = true;
          pendingTitle = null;
          pendingLocation = null;
          pendingTeacher = null;
          continue;
        }
      }
      if (cells.length !== 1) continue;
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

    /**
     * ② 有节次、就是没有星期。**绝不猜** —— 星期猜错会让整张课表都错位，
     *    比"认不出来"更糟（认不出来用户还会去手动加，错了未必看得出来）。
     *    这种情况由结尾的 problems 说明原因，让用户换一种复制方式。
     */
    if (weekday == null) continue;

    lastDraft = commit(info, weekday, null, line, {
      title: pendingTitle,
      location: pendingLocation,
      teacher: pendingTeacher,
    });
    if (lastDraft) parsedAny = true;
    pendingTitle = null;
    pendingLocation = null;
    pendingTeacher = null;
  }

  if (!parsedAny) {
    // 兜底：整段里搜"周X … 第N-M节"的散句（有的教务系统复制出来是散文）
    for (const line of lines) {
      const weekday = parseWeekdayToken(line);
      const periods = parsePeriodSpan(line);
      if (weekday == null || !periods) continue;
      const weeks = parseWeeks(line, defaults);
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
          weeks: weeks?.weeks ?? weeksFromRange(defaults.start, defaults.end),
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
    /**
     * 失败时最要紧的一句话不是"没读到"，而是**为什么**没读到 ——
     * 用户手上只有一次粘贴，说清楚原因他才知道该怎么改。
     * "有内容、没星期"多半是从 PDF 复制的，或者只框选了课表中间的数据区。
     */
    const hasWeekday = lines.some((line) => parseWeekdayToken(line) != null);
    const hasContent = lines.some((line) => /\d{1,2}\s*[节周]/.test(line));
    if (!lines.length) {
      problems.push('粘贴的内容是空的。');
    } else if (hasContent && !hasWeekday) {
      problems.push(
        '读到了课程内容，但整段里一个"星期X"都没有。可能是从 PDF 复制的，或者只框选了课表中间的数据区 —— 把表头那行的"星期一 星期二 …"一起复制进来就好了。',
      );
    } else if (hasWeekday && !hasContent) {
      problems.push(
        '读到了星期，但没读到"第几节"。请确认复制的内容里包含"(1-2节)"这样的节次信息。',
      );
    } else if (hasWeekday && hasContent) {
      problems.push(
        '"星期X"和"第几节"都读到了，但它们在文字里对不上号（星期挤在一起、课程在另一处）。请在课表页从左上角拖到右下角整表复制，让每行的格子里同时能看到星期和课程。',
      );
    } else {
      problems.push('这段文字不太像课表 —— 既没有"星期X"，也没有"第几节"。');
    }
  }

  return { courses: [...byTitle.values()], problems };
}

/** 同一门课的"同一格"：周几 + 节次 + 地点。周次不同不算同一格 */
function sameSlot(a: CourseSession, b: CourseSession): boolean {
  return (
    a.weekday === b.weekday &&
    a.startPeriod === b.startPeriod &&
    a.endPeriod === b.endPeriod &&
    (a.location ?? '') === (b.location ?? '')
  );
}

/**
 * 同名课程合并。
 *
 * **判重不能只看"周几 + 节次"** —— 真课表里同一门课同一节次的周次/教室都可能
 * 不一样（毛概 1-3、5-7、9-11、13-16 周在教A108，而 4、8、12 周在在线教室）。
 * 只看前两项会把后一条当重复丢掉，用户看到的是"课表少了三周的课"。
 * 现在：同格 → 周次取并集；不同格 → 各留一条。
 */
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
    const same = existing.sessions.find((s) => sameSlot(s, session));
    if (same) {
      same.weeks = [...new Set([...same.weeks, ...session.weeks])].sort((a, b) => a - b);
    } else {
      existing.sessions.push(session);
    }
    existing.sessions = sanitizeSessions(existing.sessions);
    if (!existing.location && session.location) existing.location = session.location;
    if (!existing.teacher && info.teacher) existing.teacher = info.teacher;
    if (rawLine && !existing.raw.includes(rawLine)) existing.raw.push(rawLine);
    for (const warning of warnings) addWarning(existing, warning);
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
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][s.weekday] ?? '';
    return `周${weekday} ${periodText} ${describeWeeks(s.weeks, totalWeeks)}`;
  });
  const suffix = totalWeeks ? `（共 ${totalWeeks} 周）` : '';
  return `${draft.title}：${parts.join('；')}${suffix}`;
}
