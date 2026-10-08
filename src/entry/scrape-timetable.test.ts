import { afterEach, describe, expect, it } from 'vitest';

import { parseCourseText } from '@/domain/course-text';

import { scrapeTimetableInPage } from './scrape-timetable';

/**
 * 抓取脚本的单测。
 *
 * 它跑在**网页**里（拿不到打包器、也拿不到这个仓库的任何东西），
 * 所以只能自己在 node 里搭一个"够用的假 DOM"喂给它：元素要有
 * `textContent` / `innerText` / `getBoundingClientRect` / `parentNode`。
 * 真正要钉住的是**归位的算法** —— 哪一格算星期几、哪一格算第几节。
 */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FakeEl {
  own: string;
  box: Box;
  parentNode: FakeEl | null;
  children: FakeEl[];
  textContent: string;
  innerText: string;
  getBoundingClientRect(): Box;
}

/** 造一个元素：`own` 是它自己的文本（可以含换行 = 一格里的多行） */
function el(own: string, box: Box, children: FakeEl[] = []): FakeEl {
  const node = {
    own,
    box,
    children,
    parentNode: null as FakeEl | null,
  } as FakeEl;
  for (const child of children) child.parentNode = node;
  Object.defineProperty(node, 'textContent', {
    get: () => own + children.map((child) => child.textContent).join(''),
  });
  Object.defineProperty(node, 'innerText', {
    get: () => [own, ...children.map((child) => child.innerText)].filter(Boolean).join('\n'),
  });
  node.getBoundingClientRect = () => box;
  return node;
}

interface FakeTable {
  rows: { cells: FakeEl[]; textContent: string }[];
}

function table(cellRows: FakeEl[][]): FakeTable {
  return {
    rows: cellRows.map((cells) => ({
      cells,
      textContent: cells.map((c) => c.textContent).join(''),
    })),
  };
}

let posted: string[] = [];

/** 把假 DOM 装上；返回"从 root 出发按文档顺序摊平的所有元素"（父在子前） */
function mount(roots: FakeEl[], tables: FakeTable[] = []) {
  const body = el('', { left: 0, top: 0, width: 1000, height: 2000 });
  for (const root of roots) {
    root.parentNode = body;
    body.children.push(root);
  }
  const flat: FakeEl[] = [];
  const walk = (node: FakeEl) => {
    flat.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);

  const doc = {
    title: '课表查询',
    body,
    querySelectorAll: (selector: string) => {
      if (selector === 'iframe') return [];
      if (selector === 'table') return tables;
      return flat;
    },
  };
  posted = [];
  (globalThis as unknown as { document: unknown }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
  };
  (globalThis as unknown as { location: unknown }).location = {
    href: 'https://jw.example.edu.cn/kbcx',
  };
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { location?: unknown }).location;
});

/** 七个列头：按横坐标摆开（中心 120 / 220 / …） */
function dayHeads(days: string[]): FakeEl[] {
  return days.map((label, index) => el(label, { left: 80 + index * 100, top: 100, width: 80, height: 40 }));
}

function run(): Record<string, unknown> {
  return JSON.parse(scrapeTimetableInPage()) as Record<string, unknown>;
}

