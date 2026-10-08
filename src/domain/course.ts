/**
 * 课程（课程表）—— 与"任务"并列的独立实体。
 *
 * 为什么不把课表塞进任务表：
 * 1. 任务有"完成态"，课没有。一节课上完不需要被勾掉，下周它还得在。
 * 2. 课表描述的是**一个学期的时间框架**（第 1-16 周、每周三 3-4 节），
 *    不是"某天要做的一件事"。硬塞进去会让任务列表被 20 门课灌满，
 *    也会把"完成率/回顾"这些口径污染掉。
 * 3. 课表的时刻来自**作息表**（第几节），任务是具体钟点，换算方式不同。
 *
 * 纯 TypeScript（可单测），不依赖 RN / Expo。
 */

import { parseDayKey, toDayKey } from '@/utils/datetime';

import type { BaseEntity } from './base';
import { layoutLanes } from './lane-layout';
import { periodSpan, type ClassPeriod } from './timetable';

/** 单双周：一门课可能只上前半段周、或者隔周上 */
export const WeekParity = {
  /** 每周（默认） */
  All: 'all',
  /** 单周 */
  Odd: 'odd',
  /** 双周 */
  Even: 'even',
} as const;
export type WeekParity = (typeof WeekParity)[keyof typeof WeekParity];

/**
 * 一次上课安排（"周三 3-4 节，第 1-16 周，教一 101"）。
 * 一门课可以有多次（周一 1-2 节 + 周四 5-6 节 = 两条 session）。
 *
 * **周次存显式列表，不存"区间 + 单双周"** —— 这是被真数据打回来改的：
 * 教务系统的课表里"隔几周上一次"很常见，比如毛概是
 * `1-3周,5-7周,9-11周,13-16周`（4、8、12 周不上，且那几周换到网课教室）。
 * 区间+单双周表达不了这种"跳着上"，硬拆成 4 条又会让课表里同一格
 * 冒出 4 行。显式列表既能精确表达，也能一次判"这周上不上"。
 * 单双周不是丢了：它是**生成列表时**的规则（weeksFromRange），不是存储格式。
 */
export interface CourseSession {
  /** 0 = 周日 … 6 = 周六（跟 Date.getDay() 一致，别自己发明顺序） */
  weekday: number;
  /** 起始节（1 起） */
  startPeriod: number;
  /** 结束节（含） */
  endPeriod: number;
  /** 上课的周次（升序、去重、从 1 起）。空数组 = 不生效 */
  weeks: number[];
  /** 单次地点覆盖（多数时候用课程的地点，但这门课换教室也常见） */
  location?: string | null;
}

export interface WeekRange {
  start: number;
  end: number;
}

/**
 * 区间（+单双周）→ 周次列表。单双周只在这里出现，存下去的就是结果。
 * '2-16 周(双)' → [2,4,6,8,10,12,14,16]
 */
export function weeksFromRange(
  start: number,
  end: number,
  parity: WeekParity = WeekParity.All,
): number[] {
  const from = Math.max(1, Math.round(start));
  const to = Math.max(from, Math.round(end));
  const out: number[] = [];
  for (let week = from; week <= to; week += 1) {
    if (parity === WeekParity.Odd && week % 2 === 0) continue;
    if (parity === WeekParity.Even && week % 2 === 1) continue;
    out.push(week);
  }
  return out;
}

/** 周次列表 → 区间（显示用）：[1,2,3,5,6,7] → [{1,3},{5,7}] */
export function compactWeeks(weeks: readonly number[]): WeekRange[] {
  const sorted = [...new Set(weeks)].filter((w) => Number.isFinite(w) && w >= 1).sort((a, b) => a - b);
  const out: WeekRange[] = [];
  for (const week of sorted) {
    const last = out[out.length - 1];
    if (last && week === last.end + 1) last.end = week;
    else out.push({ start: week, end: week });
  }
  return out;
}

/** 这门课（所有安排合起来）上哪些周 —— 课表列表里给一句总览 */
export function courseWeeks(course: Course): number[] {
  const all = new Set<number>();
  for (const session of course.sessions) for (const week of session.weeks) all.add(week);
  return [...all].sort((a, b) => a - b);
}

