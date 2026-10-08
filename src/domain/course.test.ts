import { describe, expect, it } from 'vitest';

import {
  compactWeeks,
  courseWeeks,
  coursesOnDate,
  describePeriods,
  describeSession,
  describeSlot,
  describeSlotTiming,
  describeWeeks,
  guessTermLabel,
  guessTermStart,
  isCourseActiveNow,
  isSessionActiveOnWeek,
  layoutSlots,
  maxSessionPeriod,
  moveSession,
  nextCourse,
  replaceSession,
  sanitizeSessions,
  sessionKey,
  sessionOccursOn,
  weekGrid,
  weekIndexOf,
  weeksFromRange,
  weeksToText,
  WeekParity,
  type Course,
  type CourseSession,
  type Term,
} from './course';
import { SyncState } from './enums';
import { createCourse, createTerm } from './factory';
import { parseWeeks } from './course-text';
import { DEFAULT_PERIODS } from './timetable';

/** 2026-09-07 是周一 —— 学期第 1 周的周一 */
const TERM: Term = createTerm({
  label: '2026-2027-1',
  startDayKey: '2026-09-07',
  totalWeeks: 18,
  periods: DEFAULT_PERIODS,
});

const d = (y: number, m: number, day: number): Date => new Date(y, m - 1, day);
/** 某天的某个钟点（构造"现在"用） */
const at = (y: number, m: number, day: number, hour: number, minute = 0): Date =>
  new Date(y, m - 1, day, hour, minute);

function session(patch: Partial<CourseSession> = {}): CourseSession {
  return {
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    weeks: weeksFromRange(1, 16),
    location: null,
    ...patch,
  };
}

