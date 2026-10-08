import { describe, expect, it } from 'vitest';

import {
  applyCourseChange,
  changeAnchor,
  coursesOnDate,
  describeChange,
  dropCourseChange,
  makeCourseChange,
  maxSessionPeriod,
  nextCourse,
  sanitizeChanges,
  weekGrid,
  weeksFromRange,
  type Course,
  type CourseSession,
  type Term,
} from './course';
import { createCourse, createTerm } from './factory';
import { DEFAULT_PERIODS } from './timetable';
import { toDayKey } from '@/utils/datetime';

/**
 * 单次调课的守卫测试。
 *
 * 这里守的核心是**作用域**：`CourseSession` 管整学期，`CourseChange` 只管某一天那一次。
 * 最容易写错的两处：
 * ① 只按日期定位，于是"同一天有两段"时会把另一段一起改掉（`fromKey` 存在的唯一理由）；
 * ② 从"已经调过来的那一块"上再操作时，拿它现在的位置当身份，于是新建出第二条
 *    调整、原来那条还继续生效 —— 那节课会同时出现在两个地方。
 */

/** 2026-09-07 是周一 —— 学期第 1 周的周一 */
const TERM: Term = createTerm({
  label: '2026-2027-1',
  startDayKey: '2026-09-07',
  totalWeeks: 18,
  periods: DEFAULT_PERIODS,
});

const d = (month: number, day: number): Date => new Date(2026, month - 1, day);

function session(patch: Partial<CourseSession> = {}): CourseSession {
  return {
    weekday: 3,
    startPeriod: 3,
    endPeriod: 4,
    weeks: weeksFromRange(1, 16),
    location: null,
    ...patch,
  };
}

function course(patch: Partial<Course> = {}): Course {
  return createCourse({ title: '数据结构与算法', sessions: [session()], ...patch });
}

/** 第 2 周的周三（2026-09-16）—— "这一天的那一次"最常用的锚点 */
const WEEK2_WED = d(9, 16);
/** 第 2 周的周四 */
const WEEK2_THU = d(9, 17);
/** 第 3 周的周三 */
const WEEK3_WED = d(9, 23);

describe('单次调课：挪到别的日子', () => {
  it('原定那格让出来，目标那格多一次，别的周不受影响', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    expect(slot.change).toBeUndefined();

    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_THU, startPeriod: 5, endPeriod: 6 }),
    );

    expect(coursesOnDate([moved], WEEK2_WED, TERM)).toHaveLength(0);
    const target = coursesOnDate([moved], WEEK2_THU, TERM);
    expect(target).toHaveLength(1);
    expect(target[0]!.session.startPeriod).toBe(5);
    expect(target[0]!.session.endPeriod).toBe(6);
    expect(target[0]!.change?.kind).toBe('moved');
    // 调到的是"那一次"，不是整门课：第 3 周照旧在原位置
    const nextWeek = coursesOnDate([moved], WEEK3_WED, TERM);
    expect(nextWeek).toHaveLength(1);
    expect(nextWeek[0]!.change).toBeUndefined();
  });

  it('同一天只换节次：原来那格不重复出现，只在新节次上画一次', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_WED, startPeriod: 11, endPeriod: 12 }),
    );

    const slots = coursesOnDate([moved], WEEK2_WED, TERM);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.session.startPeriod).toBe(11);
  });

  it('看这一周时，课只出现一次（不会原格与新格各画一块）', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_THU, startPeriod: 5, endPeriod: 6 }),
    );
    const weekStart = d(9, 14); // 第 2 周周一
    const all = weekGrid([moved], weekStart, TERM).flatMap((day) => day.slots);
    expect(all).toHaveLength(1);
    expect(toDayKey(all[0]!.date)).toBe('2026-09-17');
  });
});

describe('单次停课', () => {
  it('默认不算"要上的课"，但课表格子那份带着标记还在', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const canceled = applyCourseChange(base, makeCourseChange(slot, { canceled: true }));

    expect(coursesOnDate([canceled], WEEK2_WED, TERM)).toHaveLength(0);
    const shown = coursesOnDate([canceled], WEEK2_WED, TERM, { includeCanceled: true });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.change?.kind).toBe('canceled');
    // 停的是"这一次"，不是这门课
    expect(coursesOnDate([canceled], WEEK3_WED, TERM)).toHaveLength(1);
  });

  it('课表那格必须留着 —— 否则用户没有地方点回去撤销', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const canceled = applyCourseChange(base, makeCourseChange(slot, { canceled: true }));
    const weekStart = d(9, 14);

    expect(weekGrid([canceled], weekStart, TERM).flatMap((day) => day.slots)).toHaveLength(0);
    const marked = weekGrid([canceled], weekStart, TERM, { includeCanceled: true }).flatMap(
      (day) => day.slots,
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]!.change?.kind).toBe('canceled');
  });

  it('停掉的那一次不会再被"下一节课"选中', () => {
    const base = createCourse({
      title: '大学物理',
      sessions: [
        session({ weekday: 3, startPeriod: 3, endPeriod: 4 }),
        session({ weekday: 5, startPeriod: 3, endPeriod: 4 }),
      ],
    });
    const now = new Date(2026, 8, 16, 0, 1); // 第 2 周周三刚过零点
    const wed = coursesOnDate([base], WEEK2_WED, TERM).find((s) => s.session.weekday === 3)!;
    const canceled = applyCourseChange(base, makeCourseChange(wed, { canceled: true }));

    expect(toDayKey(nextCourse([base], TERM, now)!.date)).toBe('2026-09-16');
    // 周三那次停掉了，下一节该轮到周五那次（09-18），而不是还指着周三
    expect(toDayKey(nextCourse([canceled], TERM, now)!.date)).toBe('2026-09-18');
  });
});