/**
 * 一次课的**单次调整**（"这周三的课改到周四上" / "这一次不上了"）。
 *
 * 与 `CourseSession` 的区别是**作用域**，这也是它必须单独存在的理由：
 * session 说的是"整学期每周三第 3-4 节"，change 只覆盖**某一天的那一次**。
 * 把后者塞进 session 里就变成"这门课这学期只有这一天有课"，整学期就没了。
 *
 * 身份是 `dateKey` + `fromKey` 一对 —— 原定哪一天的**哪一段安排**。
 * 为什么不能只按日期定位：同一门课同一天可能有两段（周一 1-2 节 + 周一 5-6 节），
 * 只认日期会把另一段一起改掉。
 *
 * 两种 kind **共用同一套身份**，所以"先调到周四、再改成不上"是同一条记录换状态，
 * 而不是两条同时生效、互相打架的记录。
 */
export type CourseChange =
  | {
      kind: 'moved';
      /** 原定的那一天（'YYYY-MM-DD'） */
      dateKey: string;
      /** 原定的那一段安排（`sessionKey`） */
      fromKey: string;
      /** 改到哪一天（'YYYY-MM-DD'）；与 dateKey 相同 = 只换了节次 */
      toDateKey: string;
      startPeriod: number;
      endPeriod: number;
      /** 单次换教室；null = 沿用原安排的教室 */
      location?: string | null;
    }
  | {
      kind: 'canceled';
      dateKey: string;
      fromKey: string;
    };

export interface Course extends BaseEntity {
  title: string;
  teacher?: string | null;
  location?: string | null;
  note?: string | null;
  /** 取色板下标（配色在界面层决定，领域层不碰颜色） */
  colorIndex: number;
  sessions: CourseSession[];
  /**
   * 单次调整（调课 / 停课），只覆盖某一天那一次，不动整学期。
   *
   * 为什么直接挂在课程上、不再开一张表：它跟 sessions 一样，**永远跟课程一起读**
   * （课表按整门课读出所有安排再画格子），没有单独查询的需要；量也极小
   * （一学期几条）。拆表只会多一层 join，还要多一处备份同步。
   */
  changes?: CourseChange[];
  /** 上课提醒提前量（分钟）；null = 不提醒 */
  reminderMinutesBefore?: number | null;
}

/**
 * 学期：把"第几周"落到具体日期的唯一依据。
 * startDayKey 必须是**第 1 周的周一**（否则整张课表的周次全错，
 * 所以设置项里会用 startOfWeek(weekStartsOn: 1) 兜底）。
 *
 * 它也是实体（带 BaseEntity 那几个字段）而不是纯值对象：
 * 作息表和开学日是**用户数据**，必须落库、必须跟着备份走 ——
 * 丢了它，整张课表就算不出一周是第几周，界面上表现为"课表空了"。
 */
export interface Term extends BaseEntity {
  /** '2026-2027-1' 这类学期名，界面上标一下 */
  label: string;
  /** 'YYYY-MM-DD'，第 1 周的周一 */
  startDayKey: string;
  totalWeeks: number;
  periods: readonly ClassPeriod[];
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 课表按周一打头显示（跟日历一致），周日在最后 */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const weekdayLabel = (weekday: number): string => WEEKDAY_LABELS[weekday] ?? '';

/** 同一天的一节课（已换算好时刻），界面直接用 */
export interface CourseSlot {
  course: Course;
  session: CourseSession;
  date: Date;
  /** 当天第几分钟 */
  start: number;
  end: number;
  /**
   * 这一块是**单次调整**的结果（调课过来的、或者被停掉的）。
   * 只要它非空，这一块就"不属于整学期"—— 界面上据此标注，
   * 拖拽之类的"改整学期"动作也必须让开（见 timetable-grid）。
   */
  change?: CourseChange;
}

/** 那一天的课，按"开学第几天"排序用的天数差（本地日） */
function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 864e5);
}

/**
 * 某个日期是学期第几周（1 起）。
 * 学期开始之前返回 0 或负数，学期之后超出 totalWeeks ——
 * **刻意不夹到范围内**：调用方拿它跟 session 的周次区间比较即可，
 * 夹边界会把"还没开学"的课也算成第 1 周。
 */
export function weekIndexOf(term: Term, date: Date): number | null {
  const start = parseDayKey(term.startDayKey);
  if (!start) return null;
  return Math.floor(dayDiff(start, date) / 7) + 1;
}

/** 这一周（第几周）是否正好被这次安排覆盖 */
export function isSessionActiveOnWeek(session: CourseSession, weekIndex: number): boolean {
  return session.weeks.includes(weekIndex);
}

