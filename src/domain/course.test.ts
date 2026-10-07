import { describe, expect, it } from 'vitest';

import {
  coursesOnDate,
  describePeriods,
  describeSession,
  describeSlot,
  describeSlotTiming,
  describeWeeks,
  isCourseActiveNow,
  isSessionActiveOnWeek,
  nextCourse,
  sanitizeSessions,
  sessionOccursOn,
  weekGrid,
  weekIndexOf,
  WeekParity,
  type Course,
  type CourseSession,
  type Term,
} from './course';
import { SyncState } from './enums';
import { DEFAULT_PERIODS } from './timetable';

/** 2026-09-07 是周一 —— 学期第 1 周的周一 */
const TERM: Term = { startDayKey: '2026-09-07', totalWeeks: 18, periods: DEFAULT_PERIODS };

const d = (y: number, m: number, day: number): Date => new Date(y, m - 1, day);
/** 某天的某个钟点（构造"现在"用） */
const at = (y: number, m: number, day: number, hour: number, minute = 0): Date =>
  new Date(y, m - 1, day, hour, minute);

function session(patch: Partial<CourseSession> = {}): CourseSession {
  return {
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    startWeek: 1,
    endWeek: 16,
    parity: WeekParity.All,
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

describe('isSessionActiveOnWeek：周次区间 + 单双周', () => {
  const odd = session({ startWeek: 1, endWeek: 16, parity: WeekParity.Odd });
  const even = session({ startWeek: 1, endWeek: 16, parity: WeekParity.Even });
  const all = session({ startWeek: 3, endWeek: 8, parity: WeekParity.All });

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
    expect(isSessionActiveOnWeek(all, 2)).toBe(false);
    expect(isSessionActiveOnWeek(all, 3)).toBe(true);
    expect(isSessionActiveOnWeek(all, 8)).toBe(true);
    expect(isSessionActiveOnWeek(all, 9)).toBe(false);
    expect(isSessionActiveOnWeek(odd, 17)).toBe(false);
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
    const oddMonday = session({ weekday: 1, parity: WeekParity.Odd });
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

  it('周次（含单双周 / 全学期）', () => {
    expect(describeWeeks(session({ startWeek: 1, endWeek: 16 }))).toBe('第 1-16 周');
    expect(describeWeeks(session({ startWeek: 1, endWeek: 16, parity: WeekParity.Odd }))).toBe(
      '第 1-16 周（单）',
    );
    expect(describeWeeks(session({ startWeek: 3, endWeek: 8 }))).toBe('第 3-8 周');
    expect(describeWeeks(session({ startWeek: 5, endWeek: 5 }))).toBe('第 5 周');
    expect(describeWeeks(session({ startWeek: 1, endWeek: 18 }), 18)).toBe('全学期');
  });

  it('整条安排', () => {
    const s = session({ weekday: 3, startPeriod: 3, endPeriod: 4, startWeek: 1, endWeek: 16, parity: WeekParity.Odd });
    expect(describeSession(s)).toBe('周三 第 3-4 节 · 第 1-16 周（单）');
  });

  it('某天的某一节（含钟点与地点）', () => {
    const c = course('大学物理', [session({ weekday: 3, startPeriod: 3, endPeriod: 4, location: '教一101' })]);
    const [slot] = coursesOnDate([c], d(2026, 10, 7), TERM);
    expect(slot).toBeDefined();
    expect(describeSlot(slot!, DEFAULT_PERIODS)).toBe('第 3-4 节 · 10:00–11:40 · 教一101');
  });
});

describe('sanitizeSessions：导入/手输进来的脏数据挡在门外', () => {
  it('丢掉星期非法、节次倒挂、周次倒挂的行，并按星期+节次排序', () => {
    const cleaned = sanitizeSessions([
      session({ weekday: 3, startPeriod: 3, endPeriod: 4 }),
      session({ weekday: 7 }),
      session({ weekday: 1, startPeriod: 5, endPeriod: 3 }),
      session({ weekday: 2, startWeek: 9, endWeek: 3 }),
      session({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
    ]);
    expect(cleaned.map((s) => [s.weekday, s.startPeriod])).toEqual([
      [1, 1],
      [3, 3],
    ]);
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
