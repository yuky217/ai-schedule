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

/**
 * 这一段是第四轮改的：以前"没读到星期"一律丢掉，用户看到的是"一门课都没认出来"。
 * 现在改成 **认得出、但不替用户定星期** —— 该知道的（课名/节次/周次/地点/老师）
 * 全填好，只留那个真的猜不出来的问号，让用户点一下。
 * 所以断言从"courses 为空"变成了"sessions 为空"：
 * **"不猜"这条线没有松，松的是"不丢"。**
 */
describe('没读到星期时：不猜，但也不丢', () => {
  const problems = (text: string) => parse(text).problems.join(' / ');

  it('只复制了数据区、一个"星期X"都没有 → 五门课全认出来，标成待补', () => {
    const text = [CELL_A, CELL_B, CELL_D, CELL_C, CELL_E].join('\n');
    const result = parse(text);

    // 一条都不许丢：用户粘了半天，至少要看到"我认出了这 5 门"
    expect(result.courses.map((c) => c.title)).toEqual([
      '学术英语（3）',
      '软件工程导论',
      'Web前端设计与开发',
      '毛泽东思想和中国特色社会主义理论体系概论',
      '概率论与数理统计',
    ]);
    // 但一条 sessions 都不给 —— 星期留给用户点
    expect(result.courses.every((c) => c.sessions.length === 0)).toBe(true);
    expect(result.courses.every((c) => c.pending.length === 1)).toBe(true);
    // 猜不出来的只有星期；其余信息已经替他填好
    expect(result.courses[0]!.pending[0]).toMatchObject({
      startPeriod: 1,
      endPeriod: 2,
      location: '教B112',
    });
  });

  it('星期挤在一起、课程在另一处 → 不把五门课都塞到"星期五"上', () => {
    const text = ['节次', '星期一', '星期二', '星期三', '星期四', '星期五', '', '1-2节', CELL_A, CELL_D].join('\n');
    const result = parse(text);

    expect(result.courses.map((c) => c.title)).toEqual(['学术英语（3）', 'Web前端设计与开发']);
    // 这是"猜错比认不出更糟"那条线：五门课分属五天、文字里对不上号，
    // 就一条都不许硬塞 —— 宁可让用户点五下
    expect(result.courses.every((c) => c.sessions.length === 0)).toBe(true);
  });

  it('完全不像课表 → 还是直说，别硬挤出几门课来', () => {
    expect(parse('今天天气不错\n随手记一笔').courses).toEqual([]);
    expect(problems('今天天气不错\n随手记一笔')).toContain('不太像课表');
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

/**
 * 第五种形态：**教务系统页面上直接全选复制**。
 *
 * 这是用户 2026-10-07 报"识别不出来"时给的原件（一字未改）。它和前四种都不同：
 * 表头那行是制表符分隔的（"时间段 / 节次 / 星期一 … 星期日"），但**数据行不是** ——
 * 每个格子里的多行文字（课名、节次周次、地点、教师、班级、学时…）各占一行，
 * 格与格之间没有任何分隔符，**星期列的信息整个丢失了**。
 *
 * 所以这份文本注定认不出星期。但"认不出星期"不等于"认不出课"：
 * 课名、节次、周次、地点、教师全都在文字里。以前这些行会被整段丢掉，
 * 用户看到的是"粘了一大段、一门课都没认出来"，而问题出在"没带列"这件事
 * 他根本猜不到。现在全认出来、标成待补，让他点一下。
 */
const EAMS = `个人课表查询
*学年
*学期
其他课程：
课程名称\t教师\t学分\t起止周\t上课时间\t上课地点\t选课时间
游戏基础设计\t舒纲旭\t0\t1-12周\t\t\t2026-06-13 15:11:26
面向大数据的信息检索技术实践和研究\t田星\t0\t1-16周\t\t\t2026-09-09 18:42:35
2026-2027学年第1学期艾粤希的课表　学号：20254003081
*-理论&-实验#-实践注：红色斜体为待筛选，蓝色为已选上
时间段\t节次\t星期一\t星期二\t星期三\t星期四\t星期五\t星期六\t星期日
上午
1
学术英语（3）*
(1-2节)1-16周
南海 教B112
吕晨歌
25软工联培3班
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考试
理论:64
4
64
4.0
Web前端设计与开发*
(1-2节)1-16周
南海 信205A
彭丰平
25软工联培(2026-2027-1)-20HA4260-01
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考查
理论:32,实验:32
2
32
3.0
【调】毛泽东思想和中国特色社会主义理论体系概论*
(1-3节)1-3周,5-7周,9-11周,13-16周
南海 教A108
朱斌
(2026-2027-1)-TSC22960-24
2025
未安排
理论:48
3
48
3.0
【调】毛泽东思想和中国特色社会主义理论体系概论*
(1-3节)4周,8周,12周
南海 在线网络教室03
朱斌
(2026-2027-1)-TSC22960-24
2025
未安排
理论:48
3
48
3.0
数据结构与算法*
(1-4节)1-16周
南海 教C402
周成菊
25联培2班(2026-2027-1)-20H58270-04
25软件工程(中外联合培养)2班
考试
理论:48,实验:16
4
64
3.5
2
3
Web前端设计与开发&
(3-4节)1-16周
南海 信205A
彭丰平
25软工联培(2026-2027-1)-20HA4260-01A
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
未安排
理论:32,实验:32
2
32
3.0
软件工程导论*
(3-4节)1-16周
南海 教C405
陈赣浪
25软工联培2班(2026-2027-1)-20HA5250-04
25软件工程(中外联合培养)2班
考试
理论:32,实验:16
2
32
2.5
4
下午
5
大学体育（3）*
(5-6节)1-17周
南海 健美操房
刘俊
(2026-2027-1)-TSD5072c-0175
2025
未安排
普拉提
理论:4,实践:32
2
34
1.0
概率论与数理统计*
(5-7节)1-16周
南海 教C302
申淑媛
(2026-2027-1)-DLG31960-32
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考试
理论:48
3
48
3.0
基础英语（3）*
(5-6节)1-16周
南海 教B314
吴小丽
25软工联培3班
2025
未安排
理论:32,实验:32
2
32
2.0
JAVA语言程序设计*
(5-6节)1-16周
南海 教C202
王斐
25软工联培(2026-2027-1)-20H16164-01
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考试
理论:32,实验:32
2
32
3.0
6
7
软件工程导论&
(7-8节)2-16周(双)
南海 信205C
陈赣浪
25软工联培2班(2026-2027-1)-20HA5250-04A
25软件工程(中外联合培养)2班
未安排
理论:32,实验:16
2
16
2.5
学术英语（3）*
(7-8节)1-16周
南海 教A208
吕晨歌
25软工联培3班
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考试
理论:64
4
64
4.0
JAVA语言程序设计&
(7-8节)1-16周
南海 信303B
王斐
25软工联培(2026-2027-1)-20H16164-01A
25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
未安排
理论:32,实验:32
2
32
3.0
8
晚上
9
形势与政策*
(9-10节)11-12周
南海 教A209
林德丰,朱宏邦
(2026-2027-1)-TSC15440-0109
25人工智能1班;25人工智能2班;25软件工程(中外联合培养)1班;25软件工程(中外联合培养)2班
考查
理论:32
2
4
2.0
10
11`;

describe('教务系统页面直接复制（表格的列没跟着文本过来）', () => {
  const result = parse(EAMS);
  const byTitle = new Map(result.courses.map((course) => [course.title, course]));

  it('一门都不丢：10 门有安排的 + 2 门本来就没排时间的', () => {
    expect(result.courses).toHaveLength(12);
    expect(result.problems).toEqual([]);
  });

  it('课名要干净 —— 课名的位置绝不能被上一行残留的"考试/考查/未安排"顶掉', () => {
    // 课名带"（3）"和末尾的"*"，必须照样认出来
    expect(byTitle.has('学术英语（3）')).toBe(true);
    expect(byTitle.has('基础英语（3）')).toBe(true);
    expect(byTitle.has('大学体育（3）')).toBe(true);
    // 22 个字的课名也不能因为"太长"而认不出
    expect(byTitle.has('【调】毛泽东思想和中国特色社会主义理论体系概论')).toBe(true);
    // 这几个是教务系统的噪声行，绝不能变成课名
    for (const noise of ['考试', '考查', '未安排', '上午', '下午', '晚上', '普拉提', '节次']) {
      expect(byTitle.has(noise)).toBe(false);
    }
  });

  it('一条 sessions 都不给：整段没有星期，绝不猜', () => {
    expect(result.courses.every((c) => c.sessions.length === 0)).toBe(true);
    const pending = result.courses.reduce((n, c) => n + c.pending.length, 0);
    expect(pending).toBe(15);
  });

  it('猜不出的只有星期，其余信息都替他填好了', () => {
    const english = byTitle.get('学术英语（3）')!;
    expect(english.teacher).toBe('吕晨歌');
    expect(english.pending).toHaveLength(2);
    expect(english.pending[0]).toMatchObject({
      startPeriod: 1,
      endPeriod: 2,
      location: '南海 教B112',
    });
    // 一门课一周上两次、两个教室
    expect(english.pending[1]).toMatchObject({ startPeriod: 7, endPeriod: 8, location: '南海 教A208' });
  });

  it('跳着上的周次和"换教室"的分段都保住了', () => {
    const mao = byTitle.get('【调】毛泽东思想和中国特色社会主义理论体系概论')!;
    expect(mao.pending).toHaveLength(2);
    // 1-3、5-7、9-11、13-16 周在教A108
    expect(mao.pending[0]!.weeks).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16]);
    expect(mao.pending[0]!.location).toBe('南海 教A108');
    // 4、8、12 周换到网课教室 —— 分开成第二段，不能并进第一段
    expect(mao.pending[1]!.weeks).toEqual([4, 8, 12]);
    expect(mao.pending[1]!.location).toBe('南海 在线网络教室03');
  });

  it('双周课存成偶数列表；只上两周的课也只留那两周', () => {
    const intro = byTitle.get('软件工程导论')!;
    const biweekly = intro.pending.find((p) => p.startPeriod === 7)!;
    expect(biweekly.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);

    // 形势与政策只上 11、12 周
    expect(byTitle.get('形势与政策')!.pending[0]!.weeks).toEqual([11, 12]);
    // 大学体育上到第 17 周（比别的课多一周）
    expect(byTitle.get('大学体育（3）')!.pending[0]!.weeks).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  it('多字教师名连逗号一起取到；"其他课程"里那两门照旧没有时间', () => {
    expect(byTitle.get('形势与政策')!.teacher).toBe('林德丰,朱宏邦');
    expect(byTitle.get('数据结构与算法')!.teacher).toBe('周成菊');

    const game = byTitle.get('游戏基础设计')!;
    expect(game.sessions).toEqual([]);
    expect(game.pending).toEqual([]);
    expect(game.teacher).toBe('舒纲旭');
    expect(game.warnings.join('')).toContain('没有上课时间');
  });
});