/** 这节课在指定日期上不上（星期 + 周次都要对上） */
export function sessionOccursOn(session: CourseSession, date: Date, term: Term): boolean {
  if (session.weekday !== date.getDay()) return false;
  const week = weekIndexOf(term, date);
  if (week == null) return false;
  return isSessionActiveOnWeek(session, week);
}

/** `coursesOnDate` / `weekGrid` 的开关 */
export interface CourseQueryOptions {
  /**
   * 把"单次停课"的那一格也返回（`slot.change.kind === 'canceled'`）。
   *
   * **默认为假**，因为绝大多数调用方问的是"这一天要上什么"，而停掉的课不在答案里
   * —— 提醒、首页"下一节课"、日历的背景带都不该把它算进去（否则一节取消了的课
   * 还会响铃、还会被当成"你接下来要去的地方"）。
   *
   * 只有课表格子要开它：那一格要是直接空掉，用户既没法确认"我取消的那节课
   * 生效了没有"，也**没有地方能点回去撤销** —— 消失得无影无踪正是这个项目
   * 一直在防的那种错。
   */
  includeCanceled?: boolean;
}

/**
 * 某天的课（含时刻换算）；作息表里查不到节次的安排会被跳过（不静默画错位置）。
 *
 * 单次调整在这里生效，分两步走：
 * ① 本来该在这一天的安排 —— 被单次调走或停掉的跳过；
 * ② 被单次**调到这一天**的 —— 补进来。
 * 两步都用同一条 change（身份 = 原定日期 + 原定那一段），所以不会出现
 * "原格还在、目标格也有一份"的重复。
 */
export function coursesOnDate(
  courses: readonly Course[],
  date: Date,
  term: Term,
  options: CourseQueryOptions = {},
): CourseSlot[] {
  const key = toDayKey(date);
  const slots: CourseSlot[] = [];
  for (const course of courses) {
    if (course.deletedAt) continue;
    const changes = course.changes ?? [];

    // ① 本来就在这一天的安排
    for (const session of course.sessions) {
      if (!sessionOccursOn(session, date, term)) continue;
      const change = changes.find(
        (item) => item.dateKey === key && item.fromKey === sessionKey(session),
      );
      if (change) {
        if (change.kind === 'canceled' && options.includeCanceled) {
          const span = periodSpan(term.periods, session.startPeriod, session.endPeriod);
          if (span) slots.push({ course, session, date, start: span.start, end: span.end, change });
        }
        continue; // 停课的不上；调走的由下面 ② 在目标那天补回来
      }
      const span = periodSpan(term.periods, session.startPeriod, session.endPeriod);
      if (!span) continue;
      slots.push({ course, session, date, start: span.start, end: span.end });
    }

    // ② 被单次调到这一天的
    for (const change of changes) {
      if (change.kind !== 'moved' || change.toDateKey !== key) continue;
      const span = periodSpan(term.periods, change.startPeriod, change.endPeriod);
      if (!span) continue;
      const source = course.sessions.find((session) => sessionKey(session) === change.fromKey);
      slots.push({
        course,
        /**
         * 调过来的这一块用一条"只在这天成立"的 session 描述它 ——
         * 这样网格定位、文案、提醒都不用为它写第二套分支（它们只看 session）。
         * 周次取原安排的：对渲染没有影响，但保持形状合法（空周次是非法安排）。
         * 原安排已经不在（用户在详情页把那段删了）时兜一个当天所在的周次，
         * **不静默丢掉这块** —— 那是用户亲手排上去的一次课。
         */
        session: {
          weekday: date.getDay(),
          startPeriod: change.startPeriod,
          endPeriod: change.endPeriod,
          weeks: source?.weeks.length
            ? source.weeks
            : [Math.max(1, weekIndexOf(term, date) ?? 1)],
          location: change.location ?? source?.location ?? null,
        },
        date,
        start: span.start,
        end: span.end,
        change,
      });
    }
  }
  // 排序必须确定性：先按开始时刻，再按课程名（首字母/编码序）—— 同一时段的课不能随机换位
  return slots.sort(
    (a, b) => a.start - b.start || a.course.title.localeCompare(b.course.title, 'zh'),
  );
}

