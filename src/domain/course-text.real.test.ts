/**
 * 真课表的回归测试 —— 数据是用户 2026-10-07 从教务系统导出的
 * 《艾粤希(2026-2027-1)课表.pdf》里抄出来的**原始格子文本**（一字未改）。
 *
 * 为什么要有这个文件：合成用例只能验证"我想得到的格式"，而这份数据里有
 * 两个合成用例想不出来的东西 ——
 *   ① 毛概同一节次的周次是**跳着**的（1-3、5-7、9-11、13-16 周），
 *      而 4、8、12 周换到"在线网络教室03"，同一门课同一格两条记录；
 *   ② 课名后面缀着课程性质标记（`*` 理论 / `&` 实验），同一门课的
 *      理论课与实验课是两个格子，靠掉标记才能合并成一门课。
 * 这两条都是真数据打回来才发现并改掉模型的（原来用"区间+单双周"存周次，
 * 表达不了①，而且会把②里后出现的那条当重复丢掉）。
 */
import { describe, expect, it } from 'vitest';

import { layoutSlots, weekGrid, describeWeeks } from './course';
import { parseCourseText } from './course-text';
import { createCourse, createTerm } from './factory';
import { DEFAULT_PERIODS } from './timetable';

/** 一行 = 一条上课安排：星期 + 那一格里教务系统写的全部内容 */
const raw = [
  '星期一\t学术英语（3）* (1-2节)1-16周/校区:南海/场地:教B112/教师:吕晨歌/教学班:25软工联培3班/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:64/周学时:4/总学时:64/学分:4.0',
  '星期一\t软件工程导论& (7-8节)2-16周(双)/校区:南海/场地:信205C/教师:陈赣浪/教学班:25软工联培2班(2026-2027-1)-20HA5250-04A/教学班组成:25软件工程(中外联合培养)2班/考核方式:未安排/选课备注:/课程学时组成:理论:32,实验:16/周学时:2/总学时:16/学分:2.5',
  '星期一\t形势与政策* (9-10节)11-12周/校区:南海/场地:教A209/教师:林德丰,朱宏邦/教学班:(2026-2027-1)-TSC15440-0109/教学班组成:25人工智能1班;25人工智能2班;25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考查/选课备注:/课程学时组成:理论:32/周学时:2/总学时:4/学分:2.0',
  '星期二\tWeb前端设计与开发* (1-2节)1-16周/校区:南海/场地:信205A/教师:彭丰平/教学班:25软工联培(2026-2027-1)-20HA4260-01/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考查/选课备注:/课程学时组成:理论:32,实验:32/周学时:2/总学时:32/学分:3.0',
  '星期二\tWeb前端设计与开发& (3-4节)1-16周/校区:南海/场地:信205A/教师:彭丰平/教学班:25软工联培(2026-2027-1)-20HA4260-01A/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:未安排/选课备注:/课程学时组成:理论:32,实验:32/周学时:2/总学时:32/学分:3.0',
  '星期二\t概率论与数理统计* (5-7节)1-16周/校区:南海/场地:教C302/教师:申淑媛/教学班:(2026-2027-1)-DLG31960-32/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:48/周学时:3/总学时:48/学分:3.0',
  '星期三\t毛泽东思想和中国特色社会主义理论体系概论* (1-3节)1-3周,5-7周,9-11周,13-16周/校区:南海/场地:教A108/教师:朱斌/教学班:(2026-2027-1)-TSC22960-24/教学班组成:2025/考核方式:未安排/选课备注:/课程学时组成:理论:48/周学时:3/总学时:48/学分:3.0',
  '星期三\t毛泽东思想和中国特色社会主义理论体系概论* (1-3节)4周,8周,12周/校区:南海/场地:在线网络教室03/教师:朱斌/教学班:(2026-2027-1)-TSC22960-24/教学班组成:2025/考核方式:未安排/选课备注:/课程学时组成:理论:48/周学时:3/总学时:48/学分:3.0',
  '星期三\t基础英语（3）* (5-6节)1-16周/校区:南海/场地:教B314/教师:吴小丽/教学班:25软工联培3班/教学班组成:2025/考核方式:未安排/选课备注:/课程学时组成:理论:32,实验:32/周学时:2/总学时:32/学分:2.0',
  '星期三\t学术英语（3）* (7-8节)1-16周/校区:南海/场地:教A208/教师:吕晨歌/教学班:25软工联培3班/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:64/周学时:4/总学时:64/学分:4.0',
  '星期四\t软件工程导论* (3-4节)1-16周/校区:南海/场地:教C405/教师:陈赣浪/教学班:25软工联培2班(2026-2027-1)-20HA5250-04/教学班组成:25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:32,实验:16/周学时:2/总学时:32/学分:2.5',
  '星期四\tJAVA语言程序设计* (5-6节)1-16周/校区:南海/场地:教C202/教师:王斐/教学班:25软工联培(2026-2027-1)-20H16164-01/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:32,实验:32/周学时:2/总学时:32/学分:3.0',
  '星期四\tJAVA语言程序设计& (7-8节)1-16周/校区:南海/场地:信303B/教师:王斐/教学班:25软工联培(2026-2027-1)-20H16164-01A/教学班组成:25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班/考核方式:未安排/选课备注:/课程学时组成:理论:32,实验:32/周学时:2/总学时:32/学分:3.0',
  '星期五\t数据结构与算法* (1-4节)1-16周/校区:南海/场地:教C402/教师:周成菊/教学班:25联培2班(2026-2027-1)-20H58270-04/教学班组成:25软件工程(中外联合培养)2班/考核方式:考试/选课备注:/课程学时组成:理论:48,实验:16/周学时:4/总学时:64/学分:3.5',
].join('\n');

