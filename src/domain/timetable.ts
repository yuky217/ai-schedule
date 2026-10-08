/**
 * 作息时间表：把"第几节"翻译成"几点到几点"。
 *
 * 为什么单独一层：学校课表说的是节次（"周三 3-4 节"），
 * 而日历里需要的是钟点（10:00–11:40）。这两者之间是一座桥 ——
 * **作息表随学校变，课表本身不随**。所以课表只存节次，
 * 时刻在展示时才由作息表换算；换学校、换学期只要改这一张表。
 *
 * 纯 TypeScript，不依赖 RN / Expo（可单测）。
 */

/** 一节课的起止时刻，单位是"当天第几分钟"（0:00 = 0） */
export interface ClassPeriod {
  /** 第几节，从 1 开始 */
  index: number;
  start: number;
  end: number;
}

/**
 * 默认作息：最常见的高校排法（每节 45 分钟，课间 10 分钟，大节之间更久）。
 * 用户可以在设置里整表替换成自己学校的 —— 所以它只是初始值，不是定论。
 */
export const DEFAULT_PERIODS: readonly ClassPeriod[] = [
  { index: 1, start: 8 * 60, end: 8 * 60 + 45 },
  { index: 2, start: 8 * 60 + 55, end: 9 * 60 + 40 },
  { index: 3, start: 10 * 60, end: 10 * 60 + 45 },
  { index: 4, start: 10 * 60 + 55, end: 11 * 60 + 40 },
  { index: 5, start: 14 * 60, end: 14 * 60 + 45 },
  { index: 6, start: 14 * 60 + 55, end: 15 * 60 + 40 },
  { index: 7, start: 16 * 60, end: 16 * 60 + 45 },
  { index: 8, start: 16 * 60 + 55, end: 17 * 60 + 40 },
  { index: 9, start: 19 * 60, end: 19 * 60 + 45 },
  { index: 10, start: 19 * 60 + 55, end: 20 * 60 + 40 },
  { index: 11, start: 20 * 60 + 50, end: 21 * 60 + 35 },
  { index: 12, start: 21 * 60 + 45, end: 22 * 60 + 30 },
];

/**
 * 作息表的"三个数"。
 *
 * 这是从成熟课表软件（WakeUp、超级课程表）学来的关键取舍：学校的作息
 * 跟默认不一样时，**用户能说清的只有三件事** —— 第一节几点开始、一节课多长、
 * 两节之间歇多久。剩下那二十几个时刻全是推出来的。
 *
 * 让用户一格格去填 12 节的起止时间（24 个输入），等于把他学校早已定好的
 * 那张表重新抄一遍；而这活本来是程序该干的。表格里真正各校不同的，
 * 恰恰只有这三个数。
 */
export interface PeriodPlan {
  /** 第 1 节开始（当天第几分钟） */
  firstStart: number;
  /** 每节课多长（分钟） */
  classMinutes: number;
  /** 相邻两节之间歇多久（分钟） */
  breakMinutes: number;
}

/** 国内高校最常见的一套：8:00 开始、每节 45 分钟、课间 10 分钟 */
export const DEFAULT_PERIOD_PLAN: PeriodPlan = {
  firstStart: 8 * 60,
  classMinutes: 45,
  breakMinutes: 10,
};

/** 合理的上下界 —— 防止手滑输成 450 分钟一节课把整张表排到第二天 */
const MIN_CLASS_MINUTES = 10;
const MAX_CLASS_MINUTES = 180;
const MIN_BREAK_MINUTES = 0;
const MAX_BREAK_MINUTES = 90;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * 作息表最多排到第几节。上下界只在这里定义一地，
 * `buildPeriods` / `resizePeriods` / 界面输入框都取它。
 */
export const MAX_PERIODS = 20;

/**
 * 按"三个数"排出一整张作息表。
 *
 * **连续排、不区分上下午**：跨过午饭/晚饭的断点靠用户醒来后自己看一眼
 * 下面那张表、点一下对应的那一节去调（一次点击），而不是再加一个
 * "上午/下午/晚上各从几点开始"的三组输入 —— 后者是给程序省事，不是给用户省事。
 */
export function buildPeriods(plan: PeriodPlan, count: number): ClassPeriod[] {
  const total = clamp(count, 1, MAX_PERIODS);
  const classMinutes = clamp(plan.classMinutes, MIN_CLASS_MINUTES, MAX_CLASS_MINUTES);
  const breakMinutes = clamp(plan.breakMinutes, MIN_BREAK_MINUTES, MAX_BREAK_MINUTES);
  const firstStart = clamp(plan.firstStart, 0, 1439);

  const out: ClassPeriod[] = [];
  let cursor = firstStart;
  for (let index = 1; index <= total; index += 1) {
    out.push({ index, start: cursor, end: cursor + classMinutes });
    cursor += classMinutes + breakMinutes;
  }
  return sanitizePeriods(out);
}

/**
 * 把作息表调成 count 节（"共几节"那个输入框）。
 *
 * - **不够就接着往下排**：从最后一节的节奏延（每节多长、课间多久照抄），
 *   前面手指点过的那些节原样保留 —— 学校下午、晚上各从几点开始常常不一样，
 *   用户多半已经点过第 5 节、第 9 节，加两节不该把那些动手的成果抹掉。
 * - **多了就砍尾巴**：只截掉末尾几节，不重算前面。
 *
 * 为什么不直接 `buildPeriods(plan, count)` 重排整张："我学校只有 10 节"是**去掉多余的**，
 * 不是"把整张表按默认值重算一遍"，而且"改共几节"和"改每节课多长"是两件事 ——
 * 前者不该动后者的结果。
 */