/** 一周的课表（7 天，周一打头），课表视图直接消费 */
export function weekGrid(
  courses: readonly Course[],
  weekStart: Date,
  term: Term,
  options: CourseQueryOptions = {},
): Array<{ date: Date; slots: CourseSlot[] }> {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset);
    return { date, slots: coursesOnDate(courses, date, term, options) };
  });
}

/** 同一列里，一节课被排到了第几条"道"（重叠的课必须并排画，不能互相盖住） */
export interface SlotLayout {
  slot: CourseSlot;
  /** 在这簇并发课里排第几条道（0 起） */
  lane: number;
  /** 这簇并发课一共几条道（1 = 独占整列宽） */
  lanes: number;
}

/**
 * 把一天里的课块分道。
 *
 * 为什么需要：课表视图里课块是**绝对定位**的，同一时段撞了两门课的话，
 * 后画的那门会整个盖住前一门 —— 用户看到的是"这节课凭空没了"，
 * 而不是"这两门撞了"。真实课表里撞课并不罕见（重修、实验课排进理论课时段）。
 *
 * 算法本体在 `lane-layout`（日历的日/周视图共用同一份，别在这儿另写一个）。
 */
export function layoutSlots(slots: readonly CourseSlot[]): SlotLayout[] {
  return layoutLanes(
    slots,
    (a, b) =>
      a.start - b.start ||
      a.end - b.end ||
      a.course.title.localeCompare(b.course.title, 'zh'),
  ).map(({ item, lane, lanes }) => ({ slot: item, lane, lanes }));
}

/**
 * 猜一个学期名（'2026-2027-1'）。
 *
 * 存在的理由只有一条：让导入页的输入框里**已经有一个对的默认值**。
 * 规律是按最常见的"9 月开学 / 2 月开学"来的 —— 猜错也只是用户改一个输入框，
 * 比留空让他自己想怎么写强。
 */
export function guessTermLabel(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 8) return `${year}-${year + 1}-1`;
  if (month >= 2) return `${year - 1}-${year}-2`;
  return `${year - 1}-${year}-1`;
}

/**
 * 学期第一周的周一（返回 DayKey）。
 *
 * **为什么不能用"本周一"当默认值**：用户在学期中途打开 App（比如 10 月），
 * "本周一"就成了 10 月的某个周一，导入之后整张课表的周次整体偏移 ——
 * 而且是**看起来正常**的那种错：每门课都在、节次也对，只是"第几周"
 * 全错了，用户很难发现（比认不出来危险得多）。
 *
 * 按学年惯例推：第 1 学期 9 月 1 日前后开学，第 2 学期 2 月下旬。
 * 取那一周里的周一 —— 多数学校的第 1 周就是那一周。
 *
 * 推不出来（学期名不是"2026-2027-1"这个形状）就返回 `null`，
 * 让调用方退回自己的兜底：**不硬编一个看起来像真的的值**。
 */
export function guessTermStart(label: string): string | null {
  const matched = /^(\d{4})\s*-\s*(\d{4})\s*-\s*([12])$/.exec(label.trim());
  if (!matched) return null;
  const startYear = Number(matched[1]);
  const endYear = Number(matched[2]);
  // 第 1 学期：9 月 1 日；第 2 学期：2 月 24 日（都在寒假/暑假之后）
  const anchor = matched[3] === '1' ? new Date(startYear, 8, 1) : new Date(endYear, 1, 24);
  if (Number.isNaN(anchor.getTime())) return null;
  return toDayKey(mondayOfWeek(anchor));
}

/**
 * "现在这节课，或者下一节课"。
 * 正在上的课优先（start ≤ now ≤ end），否则往后找 7 天内最近的一节。
 * 找不到返回 null —— 首页据此显示"今天没课"，而不是硬凑一条。
 */
export function nextCourse(
  courses: readonly Course[],
  term: Term,
  now: Date = new Date(),
): CourseSlot | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const slots = coursesOnDate(courses, date, term);
    for (const slot of slots) {
      if (offset === 0) {
        if (slot.end < nowMinutes) continue; // 已经下课
        return slot;
      }
      return slot;
    }
  }
  return null;
}