const parse = () => parseCourseText(raw, { defaultWeeks: { start: 1, end: 16 } });

describe('真课表（2026-2027-1）解析', () => {
  it('14 条上课安排 → 9 门课，没有读不出来的东西', () => {
    const { courses, problems } = parse();
    expect(problems).toEqual([]);
    expect(courses.map((c) => c.title)).toEqual([
      '学术英语（3）',
      '软件工程导论',
      '形势与政策',
      'Web前端设计与开发',
      '概率论与数理统计',
      '毛泽东思想和中国特色社会主义理论体系概论',
      '基础英语（3）',
      'JAVA语言程序设计',
      '数据结构与算法',
    ]);
    expect(courses.reduce((sum, c) => sum + c.sessions.length, 0)).toBe(14);
    // 课名里的"（3）"要原样保留（别被半角化）
    expect(courses[0]!.title).toContain('（3）');
  });

  it('一门课的理论课与实验课合并成一门、两个时段', () => {
    const { courses } = parse();
    const java = courses.find((c) => c.title === 'JAVA语言程序设计')!;
    expect(java.sessions.map((s) => [s.weekday, s.startPeriod, s.endPeriod, s.location])).toEqual([
      [4, 5, 6, '教C202'],
      [4, 7, 8, '信303B'],
    ]);

    const english = courses.find((c) => c.title === '学术英语（3）')!;
    expect(english.sessions.map((s) => [s.weekday, s.startPeriod, s.location])).toEqual([
      [1, 1, '教B112'],
      [3, 7, '教A208'],
    ]);
  });

  it('跳着上的周次（毛概 1-3、5-7、9-11、13-16 周）原样保留，换教室那几周另成一条', () => {
    const { courses } = parse();
    const mao = courses.find((c) => c.title === '毛泽东思想和中国特色社会主义理论体系概论')!;
    expect(mao.sessions).toHaveLength(2);
    expect(mao.sessions[0]!.weeks).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16]);
    expect(mao.sessions[0]!.location).toBe('教A108');
    expect(mao.sessions[1]!.weeks).toEqual([4, 8, 12]);
    expect(mao.sessions[1]!.location).toBe('在线网络教室03');
    // 不能把没课的 4/8/12 周说成有课
    expect(describeWeeks(mao.sessions[0]!.weeks, 16)).toBe('第 1-3、5-7、9-11、13-16 周');
  });

  it('单双周：软件工程导论 周一 7-8 节是 2-16 周的双周', () => {
    const { courses } = parse();
    const intro = courses.find((c) => c.title === '软件工程导论')!;
    const monday = intro.sessions.find((s) => s.weekday === 1)!;
    expect(monday.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(monday.location).toBe('信205C');
    expect(describeWeeks(monday.weeks, 16)).toBe('第 2-16 周（双）');
  });

  it('教室、教师从"场地:/教师:"标签里取，不靠猜', () => {
    const { courses } = parse();
    const data = courses.find((c) => c.title === '数据结构与算法')!;
    expect(data.sessions[0]).toMatchObject({ weekday: 5, startPeriod: 1, endPeriod: 4, location: '教C402' });
    expect(data.teacher).toBe('周成菊');

    // 教师有两位
    const situation = courses.find((c) => c.title === '形势与政策')!;
    expect(situation.teacher).toBe('林德丰,朱宏邦');
    expect(situation.sessions[0]!.weeks).toEqual([11, 12]);
  });

  it('整学期上的课不会挂"没读到周次"的核对提示', () => {
    const { courses } = parse();
    for (const course of courses) expect(course.warnings).toEqual([]);
    const web = courses.find((c) => c.title === 'Web前端设计与开发')!;
    expect(describeWeeks(web.sessions[0]!.weeks, 16)).toBe('全学期');
  });
});