export function resizePeriods(periods: readonly ClassPeriod[], count: number): ClassPeriod[] {
  const sorted = sanitizePeriods(periods);
  const total = clamp(count, 1, MAX_PERIODS);
  if (!sorted.length) return buildPeriods(DEFAULT_PERIOD_PLAN, total);
  if (sorted.length >= total) return sorted.slice(0, total);

  const last = sorted[sorted.length - 1]!;
  const plan = readPeriodPlan(sorted) ?? DEFAULT_PERIOD_PLAN;
  const duration = last.end - last.start;
  const gap = plan.breakMinutes;

  const out = [...sorted];
  let start = last.end + gap;
  for (let index = last.index + 1; out.length < total; index += 1) {
    out.push({ index, start, end: start + duration });
    start += duration + gap;
  }
  return sanitizePeriods(out);
}

/**
 * 反过来读：从一张作息表里把"三个数"读回来。
 *
 * 用途只有一个 —— 用户打开设置页时，那三个输入框里**已经是他学校的数**，
 * 而不是默认的 8:00/45/10。取的是"出现次数最多的那个值"而不是第一行：
 * 表格被手调过之后（比如下午第 5 节单独改成了 14:30），拿第一行去代表整张表
 * 会读出一个只有那一节成立的数。
 *
 * 空表返回 null，由调用方退回 DEFAULT_PERIOD_PLAN。
 */
export function readPeriodPlan(periods: readonly ClassPeriod[]): PeriodPlan | null {
  if (!periods.length) return null;

  const mode = (values: number[]): number | null => {
    if (!values.length) return null;
    const tally = new Map<number, number>();
    for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
    let best = values[0]!;
    let bestCount = 0;
    // 票数相同时取更小的那个 —— 保证同一个输入永远给同一个结果（确定性）
    for (const [value, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  const sorted = sanitizePeriods(periods);
  const classMinutes = mode(sorted.map((p) => p.end - p.start));
  const breaks: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) breaks.push(sorted[i]!.start - sorted[i - 1]!.end);
  const breakMinutes = mode(breaks);

  return {
    firstStart: sorted[0]!.start,
    classMinutes: classMinutes ?? DEFAULT_PERIOD_PLAN.classMinutes,
    breakMinutes: breakMinutes ?? DEFAULT_PERIOD_PLAN.breakMinutes,
  };
}

/** 480 → '08:00' */
export function describeClock(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 解析各种写法的钟点：'8:00' / '08：00' / '8点30' / '14:00-14:45'（取前半段）。
 * 认不出来返回 null —— 调用方自行决定是提示还是回退默认值。
 */
export function parseClock(input: string): number | null {
  if (!input) return null;
  const head = input.split(/[-–—~至]/)[0]!.trim();
  const matched = /(\d{1,2})\s*[:：点]\s*(\d{1,2})?/.exec(head);
  if (!matched) return null;
  const h = Number(matched[1]);
  const m = matched[2] ? Number(matched[2]) : 0;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 按节号取一节课 */
export function periodById(
  periods: readonly ClassPeriod[],
  index: number,
): ClassPeriod | null {
  return periods.find((p) => p.index === index) ?? null;
}

/**
 * 连续几节的合并时段。
 * 只要**首节**和**末节**都在表里就算得出来（中间缺节不影响 ——
 * 课表里"3-4 节"就是一整段，中间那 10 分钟课间是这堂课的一部分）。
 */
export function periodSpan(
  periods: readonly ClassPeriod[],
  startIndex: number,
  endIndex: number,
): { start: number; end: number } | null {
  const from = periodById(periods, startIndex);
  const to = periodById(periods, endIndex);
  if (!from || !to) return null;
  return { start: from.start, end: to.end };
}

/** '10:00–11:40'；取不到时刻返回空串（调用方别拿它当标题） */
export function describePeriodSpan(
  periods: readonly ClassPeriod[],
  startIndex: number,
  endIndex: number,
): string {
  const span = periodSpan(periods, startIndex, endIndex);
  return span ? `${describeClock(span.start)}–${describeClock(span.end)}` : '';
}

/**
 * 把外部来源（设置页输入、导入文件）的作息表整理成可信数据：
 * 排序、去重（同节号留第一条）、丢掉起止时刻不合理的行。
 * **不校验先后顺序**（允许第 5 节早于第 4 节 —— 有些学校晚上排在最前），
 * 只要求每节自己的 end > start。
 */
export function sanitizePeriods(input: readonly ClassPeriod[]): ClassPeriod[] {
  const seen = new Set<number>();
  const cleaned = input
    .filter(
      (p) =>
        Number.isFinite(p.index) &&
        p.index >= 1 &&
        Number.isFinite(p.start) &&
        Number.isFinite(p.end) &&
        p.end > p.start,
    )
    .sort((a, b) => a.index - b.index)
    .filter((p) => {
      if (seen.has(p.index)) return false;
      seen.add(p.index);
      return true;
    });
  return cleaned;
}