/** 这节课是"正在上"还是"还没到" */
export function describeSlotTiming(slot: CourseSlot, now: Date = new Date()): string {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const sameDay = toDayKey(slot.date) === toDayKey(now);
  if (sameDay && nowMinutes >= slot.start && nowMinutes <= slot.end) return '正在上';
  if (sameDay) return '今天';
  const diff = dayDiff(now, slot.date);
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${diff} 天后`;
}

/** '第 1-3、5-7、9-11、13-16 周'；覆盖整个学期时直接说'全学期' */
export function describeWeeks(weeks: readonly number[], totalWeeks?: number): string {
  if (!weeks.length) return '没排周次';
  if (totalWeeks && weeks.length >= totalWeeks) return '全学期';
  const ranges = compactWeeks(weeks);
  /**
   * 等差的"单周课/双周课"要认出来再收回去说"（单）"——
   * 单双周在存储上已被摊成显式周次，照直念会变成
   * "第 1、3、5、7、9、11、13、15 周"，比原来还难读。
   */
  if (ranges.length >= 2 && ranges.every((r) => r.start === r.end)) {
    // 必须**每两段都恰好差 2**才敢说"（单/双）"：[1,5,9] 也是奇数周，
    // 但它说的是"1、5、9 周"，念成"第 1-9 周（单）"就把没课的周说成有课了
    const stepTwo = ranges.every((r, i) => i === 0 || r.start - ranges[i - 1]!.start === 2);
    if (stepTwo) {
      const parity = ranges[0]!.start % 2 === 1 ? '单' : '双';
      return `第 ${ranges[0]!.start}-${ranges[ranges.length - 1]!.start} 周（${parity}）`;
    }
  }
  const text = ranges
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
    .join('、');
  return `第 ${text} 周`;
}

/**
 * `describeWeeks` 的逆运算 —— 把周次写回**能粘进输入框**的样子。
 *
 * 用途只有一个：打开"改这一段"的面板时，周次那一栏要预填成**这一段原本的周次**。
 * 空着的话用户一按保存，1-16 周（单）就悄悄变成整学期 —— 改个节次把周次改没了，
 * 是最难被发现的那种错（界面上两个数字都对，只有细则变了）。
 *
 * 与 `describeWeeks` 分开写，是因为读者不同：那个是给人念的（"第 1、3、5 周"），
 * 这个是给 `parseWeeks` 读的（"1-5周(单)"）—— 合用一个的结果是两边都得迁就对方。
 * 所以这里的输出**必须**能原样解析回来（course-text 的测试守着这条）。
 */
export function weeksToText(weeks: readonly number[]): string {
  const ranges = compactWeeks(weeks);
  if (!ranges.length) return '';
  // 单双周收成一个词：8 个"3周,5周,7周…"比"3-15周(单)"难读，也难核对
  if (ranges.length >= 2 && ranges.every((range) => range.start === range.end)) {
    const stepTwo = ranges.every(
      (range, index) => index === 0 || range.start - ranges[index - 1]!.start === 2,
    );
    if (stepTwo) {
      const parity = ranges[0]!.start % 2 === 1 ? '单' : '双';
      return `${ranges[0]!.start}-${ranges[ranges.length - 1]!.start}周(${parity})`;
    }
  }
  return ranges
    .map((range) => (range.start === range.end ? `${range.start}周` : `${range.start}-${range.end}周`))
    .join(',');
}

/** '第 3-4 节' / '第 5 节' */
export function describePeriods(session: CourseSession): string {
  return periodsText(session.startPeriod, session.endPeriod);
}

/** '周三 第 3-4 节 · 第 1-16 周' */
export function describeSession(session: CourseSession, totalWeeks?: number): string {
  return `${weekdayLabel(session.weekday)} ${describePeriods(session)} · ${describeWeeks(session.weeks, totalWeeks)}`;
}

/** 一次完整描述：'周三 第 3-4 节 10:00–11:40 · 教一 101' */
export function describeSlot(slot: CourseSlot, periods: readonly ClassPeriod[]): string {
  const span = periodSpan(periods, slot.session.startPeriod, slot.session.endPeriod);
  const clock = span
    ? `${String(Math.floor(span.start / 60)).padStart(2, '0')}:${String(span.start % 60).padStart(2, '0')}–${String(Math.floor(span.end / 60)).padStart(2, '0')}:${String(span.end % 60).padStart(2, '0')}`
    : '';
  const place = slot.session.location ?? slot.course.location;
  return [describePeriods(slot.session), clock, place].filter(Boolean).join(' · ');
}

/**
 * 清理导入/手输来的安排：丢掉星期或节次非法的行，规整周次列表，
 * 并**按周几+节次+首周排序**（保证同一门课的多次安排在界面上顺序稳定）。
 */
export function sanitizeSessions(input: readonly CourseSession[]): CourseSession[] {
  return input
    .map((s) => ({
      ...s,
      weeks: [...new Set(s.weeks)]
        .filter((w) => Number.isInteger(w) && w >= 1)
        .sort((a, b) => a - b),
      location: s.location ?? null,
    }))
    .filter(
      (s) =>
        Number.isInteger(s.weekday) &&
        s.weekday >= 0 &&
        s.weekday <= 6 &&
        Number.isInteger(s.startPeriod) &&
        Number.isInteger(s.endPeriod) &&
        s.startPeriod >= 1 &&
        s.endPeriod >= s.startPeriod &&
        s.weeks.length > 0,
    )
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        a.startPeriod - b.startPeriod ||
        a.endPeriod - b.endPeriod ||
        a.weeks[0]! - b.weeks[0]! ||
        (a.location ?? '').localeCompare(b.location ?? '', 'zh'),
    );
}

/**
 * 一次安排在界面上/手势里的身份：周几 + 起止节。
 * 一门课可能有好几条安排（周一 1-2 节、周四 5-6 节），拖拽只该动被抓住的那条，
 * 所以需要一个"认得出是哪一条"的键。周次不进键 —— 界面上一条安排就是一个块，
 * 拖它 = 整条安排换时间（跟超级课程表/ WakeUp 一致）。
 */
export function sessionKey(session: CourseSession): string {
  return `${session.weekday}-${session.startPeriod}-${session.endPeriod}`;
}

/**
 * 把某一次安排挪到别的星期/节次（课表网格里长按拖动课块）。
 *
 * **长度跟着走、周次与地点照旧**：拖拽表达的是"这节课换时间了"，
 * 不是"重排这门课" —— 拖一次就把 1-16 周和教室清掉，那不叫改时间，叫丢失。
 *
 * 目标不合法（找不到那条安排、星期出界）返回 null，让调用方别落库。
 */
export function moveSession(
  course: Course,
  key: string,
  weekday: number,
  startPeriod: number,
): Course | null {
  const current = course.sessions.find((session) => sessionKey(session) === key);
  if (!current) return null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const span = current.endPeriod - current.startPeriod;
  const start = Math.max(1, Math.round(startPeriod));
  return {
    ...course,
    sessions: mergeSameSlots(
      sanitizeSessions(
        course.sessions.map((session) =>
          sessionKey(session) === key
            ? { ...session, weekday, startPeriod: start, endPeriod: start + span }
            : session,
        ),
      ),
    ),
  };
}

/**
 * 把第 `index` 条安排换成新的一条（课程详情页点某一段 → 改它）。
 *
 * **按位置换，不按 `sessionKey` 找**：用户改的恰恰可能是星期/节次本身 ——
 * 键在改之前就变了，用它去找是找不到的（会静默什么都不做）。
 * 索引来自界面上那一行，点的是哪行就换哪行。
 *
 * 索引越界（列表在别处已经变过）就原样返回，不抛 —— 详情页读到的是
 * store 里的快照，理论上不会错位，但真错位时"没改动"比"改错一条"好。
 */
export function replaceSession(
  sessions: readonly CourseSession[],
  index: number,
  next: CourseSession,
): CourseSession[] {
  if (index < 0 || index >= sessions.length) return sanitizeSessions(sessions);
  const list = sessions.slice();
  list[index] = next;
  return mergeSameSlots(sanitizeSessions(list));
}

/**
 * 同一个"格子"（周几 + 起止节 + 地点）出现两次 → 合成一条，周次取并集。
 *
 * `sanitizeSessions` 只做排序与去重（同一条里的周次），**不合并两条**；
 * 而"拖课块"和"改这一段"都可能把一条改成跟另一条一模一样（本来就该是一段）。
 * 两条一模一样的行摆在详情页上没法解释 —— 用户会以为界面出错了。
 * 地点不同则各留一条（真课表里换教室那几周就是两段，见 course-text）。
 */
function mergeSameSlots(sessions: readonly CourseSession[]): CourseSession[] {
  const out: CourseSession[] = [];
  for (const session of sessions) {
    const same = out.find(
      (item) =>
        item.weekday === session.weekday &&
        item.startPeriod === session.startPeriod &&
        item.endPeriod === session.endPeriod &&
        (item.location ?? '') === (session.location ?? ''),
    );
    if (same) {
      same.weeks = [...new Set([...same.weeks, ...session.weeks])].sort((a, b) => a - b);
      continue;
    }
    out.push({ ...session, weeks: [...session.weeks] });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 单次调整：只改那一天那一次                                            */
/* ------------------------------------------------------------------ */

/** '第 3-4 节' / '第 5 节' —— 只要起止节，不需要一整条 session */
function periodsText(startPeriod: number, endPeriod: number): string {
  return startPeriod === endPeriod ? `第 ${startPeriod} 节` : `第 ${startPeriod}-${endPeriod} 节`;
}

/** `sessionKey` 的逆运算：'3-3-4' → 周三 第 3-4 节（解析不出来返回 null） */
export function readSessionKey(
  key: string,
): { weekday: number; startPeriod: number; endPeriod: number } | null {
  const matched = /^(\d)-(\d+)-(\d+)$/.exec(key);
  if (!matched) return null;
  const weekday = Number(matched[1]);
  const startPeriod = Number(matched[2]);
  const endPeriod = Number(matched[3]);
  if (weekday < 0 || weekday > 6 || startPeriod < 1 || endPeriod < startPeriod) return null;
  return { weekday, startPeriod, endPeriod };
}

/**
 * 清理单次调整：丢掉读不懂的行、同一身份只留最后一条、按日期排序。
 *
 * 跟 `sanitizeSessions` 同一个理由 —— 库里可能存着历史或手工改坏的行，
 * 一条非法的节次不该让整张课表画错位置。排序则是为了让"这学期调过几次"
 * 在界面上顺序稳定（否则同一份数据每次进详情页顺序都可能不一样）。
 */
export function sanitizeChanges(
  input: readonly (CourseChange | null | undefined)[] | null | undefined,
): CourseChange[] {
  const parsed: CourseChange[] = [];
  for (const item of input ?? []) {
    if (!item || typeof item !== 'object') continue;
    if (!parseDayKey(item.dateKey)) continue;
    if (readSessionKey(item.fromKey) == null) continue;
    if (item.kind === 'canceled') {
      parsed.push({ kind: 'canceled', dateKey: item.dateKey, fromKey: item.fromKey });
      continue;
    }
    if (item.kind !== 'moved') continue;
    if (!parseDayKey(item.toDateKey)) continue;
    if (!Number.isInteger(item.startPeriod) || !Number.isInteger(item.endPeriod)) continue;
    if (item.startPeriod < 1 || item.endPeriod < item.startPeriod) continue;
    parsed.push({
      kind: 'moved',
      dateKey: item.dateKey,
      fromKey: item.fromKey,
      toDateKey: item.toDateKey,
      startPeriod: item.startPeriod,
      endPeriod: item.endPeriod,
      location: item.location ?? null,
    });
  }
  // 同一身份只留最后一条：写入路径本该已经覆盖过，这里是读库兜底 ——
  // 两条同身份的记录会同时生效，表现为"这节课既被调走又被取消"
  const unique = new Map<string, CourseChange>();
  for (const item of parsed) unique.set(`${item.dateKey}#${item.fromKey}`, item);
  return [...unique.values()].sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.fromKey.localeCompare(b.fromKey),
  );
}