function course(title: string, sessions: CourseSession[], patch: Partial<Course> = {}): Course {
  return {
    id: `course-${title}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    remoteId: null,
    syncState: SyncState.Local,
    title,
    teacher: null,
    location: null,
    note: null,
    colorIndex: 0,
    sessions,
    reminderMinutesBefore: null,
    ...patch,
  };
}

describe('weeksFromRange：区间+单双周 → 显式周次', () => {
  it('每周', () => {
    expect(weeksFromRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('单周 / 双周', () => {
    expect(weeksFromRange(1, 8, WeekParity.Odd)).toEqual([1, 3, 5, 7]);
    expect(weeksFromRange(2, 8, WeekParity.Even)).toEqual([2, 4, 6, 8]);
  });

  it('起点是双周时，单周规则不会倒回来算第 0 周', () => {
    expect(weeksFromRange(2, 6, WeekParity.Odd)).toEqual([3, 5]);
  });

  it('倒挂的区间至少给出起点那一周（脏数据不进死循环）', () => {
    expect(weeksFromRange(5, 3)).toEqual([5]);
  });
});

describe('compactWeeks：周次列表 → 区间（显示用）', () => {
  it('连续段合并，断开的各成一段', () => {
    expect(compactWeeks([1, 2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 16])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 7 },
      { start: 9, end: 9 },
      { start: 11, end: 11 },
      { start: 13, end: 16 },
    ]);
  });

  it('去重并排序（导入来的周次顺序不可信）', () => {
    expect(compactWeeks([3, 1, 3, 2])).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('weekIndexOf：把日期落到学期第几周', () => {
  it('学期第一天（周一）就是第 1 周，同周内不变', () => {
    expect(weekIndexOf(TERM, d(2026, 9, 7))).toBe(1);
    expect(weekIndexOf(TERM, d(2026, 9, 13))).toBe(1); // 周日仍属第 1 周
    expect(weekIndexOf(TERM, d(2026, 9, 14))).toBe(2);
  });

  it('中间日期算得准（10-05 是第 5 周）', () => {
    expect(weekIndexOf(TERM, d(2026, 10, 5))).toBe(5);
  });

  it('开学之前**不夹到第 1 周**（否则还没开学的课会被当成第 1 周上）', () => {
    expect(weekIndexOf(TERM, d(2026, 9, 6))).toBeLessThanOrEqual(0);
    expect(weekIndexOf(TERM, d(2026, 8, 31))).toBeLessThanOrEqual(0);
  });
});

describe('isSessionActiveOnWeek：这一周上不上', () => {
  const odd = session({ weeks: weeksFromRange(1, 16, WeekParity.Odd) });
  const even = session({ weeks: weeksFromRange(1, 16, WeekParity.Even) });
  const midterm = session({ weeks: weeksFromRange(3, 8) });
  const broken = session({ weeks: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16] });

  it('单周课只在奇数周上', () => {
    expect(isSessionActiveOnWeek(odd, 1)).toBe(true);
    expect(isSessionActiveOnWeek(odd, 2)).toBe(false);
    expect(isSessionActiveOnWeek(odd, 15)).toBe(true);
  });

  it('双周课只在偶数周上', () => {
    expect(isSessionActiveOnWeek(even, 2)).toBe(true);
    expect(isSessionActiveOnWeek(even, 1)).toBe(false);
  });

  it('周次区间之外一律不上（含学期结束后）', () => {
    expect(isSessionActiveOnWeek(midterm, 2)).toBe(false);
    expect(isSessionActiveOnWeek(midterm, 3)).toBe(true);
    expect(isSessionActiveOnWeek(midterm, 8)).toBe(true);
    expect(isSessionActiveOnWeek(midterm, 9)).toBe(false);
    expect(isSessionActiveOnWeek(odd, 17)).toBe(false);
  });

  it('**跳着上的课**：第 4、8、12 周不上（真课表里的毛概就是这样）', () => {
    expect(isSessionActiveOnWeek(broken, 3)).toBe(true);
    expect(isSessionActiveOnWeek(broken, 4)).toBe(false);
    expect(isSessionActiveOnWeek(broken, 8)).toBe(false);
    expect(isSessionActiveOnWeek(broken, 12)).toBe(false);
    expect(isSessionActiveOnWeek(broken, 13)).toBe(true);
  });

  it('开学前（第 0 周及负数）不会被算成单周', () => {
    expect(isSessionActiveOnWeek(odd, 0)).toBe(false);
    expect(isSessionActiveOnWeek(even, 0)).toBe(false);
  });
});

describe('sessionOccursOn：星期与周次都要对上', () => {
  const monday = session({ weekday: 1 });

  it('周一 1-2 节在 10-05（周一，第 5 周）上', () => {
    expect(sessionOccursOn(monday, d(2026, 10, 5), TERM)).toBe(true);
  });

  it('其他星期不上', () => {
    expect(sessionOccursOn(monday, d(2026, 10, 6), TERM)).toBe(false);
  });

  it('单周课在第 6 周（双周）的周一不上', () => {
    const oddMonday = session({ weekday: 1, weeks: weeksFromRange(1, 16, WeekParity.Odd) });
    expect(sessionOccursOn(oddMonday, d(2026, 10, 5), TERM)).toBe(true); // 第 5 周
    expect(sessionOccursOn(oddMonday, d(2026, 10, 12), TERM)).toBe(false); // 第 6 周
  });
});

describe('coursesOnDate：某天的课', () => {
  const math = course('高等数学', [session({ weekday: 1, startPeriod: 1, endPeriod: 2 })]);
  const english = course('大学英语', [session({ weekday: 1, startPeriod: 3, endPeriod: 4 })]);

  it('按开始时刻排序', () => {
    const slots = coursesOnDate([english, math], d(2026, 10, 5), TERM);
    expect(slots.map((s) => s.course.title)).toEqual(['高等数学', '大学英语']);
    expect(slots[0]!.start).toBe(480);
  });

  it('同一时段的课按课程名排（顺序必须稳定，不能随机跳动）', () => {
    const a = course('A 课', [session({ weekday: 1 })]);
    const b = course('B 课', [session({ weekday: 1 })]);
    expect(coursesOnDate([b, a], d(2026, 10, 5), TERM).map((s) => s.course.title)).toEqual(['A 课', 'B 课']);
    expect(coursesOnDate([a, b], d(2026, 10, 5), TERM).map((s) => s.course.title)).toEqual(['A 课', 'B 课']);
  });

  it('作息表里没有这一节就不出（不画错位置）', () => {
    const weird = course('晚课', [session({ weekday: 1, startPeriod: 15, endPeriod: 16 })]);
    expect(coursesOnDate([weird], d(2026, 10, 5), TERM)).toEqual([]);
  });

  it('已删除的课程不出现', () => {
    const deleted = course('旧课', [session({ weekday: 1 })], { deletedAt: '2026-09-30T00:00:00.000Z' });
    expect(coursesOnDate([deleted], d(2026, 10, 5), TERM)).toEqual([]);
  });

  it('同一天多门课按各自的节次换算时刻', () => {
    const slots = coursesOnDate([math, english], d(2026, 10, 5), TERM);
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      [480, 580],
      [600, 700],
    ]);
  });
});

describe('nextCourse：现在上哪节 / 下一节是哪节', () => {
  const math = course('高等数学', [session({ weekday: 1, startPeriod: 1, endPeriod: 2 })]);
  const english = course('大学英语', [session({ weekday: 1, startPeriod: 5, endPeriod: 6 })]);

  it('正在上的课优先（8:00-9:40 之间就是它）', () => {
    const slot = nextCourse([math, english], TERM, at(2026, 10, 5, 8, 30));
    expect(slot?.course.title).toBe('高等数学');
    expect(describeSlotTiming(slot!, at(2026, 10, 5, 8, 30))).toBe('正在上');
  });

  it('已经下课就找下一节（10:00 之后是 14:00 的英语）', () => {
    const slot = nextCourse([math, english], TERM, at(2026, 10, 5, 10, 0));
    expect(slot?.course.title).toBe('大学英语');
    expect(describeSlotTiming(slot!, at(2026, 10, 5, 10, 0))).toBe('今天');
  });

  it('今天的课上完且 7 天内没课 → null（首页显示"今天没课"，不硬凑）', () => {
    expect(nextCourse([math, english], TERM, at(2026, 10, 5, 18, 0))).toBeNull();
  });

  it('跨天找下一节：周一的课之后是周三的课', () => {
    const wednesday = course('大学物理', [session({ weekday: 3, startPeriod: 3, endPeriod: 4 })]);
    const slot = nextCourse([math, wednesday], TERM, at(2026, 10, 5, 18, 0));
    expect(slot?.course.title).toBe('大学物理');
    expect(describeSlotTiming(slot!, at(2026, 10, 5, 18, 0))).toBe('后天');
  });
});

describe('描述文案（界面直接显示，别让各处各写一套）', () => {
  it('节次', () => {
    expect(describePeriods(session({ startPeriod: 3, endPeriod: 4 }))).toBe('第 3-4 节');
    expect(describePeriods(session({ startPeriod: 5, endPeriod: 5 }))).toBe('第 5 节');
  });

  it('周次：连续 / 断开 / 单双周 / 全学期', () => {
    expect(describeWeeks(weeksFromRange(1, 16))).toBe('第 1-16 周');
    expect(describeWeeks(weeksFromRange(3, 8))).toBe('第 3-8 周');
    expect(describeWeeks([5])).toBe('第 5 周');
    expect(describeWeeks([1, 2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 16])).toBe(
      '第 1-3、5-7、9、11、13-16 周',
    );
    expect(describeWeeks(weeksFromRange(1, 16, WeekParity.Odd))).toBe('第 1-15 周（单）');
    expect(describeWeeks(weeksFromRange(2, 16, WeekParity.Even))).toBe('第 2-16 周（双）');
    expect(describeWeeks(weeksFromRange(1, 18), 18)).toBe('全学期');
  });

  it('奇数周但不连续时**不会**被念成"第 1-9 周（单）"', () => {
    expect(describeWeeks([1, 5, 9])).toBe('第 1、5、9 周');
  });

  it('整条安排', () => {
    const s = session({
      weekday: 3,
      startPeriod: 3,
      endPeriod: 4,
      weeks: weeksFromRange(1, 16, WeekParity.Odd),
    });
    expect(describeSession(s)).toBe('周三 第 3-4 节 · 第 1-15 周（单）');
  });

  it('某天的某一节（含钟点与地点）', () => {
    const c = course('大学物理', [session({ weekday: 3, startPeriod: 3, endPeriod: 4, location: '教一101' })]);
    const [slot] = coursesOnDate([c], d(2026, 10, 7), TERM);
    expect(slot).toBeDefined();
    expect(describeSlot(slot!, DEFAULT_PERIODS)).toBe('第 3-4 节 · 10:00–11:40 · 教一101');
  });
});

describe('courseWeeks：这门课一共上哪些周', () => {
  it('多个时段取并集', () => {
    const c = course('毛概', [
      session({ weekday: 3, weeks: [1, 2, 3, 5] }),
      session({ weekday: 5, weeks: [2, 4] }),
    ]);
    expect(courseWeeks(c)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sanitizeSessions：导入/手输进来的脏数据挡在门外', () => {
  it('丢掉星期非法、节次倒挂、没有周次的行，并按星期+节次排序', () => {
    const cleaned = sanitizeSessions([
      session({ weekday: 3, startPeriod: 3, endPeriod: 4 }),
      session({ weekday: 7 }),
      session({ weekday: 1, startPeriod: 5, endPeriod: 3 }),
      session({ weekday: 2, weeks: [] }),
      session({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
    ]);
    expect(cleaned.map((s) => [s.weekday, s.startPeriod])).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('周次去重排序（导入来的顺序不可信）', () => {
    const cleaned = sanitizeSessions([session({ weeks: [5, 3, 5, 1] })]);
    expect(cleaned[0]!.weeks).toEqual([1, 3, 5]);
  });

  it('同一门课同一时段的两条记录不互相覆盖（按周次排序稳定）', () => {
    const cleaned = sanitizeSessions([
      session({ weekday: 3, startPeriod: 1, endPeriod: 3, weeks: [1, 2, 3], location: '教A108' }),
      session({ weekday: 3, startPeriod: 1, endPeriod: 3, weeks: [4], location: '在线网络教室03' }),
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned.map((s) => s.location)).toEqual(['教A108', '在线网络教室03']);
  });

  it('地点缺省补成 null（避免 undefined 落库）', () => {
    const cleaned = sanitizeSessions([{ ...session(), location: undefined }]);
    expect(cleaned[0]!.location).toBeNull();
  });
});

describe('weekGrid：一整周的课表（周一打头）', () => {
  it('返回 7 天，且每天装自己的课', () => {
    const math = course('高等数学', [session({ weekday: 1 })]);
    const wed = course('大学物理', [session({ weekday: 3, startPeriod: 3, endPeriod: 4 })]);
    const grid = weekGrid([math, wed], d(2026, 10, 5), TERM);
    expect(grid).toHaveLength(7);
    expect(grid[0]!.slots.map((s) => s.course.title)).toEqual(['高等数学']);
    expect(grid[1]!.slots).toEqual([]);
    expect(grid[2]!.slots.map((s) => s.course.title)).toEqual(['大学物理']);
  });
});

describe('isCourseActiveNow', () => {
  const math = course('高等数学', [session({ weekday: 1 })]);

  it('上课中 → true；下课后 → false', () => {
    expect(isCourseActiveNow(math, TERM, at(2026, 10, 5, 8, 30))).toBe(true);
    expect(isCourseActiveNow(math, TERM, at(2026, 10, 5, 10, 0))).toBe(false);
  });
});

describe('layoutSlots：撞课的课块要并排画，不能互相盖住', () => {
  /** 2026-10-05 是周一，落在第 5 周（学期从 09-07 起），所以这些课都上 */
  const MON = d(2026, 10, 5);
  const onMonday = (sessions: CourseSession[][]): ReturnType<typeof coursesOnDate> =>
    coursesOnDate(
      sessions.map((s, i) => course(`课${i}`, s)),
      MON,
      TERM,
    );

  it('同一时段两门 → 两条道，各占一半宽', () => {
    const layout = layoutSlots(
      onMonday([[session({ weekday: 1, startPeriod: 1, endPeriod: 2 })], [session({ weekday: 1, startPeriod: 1, endPeriod: 2 })]]),
    );
    expect(layout.map((l) => l.lane)).toEqual([0, 1]);
    expect(layout.map((l) => l.lanes)).toEqual([2, 2]);
  });

  it('首尾相接（1-2 节与 3 节起）不算撞课 —— 那是两节课之间的课间', () => {
    const layout = layoutSlots(
      onMonday([[session({ weekday: 1, startPeriod: 1, endPeriod: 2 })], [session({ weekday: 1, startPeriod: 3, endPeriod: 4 })]]),
    );
    expect(layout.map((l) => l.lanes)).toEqual([1, 1]);
  });

  it('上午撞一次，不会把下午那节也压成半宽（分簇算，不按天算）', () => {
    const layout = layoutSlots(
      onMonday([
        [session({ weekday: 1, startPeriod: 1, endPeriod: 2 })],
        [session({ weekday: 1, startPeriod: 1, endPeriod: 2 })],
        [session({ weekday: 1, startPeriod: 5, endPeriod: 6 })],
      ]),
    );
    const byLanes = new Map(layout.map((l) => [l.slot.session.startPeriod, l]));
    expect(byLanes.get(1)!.lanes).toBe(2);
    expect(byLanes.get(5)!.lanes).toBe(1);
    expect(byLanes.get(5)!.lane).toBe(0);
  });

  it('三节连环重叠 → 三条道（不是两簇两条）', () => {
    const layout = layoutSlots(
      onMonday([
        [session({ weekday: 1, startPeriod: 1, endPeriod: 4 })],
        [session({ weekday: 1, startPeriod: 2, endPeriod: 5 })],
        [session({ weekday: 1, startPeriod: 3, endPeriod: 6 })],
      ]),
    );
    expect(layout.map((l) => l.lanes)).toEqual([3, 3, 3]);
    expect([...layout.map((l) => l.lane)].sort()).toEqual([0, 1, 2]);
  });

  it('没有课 → 空数组（不是 undefined，界面不用再判一次）', () => {
    expect(layoutSlots([])).toEqual([]);
  });
});

describe('guessTermLabel：导入页的默认学期名', () => {
  it('8 月起算当学年的第一学期', () => {
    expect(guessTermLabel(d(2026, 10, 5))).toBe('2026-2027-1');
    expect(guessTermLabel(d(2026, 8, 1))).toBe('2026-2027-1');
  });

  it('2-7 月是当学年的第二学期', () => {
    expect(guessTermLabel(d(2027, 3, 1))).toBe('2026-2027-2');
    expect(guessTermLabel(d(2027, 7, 31))).toBe('2026-2027-2');
  });

  it('1 月仍属于上一个学年（寒假在第一学期尾巴上）', () => {
    expect(guessTermLabel(d(2027, 1, 10))).toBe('2026-2027-1');
  });
});

describe('guessTermStart：导入页的默认开学日', () => {
  /**
   * 断言"是周一、落在几月几日附近"而不是写死某个日期 ——
   * 这条规则本来就只是**惯例**（9 月 1 日前后开学），
   * 写死具体某天会把"惯例"假装成"事实"，以后调惯例反而要改测试。
   */
  const parsed = (key: string) =>
    new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

  it('第 1 学期 → 8 月底 / 9 月初的那个周一', () => {
    const date = parsed(guessTermStart('2026-2027-1')!);
    expect(date.getDay()).toBe(1); // 周一
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7); // 8 月
    expect(date.getDate()).toBeGreaterThanOrEqual(28);
  });

  it('第 2 学期 → 次年 2 月下旬的那个周一', () => {
    const date = parsed(guessTermStart('2026-2027-2')!);
    expect(date.getDay()).toBe(1);
    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(1); // 2 月
    expect(date.getDate()).toBeGreaterThanOrEqual(20);
  });

  it('学期名不是那个形状就返回 null —— 不硬编一个看起来像真的日期', () => {
    expect(guessTermStart('2026秋')).toBeNull();
    expect(guessTermStart('')).toBeNull();
  });
});

/**
 * 课表网格里拖动课块换星期/节次（2026-10-08）。
 * 钉住三条：只动被抓住的那条安排、跨度跟着走、周次与教室不能丢。
 */
describe('moveSession', () => {
  const course = createCourse({
    title: '软件工程',
    location: '教一 101',
    sessions: [
      { weekday: 1, startPeriod: 3, endPeriod: 4, weeks: [1, 2, 3], location: null },
      { weekday: 4, startPeriod: 5, endPeriod: 6, weeks: [1, 2, 3], location: '实验楼' },
    ],
  });

  it('拖到周二：只有被拖的那条换天，另一条原样', () => {
    const moved = moveSession(course, sessionKey(course.sessions[0]!), 2, 3)!;
    expect(moved.sessions.map((s) => [s.weekday, s.startPeriod, s.endPeriod])).toEqual([
      [2, 3, 4],
      [4, 5, 6],
    ]);
  });

  it('跨几节就还是跨几节（3-4 节拖到第 7 节 = 7-8 节）', () => {
    const moved = moveSession(course, sessionKey(course.sessions[0]!), 2, 7)!;
    const target = moved.sessions.find((s) => s.weekday === 2)!;
    expect(target.startPeriod).toBe(7);
    expect(target.endPeriod).toBe(8);
  });

  it('周次和地点跟着走 —— 拖一次不该把 1-3 周和教室清掉', () => {
    const withRoom = {
      ...course,
      sessions: [{ weekday: 1, startPeriod: 3, endPeriod: 4, weeks: [1, 2, 3], location: '教二 202' }],
    };
    const moved = moveSession(withRoom, sessionKey(withRoom.sessions[0]!), 5, 1)!;
    expect(moved.sessions[0]!.weeks).toEqual([1, 2, 3]);
    expect(moved.sessions[0]!.location).toBe('教二 202');
  });

  it('认不出的安排 / 星期出界 → null（不落库）', () => {
    expect(moveSession(course, '9-1-2', 3, 1)).toBeNull();
    expect(moveSession(course, sessionKey(course.sessions[0]!), 7, 1)).toBeNull();
  });

  it('节次下限兜在 1 —— 拖到网格最上面不会得到"第 0 节"', () => {
    const moved = moveSession(course, sessionKey(course.sessions[0]!), 3, 0)!;
    expect(moved.sessions.find((s) => s.weekday === 3)!.startPeriod).toBe(1);
  });
});

describe('maxSessionPeriod：作息表"共几节"的下界由它决定', () => {
  it('取所有课里最大的结束节次', () => {
    expect(
      maxSessionPeriod([
        course('高数', [session({ startPeriod: 1, endPeriod: 2 })]),
        course('线代', [session({ weekday: 3, startPeriod: 9, endPeriod: 10 })]),
      ]),
    ).toBe(10);
  });

  it('一门课有多段时取最大的那段', () => {
    expect(
      maxSessionPeriod([
        course('英语', [session({ startPeriod: 1, endPeriod: 2 }), session({ weekday: 4, startPeriod: 11, endPeriod: 12 })]),
      ]),
    ).toBe(12);
  });

  it('没有课 / 全是没有时间的课 → 0（节数不受约束）', () => {
    expect(maxSessionPeriod([])).toBe(0);
    expect(maxSessionPeriod([course('网课', [])])).toBe(0);
  });

  it('已删掉的课不算 —— 删完就能把节数降回去', () => {
    expect(maxSessionPeriod([course('旧课', [session({ startPeriod: 13, endPeriod: 13 })], { deletedAt: '2026-10-01T00:00:00.000Z' })])).toBe(0);
  });
});

describe('weeksToText：把周次写回"能粘进输入框"的样子', () => {
  it('连续区间收成 a-b周，零散周次逐个写', () => {
    expect(weeksToText(weeksFromRange(1, 16))).toBe('1-16周');
    expect(weeksToText([3])).toBe('3周');
    expect(weeksToText([1, 2, 5])).toBe('1-2周,5周');
    expect(weeksToText([])).toBe('');
  });

  it('单双周收成一个词（不摊成一长串）', () => {
    expect(weeksToText(weeksFromRange(1, 15, WeekParity.Odd))).toBe('1-15周(单)');
    expect(weeksToText(weeksFromRange(2, 16, WeekParity.Even))).toBe('2-16周(双)');
  });

  it('**必须能被 parseWeeks 原样读回来** —— 否则"改一段"会把周次改没了', () => {
    const cases = [
      weeksFromRange(1, 16),
      weeksFromRange(1, 15, WeekParity.Odd),
      weeksFromRange(2, 16, WeekParity.Even),
      [1, 2, 5],
      [3, 4, 5, 9, 10],
      [1, 5, 9],
      [7],
    ];
    for (const weeks of cases) {
      expect(parseWeeks(weeksToText(weeks))?.weeks, weeksToText(weeks)).toEqual(weeks);
    }
  });

  it('等差但不是"整段单双周"的（1、5、9 周）不许念成 1-9周(单)', () => {
    expect(weeksToText([1, 5, 9])).toBe('1周,5周,9周');
  });
});

describe('replaceSession：改已有的一段', () => {
  it('只换被点的那一段，其余不动', () => {
    const sessions = [session({ weekday: 1 }), session({ weekday: 3, startPeriod: 5, endPeriod: 6 })];
    const next = replaceSession(sessions, 1, session({ weekday: 4, startPeriod: 9, endPeriod: 10 }));
    expect(next.map(sessionKey)).toEqual(['1-1-2', '4-9-10']);
  });

  it('周次跟着新的一段走（改节次不该顺手把周次冲掉）', () => {
    const sessions = [session({ weeks: [1, 3, 5] })];
    const next = replaceSession(sessions, 0, session({ startPeriod: 3, endPeriod: 4, weeks: [1, 3, 5] }));
    expect(next[0]!.weeks).toEqual([1, 3, 5]);
    expect(next[0]!.startPeriod).toBe(3);
  });

  it('改成跟另一段一模一样时合成一条（周次取并集），不摆两条一样的行', () => {
    const sessions = [session({ weeks: [1, 2, 3] }), session({ weekday: 3, weeks: [4, 5] })];
    const next = replaceSession(sessions, 1, session({ weekday: 1, weeks: [4, 5] }));
    expect(next).toHaveLength(1);
    expect(next[0]!.weeks).toEqual([1, 2, 3, 4, 5]);
  });

  it('地点不同就各留一条（换教室那几周不是重复）', () => {
    const sessions = [session({ location: '教A108' })];
    const next = replaceSession(sessions, 0, session({ location: '在线网络教室03' }));
    expect(next).toHaveLength(1);
    expect(next[0]!.location).toBe('在线网络教室03');
  });

  it('索引越界（列表已经变过）→ 原样返回，不抛也不改错一条', () => {
    const sessions = [session()];
    expect(replaceSession(sessions, 5, session({ weekday: 4 }))).toEqual(sessions);
    expect(replaceSession(sessions, -1, session({ weekday: 4 }))).toEqual(sessions);
  });

  it('拖课块正好落在同一门课的另一个块上 → 也合成一条（走的是同一套合并）', () => {
    const moved = moveSession(
      course('英语', [session({ weekday: 1, weeks: [1, 2] }), session({ weekday: 3, weeks: [3, 4] })]),
      '1-1-2',
      3,
      1,
    );
    expect(moved?.sessions).toHaveLength(1);
    expect(moved?.sessions[0]!.weeks).toEqual([1, 2, 3, 4]);
  });
});