describe('身份：改的是"哪一次"', () => {
  it('同一天有两段时，只动被点的那一段', () => {
    const two = createCourse({
      title: '大学物理',
      sessions: [
        session({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
        session({ weekday: 1, startPeriod: 5, endPeriod: 6 }),
      ],
    });
    const monday = d(9, 14); // 第 2 周周一
    expect(coursesOnDate([two], monday, TERM)).toHaveLength(2);

    const first = coursesOnDate([two], monday, TERM).find((s) => s.session.startPeriod === 1)!;
    const canceled = applyCourseChange(two, makeCourseChange(first, { canceled: true }));

    const left = coursesOnDate([canceled], monday, TERM);
    expect(left).toHaveLength(1);
    expect(left[0]!.session.startPeriod).toBe(5);
    expect(canceled.changes).toHaveLength(1);
  });

  it('从"已经调过来的那一块"再操作，认的还是原定那一次', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_THU, startPeriod: 5, endPeriod: 6 }),
    );
    const movedSlot = coursesOnDate([moved], WEEK2_THU, TERM)[0]!;
    expect(changeAnchor(movedSlot)).toEqual(changeAnchor(slot));

    // 再改成"这一次不上"：是同一条记录换状态，不是又多出一条
    const canceled = applyCourseChange(moved, makeCourseChange(movedSlot, { canceled: true }));
    expect(canceled.changes).toHaveLength(1);
    expect(canceled.changes![0]!.kind).toBe('canceled');
    expect(coursesOnDate([canceled], WEEK2_WED, TERM)).toHaveLength(0);
    expect(coursesOnDate([canceled], WEEK2_THU, TERM)).toHaveLength(0);
    // 但课表格子那份仍然找得到它，能撤销
    expect(
      coursesOnDate([canceled], WEEK2_WED, TERM, { includeCanceled: true }),
    ).toHaveLength(1);
  });

  it('撤销之后完全恢复成整学期的样子', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_THU, startPeriod: 5, endPeriod: 6 }),
    );
    const back = dropCourseChange(moved, changeAnchor(slot));

    expect(back.changes).toEqual([]);
    expect(coursesOnDate([back], WEEK2_WED, TERM)).toHaveLength(1);
    expect(coursesOnDate([back], WEEK2_THU, TERM)).toHaveLength(0);
  });
});

describe('原安排后来没了', () => {
  it('调过来的那一次仍然在（不静默丢掉用户亲手排的一节课）', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_THU, startPeriod: 5, endPeriod: 6 }),
    );
    const orphan: Course = { ...moved, sessions: [] };

    const slots = coursesOnDate([orphan], WEEK2_THU, TERM);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.change?.kind).toBe('moved');
    expect(slots[0]!.session.weeks.length).toBeGreaterThan(0);
  });
});

describe('读库兜底与派生口径', () => {
  it('读不懂的行丢掉、同一身份只留最后一条、按日期排', () => {
    const cleaned = sanitizeChanges([
      { kind: 'canceled', dateKey: '不是日期', fromKey: '3-3-4' },
      { kind: 'canceled', dateKey: '2026-09-16', fromKey: '乱写' },
      {
        kind: 'moved',
        dateKey: '2026-09-16',
        fromKey: '3-3-4',
        toDateKey: '2026-09-17',
        startPeriod: 6,
        endPeriod: 5, // 结束节比开始节还小
      },
      {
        kind: 'moved',
        dateKey: '2026-09-23',
        fromKey: '3-3-4',
        toDateKey: '2026-09-24',
        startPeriod: 5,
        endPeriod: 6,
      },
      { kind: 'canceled', dateKey: '2026-09-30', fromKey: '3-3-4' },
      { kind: 'canceled', dateKey: '2026-09-16', fromKey: '3-3-4' },
    ]);

    expect(cleaned.map((item) => item.dateKey)).toEqual([
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
    expect(cleaned[0]!.kind).toBe('canceled'); // 同一身份，后写的赢
    expect(cleaned[1]!.kind).toBe('moved');
  });

  it('单次调课挪到更靠后的节次，也要算进"共几节"的下界', () => {
    const base = course();
    const slot = coursesOnDate([base], WEEK2_WED, TERM)[0]!;
    const moved = applyCourseChange(
      base,
      makeCourseChange(slot, { toDate: WEEK2_WED, startPeriod: 11, endPeriod: 12 }),
    );
    expect(maxSessionPeriod([base])).toBe(4);
    expect(maxSessionPeriod([moved])).toBe(12);
  });

  it('一句话说清调成什么样', () => {
    expect(describeChange({ kind: 'canceled', dateKey: '2026-09-16', fromKey: '3-3-4' })).toBe(
      '周三 第 3-4 节 这次不上',
    );
    expect(
      describeChange({
        kind: 'moved',
        dateKey: '2026-09-16',
        fromKey: '3-3-4',
        toDateKey: '2026-09-17',
        startPeriod: 5,
        endPeriod: 6,
      }),
    ).toBe('周三 第 3-4 节 → 周四 第 5-6 节');
    // 同一天换节次不能说成"改到周三"—— 日期没变，那样像换了一天
    expect(
      describeChange({
        kind: 'moved',
        dateKey: '2026-09-16',
        fromKey: '3-3-4',
        toDateKey: '2026-09-16',
        startPeriod: 5,
        endPeriod: 6,
      }),
    ).toBe('周三 第 3-4 节 改到 第 5-6 节');
  });
});