/** 这一次课的单次调整身份（原定日期 + 原定那一段） */
export interface CourseChangeAnchor {
  dateKey: string;
  fromKey: string;
}

/**
 * 被点的那一块**属于哪一次课** —— 也就是它的单次调整身份。
 *
 * 已经被调整过的块，身份仍然是**它原本那一次**：不能拿它现在的位置当身份，
 * 否则"把调过来的课再调一次"会新建出第二条调整，而原来那条还留在原地继续生效
 * （那节课会同时出现在两个地方）。
 */
export function changeAnchor(slot: CourseSlot): CourseChangeAnchor {
  if (slot.change) return { dateKey: slot.change.dateKey, fromKey: slot.change.fromKey };
  return { dateKey: toDayKey(slot.date), fromKey: sessionKey(slot.session) };
}

/**
 * 被点的那一块 + 用户选的新时间 → 一条单次调整。
 *
 * `toDate` 跟 `slot.date` 是同一天 = 只换节次（"这节课挪到下午"），
 * 这时 `toDateKey` 与 `dateKey` 相同，读的时候仍然会被正确处理
 * （原格被让出来、同一格换个位置画）。
 */
export function makeCourseChange(
  slot: CourseSlot,
  target: { toDate: Date; startPeriod: number; endPeriod: number } | { canceled: true },
): CourseChange {
  const anchor = changeAnchor(slot);
  if ('canceled' in target) return { kind: 'canceled', ...anchor };
  const startPeriod = Math.max(1, Math.round(target.startPeriod));
  return {
    kind: 'moved',
    ...anchor,
    toDateKey: toDayKey(target.toDate),
    startPeriod,
    endPeriod: Math.max(startPeriod, Math.round(target.endPeriod)),
    // 已经调过一次的，再改时间时保留原来的换教室 —— 两件事是独立的
    location: slot.change?.kind === 'moved' ? slot.change.location ?? null : null,
  };
}