describe('在页面里抓课表：按位置归到星期/节次', () => {
  it('横向位置说了算：星期一那一列的格子落在星期一，且连同地点教师一起带出来', () => {
    const days = ['星期一', '星期二', '星期三', '星期四', '星期五'];
    const heads = dayHeads(days);
    // 表头故意乱序给进来：真正的次序要按横坐标算出来
    const scrambled = [heads[2]!, heads[0]!, heads[4]!, heads[3]!, heads[1]!];

    const cellOf = (lines: string, index: number) =>
      el(lines, { left: 85 + index * 100, top: 200, width: 70, height: 80 });
    const monday = cellOf('学术英语（3）*\n(1-2节)1-16周\n南海 教B112\n吕晨歌', 0);
    const tuesday = cellOf('Web前端设计与开发*\n(1-2节)1-16周\n南海 信205A\n彭丰平', 1);
    const thursday = cellOf('大学体育（3）*\n(5-6节)1-17周\n南海 健美操房\n刘俊', 3);
    // 外面还套了一层：只有最里层那一格算数
    const row = el('', { left: 80, top: 200, width: 480, height: 80 }, [monday, tuesday, thursday]);

    mount([...scrambled, row, el('节次', { left: 40, top: 200, width: 40, height: 80 }, [])]);

    const payload = run();
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(3);

    const text = String(payload.text);
    const [header] = text.split('\n');
    expect(header).toBe('时间段\t节次\t星期一\t星期二\t星期三\t星期四\t星期五');
    expect(text).toContain('\u2028'); // 一格里的多行没有被拆成多行
    expect(posted[0]).toBe(JSON.stringify(payload));

    const { courses, problems } = parseCourseText(text);
    expect(problems).toEqual([]);
    expect(courses.map((course) => course.title).sort()).toEqual(
      ['学术英语（3）', 'Web前端设计与开发', '大学体育（3）'].sort(),
    );
    const english = courses.find((course) => course.title === '学术英语（3）')!;
    expect(english.sessions[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2 });
    const web = courses.find((course) => course.title === 'Web前端设计与开发')!;
    expect(web.sessions[0]).toMatchObject({ weekday: 2, startPeriod: 1, endPeriod: 2 });
    const pe = courses.find((course) => course.title === '大学体育（3）')!;
    expect(pe.sessions[0]).toMatchObject({
      weekday: 4,
      startPeriod: 5,
      endPeriod: 6,
      location: '南海 健美操房',
    });
    expect(pe.teacher).toBe('刘俊');
    expect(courses.every((course) => course.pending.length === 0)).toBe(true);
  });

  it('格子自己没写节次时，退到"按纵坐标找左边的行标"', () => {
    const heads = dayHeads(['星期一', '星期二', '星期三']);
    const labels = [
      el('1', { left: 20, top: 120, width: 40, height: 30 }),
      el('5', { left: 20, top: 280, width: 40, height: 30 }),
    ];
    const first = el('大学体育（3）*\n1-17周\n南海 健美操房\n刘俊', {
      left: 85,
      top: 120,
      width: 70,
      height: 60,
    });
    const fifth = el('形势与政策*\n11-12周\n南海 教A209\n林德丰', {
      left: 285,
      top: 280,
      width: 70,
      height: 60,
    });
    mount([...heads, ...labels, first, fifth]);

    const payload = run();
    expect(payload.ok).toBe(true);
    const { courses } = parseCourseText(String(payload.text));
    const pe = courses.find((course) => course.title === '大学体育（3）')!;
    expect(pe.sessions[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 1 });
    const politics = courses.find((course) => course.title === '形势与政策')!;
    expect(politics.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 5, endPeriod: 5 });
    expect(politics.teacher).toBe('林德丰');
  });

  it('"其他课程"那张表里的小格不会被误当成课程（只有单行"1-12周"，不算一格）', () => {
    const heads = dayHeads(['星期一', '星期二', '星期三']);
    mount(
      [
        ...heads,
        el('1-12周', { left: 90, top: 400, width: 60, height: 20 }),
        el('游戏基础设计', { left: 90, top: 440, width: 90, height: 20 }),
      ],
      [],
    );
    const payload = run();
    // 一个课程格都没读到 —— 宁可说没读到，也不能编出一门假课
    expect(payload.ok).toBe(false);
    expect(String(payload.reason)).toContain('没读到课程格');
  });

  it('课表下面那张"其他课程"表跟着一起回来：没排时间的课不许消失', () => {
    const heads = dayHeads(['星期一', '星期二', '星期三']);
    const morning = el('学术英语（3）*\n(1-2节)1-16周\n南海 教B112\n吕晨歌', {
      left: 85,
      top: 200,
      width: 70,
      height: 60,
    });
    const extras = table([
      ['课程名称', '教师', '学分', '起止周', '上课时间', '上课地点', '选课时间'].map((t) =>
        el(t, { left: 0, top: 500, width: 60, height: 24 }),
      ),
      ['游戏基础设计', '舒纲旭', '0', '1-12周', '', '', '2026-06-13 15:11:26'].map((t) =>
        el(t, { left: 0, top: 530, width: 60, height: 24 }),
      ),
    ]);
    mount([...heads, morning], [extras]);

    const payload = run();
    expect(payload.ok).toBe(true);
    const { courses } = parseCourseText(String(payload.text));
    expect(courses.map((course) => course.title).sort()).toEqual(
      ['学术英语（3）', '游戏基础设计'].sort(),
    );
    const game = courses.find((course) => course.title === '游戏基础设计')!;
    expect(game.sessions).toEqual([]);
    expect(game.teacher).toBe('舒纲旭');
  });

  it('页面上没有"星期X"那一行时说话要说得明白', () => {
    mount([el('这是一张成绩单', { left: 10, top: 10, width: 300, height: 40 })]);
    const payload = run();
    expect(payload.ok).toBe(false);
    expect(String(payload.reason)).toContain('星期一');
    expect(payload.url).toBe('https://jw.example.edu.cn/kbcx');
  });

  it('只有两列星期（没排满）的页面也要认得出来', () => {
    const heads = dayHeads(['星期一', '星期二', '星期三', '星期四', '星期五']);
    const only = el('学术英语（3）*\n(1-2节)1-16周\n南海 教B112\n吕晨歌', {
      left: 385,
      top: 200,
      width: 70,
      height: 60,
    });
    mount([...heads, only]);
    const payload = run();
    expect(payload.ok).toBe(true);
    const { courses } = parseCourseText(String(payload.text));
    expect(courses[0]?.sessions[0]).toMatchObject({ weekday: 4, startPeriod: 1, endPeriod: 2 });
  });
});
