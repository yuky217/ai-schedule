import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCourseText } from './course-text';

/**
 * 两份**真数据**的回归：
 *
 * ① 从教务系统课表页**复制**出来的原文（`__fixtures__/jwgl-grid.txt`，
 *    用户学校那份，一字未改）。它的每一格有好几行、格与格之间没有任何分隔符，
 *    是"课表文本"里最难的一种。
 * ② App 内嵌浏览器**抓**回来的表格（一格多行用 U+2028 连着）—— 它带着星期，
 *    所以结果里不该有"待定"。
 *
 * 这两条路都要长期守着：解析器每动一次，先跑这里。
 */

const tab = (...cells: string[]) => cells.join('\t');
const INNER = '\u2028';
const cell = (...lines: string[]) => lines.join(INNER);

const fixture = readFileSync(
  path.join(process.cwd(), 'src/domain/__fixtures__/jwgl-grid.txt'),
  'utf8',
);

describe('教务课表页复制出来的原文（真数据）', () => {
  const { courses, problems } = parseCourseText(fixture);
  const byTitle = (title: string) => courses.find((course) => course.title === title)!;
  const pendingTotal = courses.reduce((n, course) => n + course.pending.length, 0);
  const sessionTotal = courses.reduce((n, course) => n + course.sessions.length, 0);

  it('整页读下来：10 门排了时间的课 + 2 门本来就没排时间的课', () => {
    expect(problems).toEqual([]);
    expect(courses).toHaveLength(12);
    expect(courses.filter((course) => course.pending.length).length).toBe(10);
    expect(
      courses.filter((course) => !course.sessions.length && !course.pending.length).map((c) => c.title),
    ).toEqual(['游戏基础设计', '面向大数据的信息检索技术实践和研究']);
  });

  it('15 段课一段不丢', () => {
    expect(pendingTotal + sessionTotal).toBe(15);
    expect(pendingTotal).toBe(15);
  });

  it('复制出来的文字里没有"哪一天"，所以每一段都是待定 —— 不猜，也不丢', () => {
    expect(sessionTotal).toBe(0);
    expect(courses.every((course) => course.pending.every((item) => item.startPeriod > 0))).toBe(true);
  });

  it('地点和教师：连"南海 健美操房"这种没有门牌号的也读到了（这条以前丢过）', () => {
    const pe = byTitle('大学体育（3）');
    expect(pe.teacher).toBe('刘俊');
    expect(pe.pending[0]?.location).toBe('南海 健美操房');
  });

  it('同一门课的两段分开算：学术英语 1-2 节、7-8 节各一段', () => {
    const english = byTitle('学术英语（3）');
    expect(english.pending.map((item) => `${item.startPeriod}-${item.endPeriod}`)).toEqual(['1-2', '7-8']);
    expect(english.pending[0]?.weeks).toHaveLength(16);
    expect(english.teacher).toBe('吕晨歌');
  });

  it('毛概在 4/8/12 周换教室：两段各留一条，周次不许并成一条', () => {
    const mao = byTitle('【调】毛泽东思想和中国特色社会主义理论体系概论');
    expect(mao.pending).toHaveLength(2);
    expect(mao.pending[0]?.location).toBe('南海 教A108');
    expect(mao.pending[1]?.weeks).toEqual([4, 8, 12]);
    expect(mao.pending[1]?.location).toBe('南海 在线网络教室03');
  });

  it('单双周读得出来（软件工程导论的实验课是双周）', () => {
    const intro = byTitle('软件工程导论');
    expect(intro.pending.map((item) => item.startPeriod)).toEqual([3, 7]);
    expect(intro.pending[1]?.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('晚上第 9-10 节的课照常读 —— 有晚课的课表不能被截在下午', () => {
    const politics = byTitle('形势与政策');
    expect(politics.pending[0]).toMatchObject({ startPeriod: 9, endPeriod: 10, weeks: [11, 12] });
  });

  it('每一段都带着节次和地点 —— 用户补星期时不用再回教务系统看', () => {
    for (const course of courses) {
      for (const item of course.pending) {
        expect(item.endPeriod, course.title).toBeGreaterThanOrEqual(item.startPeriod);
        expect(item.location, course.title).toBeTruthy();
      }
    }
  });
});

describe('App 内嵌浏览器抓回来的表格（一格多行，U+2028 连着）', () => {
  it('每一格落在它自己的那一天上，地点/教师/周次都读全', () => {
    const text = [
      tab('时间段', '节次', '星期一', '星期二', '星期三'),
      tab('', '第1-2节', cell('学术英语（3）*', '(1-2节)1-16周', '南海 教B112', '吕晨歌'), '', ''),
      tab('', '第5-6节', '', cell('大学体育（3）*', '(5-6节)1-17周', '南海 健美操房', '刘俊'), ''),
      tab('', '第7-8节', cell('学术英语（3）*', '(7-8节)1-16周', '南海 教A208', '吕晨歌'), '', ''),
    ].join('\n');

    const { courses, problems } = parseCourseText(text);
    expect(problems).toEqual([]);
    expect([...courses.map((course) => course.title)].sort()).toEqual(['大学体育（3）', '学术英语（3）'].sort());

    const pe = courses.find((course) => course.title === '大学体育（3）')!;
    expect(pe.teacher).toBe('刘俊');
    expect(pe.sessions).toHaveLength(1);
    expect(pe.sessions[0]).toMatchObject({
      weekday: 2,
      startPeriod: 5,
      endPeriod: 6,
      location: '南海 健美操房',
    });
    expect(pe.pending).toEqual([]);

    const english = courses.find((course) => course.title === '学术英语（3）')!;
    expect(english.sessions.map((session) => session.weekday)).toEqual([1, 1]);
    expect(english.sessions.map((session) => session.startPeriod)).toEqual([1, 7]);
  });

  it('抓回来的"其他课程"表跟着一起进 —— 没排时间的课不能凭空消失', () => {
    const text = [
      tab('时间段', '节次', '星期一', '星期二', '星期三'),
      tab('', '第1-2节', cell('学术英语（3）*', '(1-2节)1-16周', '南海 教B112', '吕晨歌'), '', ''),
      tab('课程名称', '教师', '学分', '起止周', '上课时间', '上课地点', '选课时间'),
      tab('游戏基础设计', '舒纲旭', '0', '1-12周', '', '', '2026-06-13 15:11:26'),
    ].join('\n');

    const { courses } = parseCourseText(text);
    expect([...courses.map((course) => course.title)].sort()).toEqual(['学术英语（3）', '游戏基础设计'].sort());
    const game = courses.find((course) => course.title === '游戏基础设计')!;
    expect(game.sessions).toEqual([]);
    expect(game.warnings.join()).toContain('没有上课时间');
  });

  it('只有几天有课：空格子留着，课不会跑到隔壁那天去', () => {
    const text = [
      tab('时间段', '节次', '星期一', '星期二', '星期三'),
      tab('', '第9-10节', '', '', cell('形势与政策*', '(9-10节)11-12周', '南海 教A209', '林德丰,朱宏邦')),
    ].join('\n');
    const { courses } = parseCourseText(text);
    expect(courses[0]?.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 9, endPeriod: 10 });
    expect(courses[0]?.teacher).toBe('林德丰,朱宏邦');
  });
});
