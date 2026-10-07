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
