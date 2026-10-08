import { describe, expect, it } from 'vitest';

import { describeEvent, eventsOnDay } from './event';
import { parseExamText } from './exam-text';
import { createEvent } from './factory';

/**
 * 样本来自用户教务系统「考试信息查询」页的真实复制格式：
 * 制表符分隔的一行 = 一场考试，课程名前面是学年/学期两列，
 * 时间是 `2026-07-08(14:30-16:30)`，后面跟着教室、考试名称、班组……
 */
const REAL_ROW = (course: string, time: string, place: string): string =>
  ['2025-2026', '2', course, time, place, '2025-2026（2）', '25级工联技1班-2025-2026-2)-2GQG3', '试卷', '', '2GJ34962', '否', '南海', '人工智能学院', '25软工工程1班(中外段:1-2)'].join('\t');

/** 用户截图里的 9 场考试，一字不改 */
const REAL_EXAM_TEXT = [
  REAL_ROW('高等数学', '2026-07-08(14:30-16:30)', '教B216'),
  REAL_ROW('计算机系统结构', '2026-07-07(09:00-11:00)', '教B516'),
  REAL_ROW('面向对象程序设计', '2026-07-06(09:00-11:00)', '教B113'),
  REAL_ROW('形势与政策（2）', '2026-07-03(09:00-11:00)', '教C202'),
  REAL_ROW('习近平新时代中国特色社会主义思想', '2026-07-02(09:00-11:00)', '教A108'),
  REAL_ROW('概率论（2）', '2026-07-01(14:30-16:30)', '教C206'),
  REAL_ROW('中国近代史纲要', '2026-06-30(09:00-11:00)', '教B614'),
  REAL_ROW('大学英语（2）', '2026-06-29(14:00-16:30)', '教A108'),
  REAL_ROW('线性代数', '2026-06-29(09:00-11:00)', '教C402'),
].join('\n');

const iso = (y: number, mo: number, d: number, h: number, mi: number): string =>
  new Date(y, mo - 1, d, h, mi).toISOString();

describe('parseExamText：教务系统真实粘贴', () => {
  it('9 场考试全部认出，字段各就各位', () => {
    const { exams, problems } = parseExamText(REAL_EXAM_TEXT);
    expect(problems).toEqual([]);
    expect(exams).toHaveLength(9);

    const math = exams.find((e) => e.title === '高等数学');
    expect(math?.startAt).toBe(iso(2026, 7, 8, 14, 30));
    expect(math?.endAt).toBe(iso(2026, 7, 8, 16, 30));
    expect(math?.location).toBe('教B216');

    // 按开始时间升序：线性代数（6-29 上午）排最前
    expect(exams[0]!.title).toBe('线性代数');
    expect(exams[exams.length - 1]!.title).toBe('高等数学');
  });

  it('空格分隔（表格复制后制表符被拍平）同样认出', () => {
    const text = REAL_EXAM_TEXT.replace(/\t/g, ' ');
    const { exams } = parseExamText(text);
    expect(exams).toHaveLength(9);
    expect(exams.find((e) => e.title === '线性代数')?.location).toBe('教C402');
  });

  it('不带班级等噪音列的简洁行也认（用户手敲的格式）', () => {
    const { exams, problems } = parseExamText(
      '高等数学 2026-07-08(14:30-16:30) 教B216\n线性代数 2026-06-29(09:00-11:00) 教C402',
    );
    expect(problems).toEqual([]);
    expect(exams).toHaveLength(2);
    expect(exams[0]!.title).toBe('线性代数');
    expect(exams[1]!.location).toBe('教B216');
  });

  it('只有日期没有时段：记当天 0 点，并报一句说明', () => {
    const { exams, problems } = parseExamText('高等数学 2026-07-08 教B216');
    expect(exams[0]!.startAt).toBe(iso(2026, 7, 8, 0, 0));
    expect(exams[0]!.endAt).toBeNull();
    expect(problems.join('\n')).toContain('没带考试时间');
  });

  it('同一场复制两遍只留一条', () => {
    const text = `${REAL_EXAM_TEXT}\n${REAL_ROW('高等数学', '2026-07-08(14:30-16:30)', '教B216')}`;
    const { exams } = parseExamText(text);
    expect(exams).toHaveLength(9);
  });

  it('表头/页脚等没有日期的行静默跳过', () => {
    const { exams } = parseExamText(
      `学年\t学期\t课程名称\t考试时间\t考试地点\n${REAL_ROW('高等数学', '2026-07-08(14:30-16:30)', '教B216')}\n共 1 条`,
    );
    expect(exams).toHaveLength(1);
  });

  it('日期在行首（课程名缺失）→ 报 problem，不硬凑', () => {
    const { exams, problems } = parseExamText('2026-07-08(14:30-16:30) 教B216');
    expect(exams).toHaveLength(0);
    expect(problems.join('\n')).toContain('没认出课程名');
  });

  it('不存在的日期（13 月）→ 报 problem', () => {
    const { exams, problems } = parseExamText('高等数学 2026-13-08(14:30-16:30) 教B216');
    expect(exams).toHaveLength(0);
    expect(problems.join('\n')).toContain('日期不存在');
  });

  it('结束早于开始 → 丢掉止点并说明，不显示倒着的时段', () => {
    const { exams, problems } = parseExamText('高等数学 2026-07-08(16:30-14:30) 教B216');
    expect(exams[0]!.startAt).toBe(iso(2026, 7, 8, 16, 30));
    expect(exams[0]!.endAt).toBeNull();
    expect(problems.join('\n')).toContain('结束时间不比开始晚');
  });

  it('空白输入 → 没有 problem 也没有考试', () => {
    const { exams, problems } = parseExamText('   \n  ');
    expect(exams).toHaveLength(0);
    expect(problems).toEqual([]);
  });
});

describe('eventsOnDay / describeEvent', () => {
  const math = createEvent({
    title: '高等数学',
    location: '教B216',
    startAt: iso(2026, 7, 8, 14, 30),
    endAt: iso(2026, 7, 8, 16, 30),
  });
  const linear = createEvent({
    title: '线性代数',
    location: '教C402',
    startAt: iso(2026, 7, 8, 9, 0),
    endAt: iso(2026, 7, 8, 11, 0),
  });
  const other = createEvent({
    title: '大学英语',
    startAt: iso(2026, 6, 29, 14, 0),
  });

  it('按天过滤且按开始时刻排序', () => {
    const day = eventsOnDay([math, other, linear], new Date(2026, 6, 8));
    expect(day.map((e) => e.title)).toEqual(['线性代数', '高等数学']);
  });

  it('describeEvent：时段 + 地点；没有结束只给开始', () => {
    expect(describeEvent(math)).toBe('14:30–16:30 · 教B216');
    expect(describeEvent(other)).toBe('14:00');
  });
});
