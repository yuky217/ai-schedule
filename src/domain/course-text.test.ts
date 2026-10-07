import { describe, expect, it } from 'vitest';

import { WeekParity } from './course';
import {
  columnRoles,
  describeDraft,
  labeledValue,
  parseClockSpan,
  parseCourseText,
  parsePeriodSpan,
  parseWeekdayToken,
  parseWeeks,
  stripCourseKindMark,
} from './course-text';

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

  it('周次：区间 / 单双周 / 单周', () => {
    expect(parseWeeks('1-16周')).toEqual({ weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], explicit: true });
    expect(parseWeeks('第5周')).toEqual({ weeks: [5], explicit: true });
    expect(parseWeeks('2-16周(双)')?.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(parseWeeks('1-16周(单)')?.weeks.slice(0, 4)).toEqual([1, 3, 5, 7]);
    expect(parseWeeks('单周', { start: 1, end: 8 })).toEqual({ weeks: [1, 3, 5, 7], explicit: false });
    expect(parseWeeks('双周', { start: 1, end: 8 })).toEqual({ weeks: [2, 4, 6, 8], explicit: false });
    expect(parseWeeks('高等数学')).toBeNull();
  });

  it('周次：**多段**（隔几周上一次，真课表里很常见）', () => {
    expect(parseWeeks('1-3周,5-7周,9-11周,13-16周')?.weeks).toEqual([
      1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16,
    ]);
    expect(parseWeeks('4周,8周,12周')?.weeks).toEqual([4, 8, 12]);
  });

  it('别把"双学位""周学时"这类词读成周次规则', () => {
    expect(parseWeeks('双学位概论')).toBeNull();
    expect(parseWeeks('理论:64/周学时:4/总学时:64/学分:4.0')).toBeNull();
  });

  it('钟点区间', () => {
    expect(parseClockSpan('08:00-09:40')).toEqual({ start: 480, end: 580 });
    expect(parseClockSpan('8:00~9:40')).toEqual({ start: 480, end: 580 });
    expect(parseClockSpan('第1-2节')).toBeNull();
  });

  it('标签取值（教务系统自己写的标签，比猜可靠）', () => {
    expect(labeledValue('校区:南海/场地:教B112/教师:吕晨歌', '场地|教室|地点')).toBe('教B112');
    expect(labeledValue('教师:林德丰,朱宏邦/教学班:xxx', '教师|老师', true)).toBe('林德丰,朱宏邦');
    expect(labeledValue('场地:无', '场地|教室|地点')).toBeNull();
    expect(labeledValue('没有标签的一段话', '场地|教室|地点')).toBeNull();
  });

  it('课程性质标记（* 理论 / # 实践 / & 实验）要掉，便于同一门课合并', () => {
    expect(stripCourseKindMark('学术英语（3）*')).toBe('学术英语（3）');
    expect(stripCourseKindMark('软件工程导论&')).toBe('软件工程导论');
    expect(stripCourseKindMark('游戏基础设计#')).toBe('游戏基础设计');
    expect(stripCourseKindMark('高等数学')).toBe('高等数学');
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

describe('教务系统文本 → 课程草稿（五种常见形态）', () => {
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
        weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        location: '教一101',
      },
    ]);

    const english = courses[1]!;
    expect(english.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 3, endPeriod: 4 });
    expect(english.sessions[0]!.weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(english.location).toBe('外语楼203');
  });

  it('没表头，也是一行一门课（制表符）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '1-16周', '教一101'));
    expect(courses).toHaveLength(1);
    expect(courses[0]!.title).toBe('高等数学');
    expect(courses[0]!.location).toBe('教一101');
    expect(courses[0]!.sessions[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
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

  it('**网格**：表头是星期、每格一门课（教务系统课表页全选复制就是这个形状）', () => {
    const text = [
      tab('时间段', '节次', '星期一', '星期二', '星期三', '星期四', '星期五'),
      tab('上午', '1', '高等数学 (1-2节)1-16周/场地:教一101/教师:张三', '大学英语 (1-2节)1-16周/场地:外语楼203/教师:李四', '', '', ''),
      tab('', '2', '', '', '', '', ''),
      tab('下午', '5', '', '', 'Java语言程序设计 (5-6节)1-16周/场地:教C202/教师:王斐', '', ''),
    ].join('\n');

    const { courses, problems } = parseCourseText(text);
    expect(problems).toEqual([]);
    expect(courses.map((c) => c.title).sort()).toEqual(['Java语言程序设计', '大学英语', '高等数学']);

    const math = courses.find((c) => c.title === '高等数学')!;
    expect(math.sessions[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
    expect(math.location).toBe('教一101');
    expect(math.teacher).toBe('张三');

    const java = courses.find((c) => c.title === 'Java语言程序设计')!;
    expect(java.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 5, endPeriod: 6 });
  });

  it('网格之后跟着普通文本时，网格要能退出（不能把后面整段吞掉）', () => {
    const text = [
      tab('星期一', '星期二', '星期三', '星期四', '星期五'),
      tab('高等数学 (1-2节)1-16周/场地:教一101', '', '', '', ''),
      '其他课程：游戏基础设计#舒纲旭(共12周)/1-12周/无',
      '大学物理 周四 3-4节 1-16周',
    ].join('\n');

    const { courses } = parseCourseText(text);
    const titles = courses.map((c) => c.title);
    expect(titles).toContain('高等数学');
    expect(titles).toContain('大学物理');
    expect(courses.find((c) => c.title === '大学物理')!.sessions[0]!.weekday).toBe(4);
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
    expect(courses[0]!.sessions[0]).toMatchObject({ startPeriod: 1, endPeriod: 2 });
    expect(courses[0]!.sessions[0]!.weeks.at(-1)).toBe(16);
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

  it('有周次没节次（实践/网课/时间待定）→ 说明白为什么没进课表', () => {
    const { courses, problems } = parseCourseText(tab('游戏基础设计#舒纲旭(共12周)', '1-12周', '无'));
    expect(courses).toEqual([]);
    expect(problems.join()).toContain('没读到上课节次');
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

  it('同一门课同一节次、**周次不同且地点相同** → 合成一条，周次取并集', () => {
    const text = [
      tab('高等数学', '周三', '1-3节', '1-3周,5-7周', '教A108'),
      tab('高等数学', '周三', '1-3节', '4周,8周', '教A108'),
    ].join('\n');
    const { courses } = parseCourseText(text);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.sessions).toHaveLength(1);
    expect(courses[0]!.sessions[0]!.weeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('同一门课同一节次、**换教室**那几周另成一条（真课表里的毛概）', () => {
    const text = [
      tab('毛泽东思想和中国特色社会主义理论体系概论*', '周三', '1-3节', '1-3周,5-7周,9-11周,13-16周', '教A108'),
      tab('毛泽东思想和中国特色社会主义理论体系概论*', '周三', '1-3节', '4周,8周,12周', '在线网络教室03'),
    ].join('\n');
    const { courses } = parseCourseText(text);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.title).toBe('毛泽东思想和中国特色社会主义理论体系概论');
    expect(courses[0]!.sessions).toHaveLength(2);
    expect(courses[0]!.sessions.map((s) => s.weeks)).toEqual([
      [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16],
      [4, 8, 12],
    ]);
    expect(courses[0]!.sessions.map((s) => s.location)).toEqual(['教A108', '在线网络教室03']);
  });

  it('理论课与实验课同名 → 合并成一门课的两个时段（`*`/`&` 标记不参与课名）', () => {
    const text = [
      tab('学术英语（3）*', '周一', '1-2节', '1-16周', '教B112'),
      tab('学术英语（3）&', '周三', '7-8节', '1-16周', '教A208'),
    ].join('\n');
    const { courses } = parseCourseText(text);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.title).toBe('学术英语（3）');
    expect(courses[0]!.sessions.map((s) => [s.weekday, s.startPeriod, s.location])).toEqual([
      [1, 1, '教B112'],
      [3, 7, '教A208'],
    ]);
  });

  it('没读到周次 → 按整学期补，并标记要核对（不偷偷替用户决定）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节', '教一101'));
    const draft = courses[0]!;
    expect(draft.sessions[0]!.weeks.at(0)).toBe(1);
    expect(draft.sessions[0]!.weeks.at(-1)).toBe(18);
    expect(draft.warnings).toContain('没读到周次，按整学期处理');
  });

  it('defaultWeeks 可覆盖（学期只有 16 周时）', () => {
    const { courses } = parseCourseText(tab('高等数学', '周一', '1-2节'), {
      defaultWeeks: { start: 1, end: 16 },
    });
    expect(courses[0]!.sessions[0]!.weeks.at(-1)).toBe(16);
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
    expect(describeDraft(courses[0]!, 18)).toBe('高等数学：周一 第1-2节 第 1-16 周（共 18 周）');
  });
});
