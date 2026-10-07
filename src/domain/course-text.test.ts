import { describe, expect, it } from 'vitest';

import {
  columnRoles,
  describeDraft,
  parseClockSpan,
  parseCourseText,
  parsePeriodSpan,
  parseWeekdayToken,
  parseWeekSpan,
} from './course-text';
import { WeekParity } from './course';

const tab = (...cells: string[]) => cells.join('\t');

describe('小解析器', () => {
  it('星期', () => {
    expect(parseWeekdayToken('周一')).toBe(1);
    expect(parseWeekdayToken('星期一')).toBe(1);
    expect(parseWeekdayToken('礼拜天')).toBe(0);
    expect(parseWeekdayToken('周日')).toBe(0);
    expect(parseWeekdayToken('周7')).toBe(0);
    expect(parseWeekdayToken('周三 1-2节')).toBe(3);
    expect(parseWeekdayToken('上周')).toBeNull();
    expect(parseWeekdayToken('高等数学')).toBeNull();
  });

  it('节次（含区间/顿号/单节）', () => {
    expect(parsePeriodSpan('1-2节')).toEqual({ start: 1, end: 2 });
    expect(parsePeriodSpan('第3~4节')).toEqual({ start: 3, end: 4 });
    expect(parsePeriodSpan('第1、2节')).toEqual({ start: 1, end: 2 });
    expect(parsePeriodSpan('第5节')).toEqual({ start: 5, end: 5 });
    expect(parsePeriodSpan('高等数学')).toBeNull();
  });

  it('周次（含单双周、只有单双周时用整学期兜住）', () => {
    expect(parseWeekSpan('1-16周', { start: 1, end: 18 })).toEqual({
      start: 1,
      end: 16,
      parity: WeekParity.All,
    });
    expect(parseWeekSpan('1-16周(单)', { start: 1, end: 18 })?.parity).toBe(WeekParity.Odd);
    expect(parseWeekSpan('2-16双周', { start: 1, end: 18 })?.parity).toBe(WeekParity.Even);
    expect(parseWeekSpan('第5周', { start: 1, end: 18 })).toEqual({
      start: 5,
      end: 5,
      parity: WeekParity.All,
    });
    expect(parseWeekSpan('单周', { start: 1, end: 18 })).toEqual({
      start: 1,
      end: 18,
      parity: WeekParity.Odd,
    });
    expect(parseWeekSpan('高等数学', { start: 1, end: 18 })).toBeNull();
  });

  it('钟点区间', () => {
    expect(parseClockSpan('08:00-09:40')).toEqual({ start: 480, end: 580 });
    expect(parseClockSpan('8:00~9:40')).toEqual({ start: 480, end: 580 });
    expect(parseClockSpan('第1-2节')).toBeNull();
  });

  it('表头角色：认得出才当表头（只认出 1 个列就不算，免得把数据行当表头吃掉）', () => {
    expect(columnRoles(['课程名称', '星期', '节次', '周次', '教室', '教师'])).toEqual([
      'name',
      'weekday',
      'period',
      'week',
      'location',
      'teacher',
    ]);
    expect(columnRoles(['高等数学', '周一', '1-2节', '1-16周', '教一101'])).toBeNull();
  });
});