/**
 * 写入一条单次调整。同一身份已有就**覆盖**它 ——
 * "先调到周四、又改成不上"是同一条记录在换状态，不是两条记录。
 */
export function applyCourseChange(course: Course, change: CourseChange): Course {
  const rest = (course.changes ?? []).filter(
    (item) => !(item.dateKey === change.dateKey && item.fromKey === change.fromKey),
  );
  return { ...course, changes: sanitizeChanges([...rest, change]) };
}

/** 撤销某一次的单次调整（恢复成整学期的原样） */
export function dropCourseChange(course: Course, anchor: CourseChangeAnchor): Course {
  return {
    ...course,
    changes: sanitizeChanges(
      (course.changes ?? []).filter(
        (item) => !(item.dateKey === anchor.dateKey && item.fromKey === anchor.fromKey),
      ),
    ),
  };
}

/** '周三 第 3-4 节 → 周四 第 5-6 节' / '周三 第 3-4 节 这次不上' */
export function describeChange(change: CourseChange): string {
  const from = readSessionKey(change.fromKey);
  const fromText = from
    ? `${weekdayLabel(from.weekday)} ${periodsText(from.startPeriod, from.endPeriod)}`
    : '原定的那一次';
  if (change.kind === 'canceled') return `${fromText} 这次不上`;
  const to = parseDayKey(change.toDateKey);
  // 同一天只换了节次："周三 第 3-4 节 改到 第 5-6 节"。
  // 这里不能照直说"改到周三" —— 日期没变，说出来反而像换了一天
  if (to && change.toDateKey === change.dateKey) {
    return `${fromText} 改到 ${periodsText(change.startPeriod, change.endPeriod)}`;
  }
  const toText = to
    ? `${weekdayLabel(to.getDay())} ${periodsText(change.startPeriod, change.endPeriod)}`
    : periodsText(change.startPeriod, change.endPeriod);
  return `${fromText} → ${toText}`;
}

