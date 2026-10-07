/**
 * 粘贴形态的回归测试。
 *
 * 为什么要单独一个文件：解析主逻辑在 course-text.test.ts 里已经有一堆
 * 合成用例了，但"用户复制出来的文本到底长什么样"是另一码事 ——
 * 从 PDF 复制、从网页表格复制、只框选了课表中间的数据区，拿到的文字
 * 形态完全不同。这里拿**同一批真实格子**，按几种典型形态各喂一遍，
 * 锁住两件事：
 *   ① 认得出的时候，结果必须和"一行一门课"的基准**完全一致**；
 *   ② 认不出的时候，要说得清是缺星期、缺节次、还是两者对不上号
 *      （绝不能猜 —— 猜错星期会把整周的课挪到同一天，比认不出更糟）。
 */
import { describe, expect, it } from 'vitest';

import { parseCourseText } from './course-text';

/** 真课表里的原始格子内容（PDF 原件，一字未改） */
const CELL_A = '学术英语（3）* (1-2节)1-16周/校区:南海/场地:教B112/教师:吕晨歌/教学班:25软工联培3班';
const CELL_B = '软件工程导论& (7-8节)2-16周(双)/校区:南海/场地:信205C/教师:陈赣浪';
const CELL_C = '毛泽东思想和中国特色社会主义理论体系概论* (1-3节)1-3周,5-7周,9-11周,13-16周/校区:南海/场地:教A108/教师:朱斌';
const CELL_D = 'Web前端设计与开发* (1-2节)1-16周/校区:南海/场地:信205A/教师:彭丰平';
const CELL_E = '概率论与数理统计* (5-7节)1-16周/校区:南海/场地:教C302/教师:申淑媛';

const parse = (text: string) => parseCourseText(text, { defaultWeeks: { start: 1, end: 16 } });

/** 只比较"课名 → 每条安排"的形状，忽略 Map 的插入顺序 */
const shape = (text: string) => {
  const { courses } = parse(text);
  return Object.fromEntries(
    courses.map((course) => [
      course.title,
      course.sessions.map((s) => [s.weekday, s.startPeriod, s.endPeriod, s.location, s.weeks.join(',')]),
    ]),
  );
};

/** 基准形态：一行一门课，星期 + 内容用制表符隔开 */
const BASELINE = [
  ['星期一', CELL_A].join('\t'),
  ['星期一', CELL_B].join('\t'),
  ['星期二', CELL_D].join('\t'),
  ['星期二', CELL_E].join('\t'),
  ['星期三', CELL_C].join('\t'),
].join('\n');

describe('各种粘贴形态都要认到同一份课表', () => {
  it('基准：一行一门课（星期 + 制表符 + 内容）', () => {
    expect(Object.keys(shape(BASELINE))).toHaveLength(5);
  });

  it('星期单独成行，课程内容各自成行（从 PDF / 数据区复制的主形态）', () => {
    const text = ['星期一', CELL_A, CELL_B, '星期二', CELL_D, CELL_E, '星期三', CELL_C].join('\n');
    expect(shape(text)).toEqual(shape(BASELINE));
  });

  it('网格：表头一行多个星期，下面一行一个节次', () => {
    const text = [
      ['节次', '星期一', '星期二', '星期三'].join('\t'),
      ['1-2节', CELL_A, CELL_D, CELL_C].join('\t'),
      ['5-6节', '', CELL_E, ''].join('\t'),
      ['7-8节', CELL_B, '', ''].join('\t'),
    ].join('\n');
    expect(shape(text)).toEqual(shape(BASELINE));
  });

  it('竖版网格：星期在最左列、表头是节次', () => {
    const text = [
      ['节次', '1-2节', '3-4节', '5-6节', '7-8节'].join('\t'),
      ['星期一', CELL_A, '', '', CELL_B].join('\t'),
      ['星期二', CELL_D, '', CELL_E, ''].join('\t'),
      ['星期三', CELL_C, '', '', ''].join('\t'),
    ].join('\n');
    expect(shape(text)).toEqual(shape(BASELINE));
  });

  it('单空格分隔（PDF 阅读器把整行压成一行文字）', () => {
    const text = [
      `星期一 ${CELL_A}`,
      `星期一 ${CELL_B}`,
      `星期二 ${CELL_D}`,
      `星期二 ${CELL_E}`,
      `星期三 ${CELL_C}`,
    ].join('\n');
    expect(shape(text)).toEqual(shape(BASELINE));
  });
});

describe('认不出来的时候，要说清是缺了什么', () => {
  const problems = (text: string) => parse(text).problems.join(' / ');

  it('只复制了数据区、一个"星期X"都没有 → 直说缺星期，并告诉怎么补', () => {
    const text = [CELL_A, CELL_B, CELL_D, CELL_C, CELL_E].join('\n');
    const result = parse(text);
    expect(result.courses).toEqual([]);
    expect(problems(text)).toContain('星期');
    expect(problems(text)).toContain('表头');
  });

  it('星期挤在一起、课程在另一处 → 说"对不上号"，而不是赖到缺节次上', () => {
    const text = ['节次', '星期一', '星期二', '星期三', '星期四', '星期五', '', '1-2节', CELL_A, CELL_D].join('\n');
    const result = parse(text);
    expect(result.courses).toEqual([]);
    expect(problems(text)).toContain('对不上号');
  });

  it('认不出来时不要把课硬塞到某一天 —— 这是"猜错比认不出更糟"的那条线', () => {
    const text = ['星期一', '星期二', '星期三', '星期四', '星期五', '', '1-2节', CELL_A, CELL_D].join('\n');
    expect(parse(text).courses).toEqual([]);
  });
});

describe('课表下方"其他课程"：本来就没排时间，也该建出来', () => {
  it('两门无时间的课建出来，名字干净、老师从标记后面取到', () => {
    const text = [
      ['星期一', CELL_A].join('\t'),
      '其他课程：游戏基础设计#舒纲旭(共12周)/1-12周/无',
      '其他课程：面向大数据的信息检索技术实践和研究#田星(共16周)/1-16周/无',
    ].join('\n');
    const { courses, problems } = parse(text);

    expect(problems).toEqual([]);
    expect(courses.map((c) => c.title)).toEqual([
      '学术英语（3）',
      '游戏基础设计',
      '面向大数据的信息检索技术实践和研究',
    ]);

    const game = courses.find((c) => c.title === '游戏基础设计')!;
    expect(game.sessions).toEqual([]);
    expect(game.teacher).toBe('舒纲旭');
    expect(game.warnings.join('')).toContain('没有上课时间');

    // 有时间的课不该被误挂上"没有上课时间"
    expect(courses.find((c) => c.title === '学术英语（3）')!.warnings).toEqual([]);
  });
});