describe('教务系统文本 → 课程草稿（四种常见形态）', () => {
  it('带表头的一行一门课（最可靠）', () => {
    const text = [
      tab('课程名称', '星期', '节次', '周次', '教室', '教师'),
      tab('高等数学', '周一', '1-2节', '1-16周', '教一101', '张三'),
      tab('大学英语', '周三', '3-4节', '1-16周(单)', '外语楼203', '李四'),
    ].join('\n');

    const { courses, problems } = parseCourseText(text);
    expect(problems).toEqual([]);
    expect(courses).toHaveLength(2);

    const math = courses[0]!;
    expect(math.title).toBe('高等数学');
    expect(math.teacher).toBe('张三');
    expect(math.location).toBe('教一101');
    expect(math.warnings).toEqual([]);
    expect(math.sessions).toEqual([
      {
        weekday: 1,
        startPeriod: 1,
        endPeriod: 2,
        startWeek: 1,
        endWeek: 16,
        parity: WeekParity.All,
        location: '教一101',
      },
    ]);

    const english = courses[1]!;
    expect(english.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 3, endPeriod: 4 });
    expect(english.sessions[0]!.parity).toBe(WeekParity.Odd);
    expect(english.location).toBe('外语楼203');
  });

  it('没表头，也是一行一门课（制表符）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '1-16周', '教一101'));
    expect(courses).toHaveLength(1);
    expect(courses[0]!.title).toBe('高等数学');
    expect(courses[0]!.location).toBe('教一101');
    expect(courses[0]!.sessions[0]).toMatchObject({ weekday: 1, startWeek: 1, endWeek: 16 });
  });

  it('卡片式：课程名、节次、教室、教师各占一行', () => {
    const text = [
      '高等数学',
      '周一 1-2节 1-16周',
      '教一101',
      '张三老师',
      '大学英语',
      '周三 3-4节 1-16周',
    ].join('\n');

    const { courses } = parseCourseText(text);
    expect(courses.map((c) => c.title)).toEqual(['高等数学', '大学英语']);
    expect(courses[0]!.location).toBe('教一101');
    expect(courses[0]!.teacher).toBe('张三老师');
    expect(courses[1]!.location).toBeNull();
    // 上一门的教室/教师不能串到下一门（卡片之间必须断干净）
    expect(courses[1]!.teacher).toBeNull();
  });

  it('整行压成单空格（浏览器全选复制常见）', () => {
    const { courses } = parseCourseText('高等数学 周一 1-2节 1-16周 教一101 张三老师');
    expect(courses).toHaveLength(1);
    expect(courses[0]!.title).toBe('高等数学');
    expect(courses[0]!.teacher).toBe('张三老师');
    expect(courses[0]!.sessions[0]!.weekday).toBe(1);
  });

  it('全角数字与中文括号也认', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '１-２节', '１-１６周'));
    expect(courses[0]!.sessions[0]).toMatchObject({ startPeriod: 1, endPeriod: 2, endWeek: 16 });
  });

  it('一串课里只有一半能认出来：认出来的照常出，剩下的说明白为什么不行', () => {
    const text = [tab('高等数学', '周一', '1-2节', '1-16周'), '随便一句没有课的话'].join('\n');
    const { courses, problems } = parseCourseText(text);
    expect(courses).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it('完全读不出来时给出明确说明（而不是静默返回空）', () => {
    const { courses, problems } = parseCourseText('今天天气不错\n随手记一笔');
    expect(courses).toEqual([]);
    expect(problems[0]).toContain('没从这段文字里读到');
  });
});

describe('解析出的草稿（导入前必须让用户核对的东西）', () => {
  it('同名课程的多天安排合并成一门课，按星期排序', () => {
    const text = [
      tab('高等数学', '周三', '3-4节', '1-16周'),
      tab('高等数学', '周一', '1-2节', '1-16周'),
    ].join('\n');
    const { courses } = parseCourseText(text);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.sessions.map((s) => s.weekday)).toEqual([1, 3]);
  });

  it('没读到周次 → 按整学期补，并标记要核对（不偷偷替用户决定）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '教一101'));
    const draft = courses[0]!;
    expect(draft.sessions[0]).toMatchObject({ startWeek: 1, endWeek: 18 });
    expect(draft.warnings).toContain('没读到周次，按整学期处理');
  });

  it('defaultWeeks 可覆盖（学期只有 16 周时）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节'), {
      defaultWeeks: { start: 1, end: 16 },
    });
    expect(courses[0]!.sessions[0]).toMatchObject({ startWeek: 1, endWeek: 16 });
  });

  it('fallbackWeekday：整列同一天（网格粘贴）时能补上星期', () => {
    const { courses } = parseCourseText(tab('3-4节', '1-16周', '大学物理'), { fallbackWeekday: 3 });
    expect(courses[0]!.title).toBe('大学物理');
    expect(courses[0]!.sessions[0]!.weekday).toBe(3);
  });

  it('每份草稿都留了原文，方便用户对照', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '1-16周'));
    expect(courses[0]!.raw[0]).toContain('高等数学');
  });

  it('describeDraft 给出可读的一行摘要', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '1-16周'));
    expect(describeDraft(courses[0]!, 18)).toBe('高等数学：周一 第1-2节 第1-16周（共 18 周）');
  });
});