/**
 * 现有课程里用到的最大节次（没有课返回 0）。
 *
 * 用途：作息表的"共几节"不能减到比这个数还小 —— 课表画在第 N 节的内容
 * 一旦超出作息表，`periodSpan` 就取不到时刻，那门课会**从网格里消失**
 * （它不是"没时间"，是"算不出时间"）。所以这个数是节数的下界，由数据推出来，
 * 不用问用户。
 */
export function maxSessionPeriod(courses: readonly Course[]): number {
  let max = 0;
  for (const course of courses) {
    if (course.deletedAt) continue;
    for (const session of course.sessions) {
      if (session.endPeriod > max) max = session.endPeriod;
    }
    /**
     * 单次调课也可能把一节课挪到更靠后的节次（"这次调到第 11-12 节"），
     * 那节课同样不能被"共几节"砍掉 —— 作息表短于它的话 `periodSpan` 取不到时刻，
     * 这块就从网格里消失了，而且消失得毫无痕迹。
     */
    for (const change of course.changes ?? []) {
      if (change.kind === 'moved' && change.endPeriod > max) max = change.endPeriod;
    }
  }
  return max;
}

/**
 * 某个日期所在那一周的周一（本地日）。
 * 用来给"学期开始日"兜一个能用的默认值 —— 用户看到的是本周一，
 * 而不是一片空白等他填。
 */
export function mondayOfWeek(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** 这门课有没有"现在还在上"的安排（首页/日历高亮用） */
export function isCourseActiveNow(course: Course, term: Term, now: Date = new Date()): boolean {
  return coursesOnDate([course], now, term).some(
    (slot) => now.getHours() * 60 + now.getMinutes() >= slot.start && now.getHours() * 60 + now.getMinutes() <= slot.end,
  );
}