/**
 * 第二层：从"解析出来的课"一路走到"课表视图拿到什么"。
 *
 * 单看解析结果是对的，不代表画出来的课表是对的 —— 周次算成第几周、
 * 节次换成几点、周末那两列是不是空的，这些都只有把 course + term 喂给
 * weekGrid 才验证得到。这一层用的是同一份真数据。
 */
describe('真课表 → 课表视图（学期从 2026-09-07 周一算第 1 周）', () => {
  const term = createTerm({
    label: '2026-2027-1',
    startDayKey: '2026-09-07',
    totalWeeks: 16,
    periods: DEFAULT_PERIODS,
  });

  const courses = () =>
    parse().courses.map((draft) =>
      createCourse({
        title: draft.title,
        teacher: draft.teacher,
        location: draft.location,
        sessions: draft.sessions,
      }),
    );

  /** 第 5 周是 2026-10-05 ~ 10-11；第 4 周是 09-28 ~ 10-04 */
  const week5 = new Date(2026, 9, 5);
  const week4 = new Date(2026, 8, 28);

  it('一周 7 天，周末两列是空的', () => {
    const grid = weekGrid(courses(), week5, term);
    expect(grid).toHaveLength(7);
    expect(grid[5]!.slots).toEqual([]);
    expect(grid[6]!.slots).toEqual([]);
  });

  it('第 5 周周一只有学术英语 —— 导论是双周课，这周不上', () => {
    const grid = weekGrid(courses(), week5, term);
    expect(grid[0]!.slots.map((slot) => slot.course.title)).toEqual(['学术英语（3）']);
  });

  it('第 5 周周三三节，时刻由作息表换算（1-3 节 = 08:00–10:45）', () => {
    const wed = weekGrid(courses(), week5, term)[2]!;
    expect(wed.slots.map((slot) => slot.course.title)).toEqual([
      '毛泽东思想和中国特色社会主义理论体系概论',
      '基础英语（3）',
      '学术英语（3）',
    ]);
    expect([wed.slots[0]!.start, wed.slots[0]!.end]).toEqual([480, 645]);
    // 三节首尾错开，不该被判成撞课压成半宽
    expect(layoutSlots(wed.slots).map((item) => item.lanes)).toEqual([1, 1, 1]);
  });

  it('第 4 周周三毛概换到网课教室（同一格、另一条安排）', () => {
    const wed = weekGrid(courses(), week4, term)[2]!;
    expect(wed.slots[0]!.course.title).toBe('毛泽东思想和中国特色社会主义理论体系概论');
    expect(wed.slots[0]!.session.location).toBe('在线网络教室03');
  });

  it('第 4 周周一导论上（双周），第 5 周不上 —— 周次真的按周在变', () => {
    const mon4 = weekGrid(courses(), week4, term)[0]!;
    expect(mon4.slots.map((slot) => slot.course.title)).toEqual(['学术英语（3）', '软件工程导论']);
  });
});
