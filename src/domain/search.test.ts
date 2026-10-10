import { describe, expect, it } from 'vitest';

import { TimeAttribute } from './enums';
import { createContainer, createCourse, createIdea, createMark, createTask } from './factory';
import { searchAll } from './search';

/**
 * 全库搜索：一份纯函数，把"哪几个字段算数、怎么排序、空组怎么办"钉住。
 *
 * 这一层的价值不在"能不能搜到"（字符串匹配很难写错），而在**漏没漏字段** ——
 * 用户记得的常常是备注里那句、地点里那个词，或者某门课的老师名字。
 * 少搜一个字段，表现就是"我明明记得写过，却搜不出来"，且不会有任何报错。
 */

/** 固定时刻，方便断言"最近动过的排前面" */
const at = (day: number, hour = 9) =>
  new Date(2026, 9, day, hour, 0, 0, 0).toISOString();

describe('searchAll', () => {
  it('空关键词什么都不返回（不把整个库铺出来当结果）', () => {
    const tasks = [createTask({ title: '写周报' })];
    expect(searchAll('', { tasks })).toEqual([]);
    expect(searchAll('   ', { tasks })).toEqual([]);
  });

  it('一条都不命中就返回空数组', () => {
    const tasks = [createTask({ title: '写周报' })];
    expect(searchAll('打篮球', { tasks })).toEqual([]);
  });

  it('任务：标题命中', () => {
    const tasks = [createTask({ title: '写周报' }), createTask({ title: '买牛奶' })];
    const groups = searchAll('周报', { tasks });
    expect(groups.map((g) => g.title)).toEqual(['任务']);
    expect(groups[0].hits.map((h) => h.title)).toEqual(['写周报']);
  });

  it('任务：备注、地点、标签也算数（用户记得的常常是这些）', () => {
    const tasks = [
      createTask({ title: '甲', note: '顺带问一下报销流程' }),
      createTask({ title: '乙', location: '三教 302' }),
      createTask({ title: '丙', tags: ['论文'] }),
    ];

    expect(searchAll('报销', { tasks })[0].hits.map((h) => h.title)).toEqual(['甲']);
    expect(searchAll('302', { tasks })[0].hits.map((h) => h.title)).toEqual(['乙']);
    expect(searchAll('论文', { tasks })[0].hits.map((h) => h.title)).toEqual(['丙']);
  });

  it('大小写不敏感', () => {
    const tasks = [createTask({ title: 'Review PR' })];
    expect(searchAll('review', { tasks })[0].hits).toHaveLength(1);
    expect(searchAll('REVIEW', { tasks })[0].hits).toHaveLength(1);
  });

  it('分组顺序固定：任务 → 项目 → 课程 → 纪念日 → 想法', () => {
    const groups = searchAll('预算', {
      // 故意乱序传进去：组的先后由 domain 决定，不依赖调用方的顺序
      ideas: [createIdea('预算怎么分')],
      marks: [createMark({ title: '预算日', date: '2026-10-20' })],
      courses: [createCourse({ title: '预算课' })],
      containers: [createContainer({ title: '预算项目' })],
      tasks: [createTask({ title: '做预算' })],
    });
    expect(groups.map((g) => g.key)).toEqual(['task', 'container', 'course', 'mark', 'idea']);
  });

  it('空组不显示（一个空标题只会让人以为没加载出来）', () => {
    const groups = searchAll('周报', {
      tasks: [createTask({ title: '写周报' })],
      containers: [createContainer({ title: '毕业论文' })],
      ideas: [createIdea('买牛奶')],
    });
    expect(groups.map((g) => g.key)).toEqual(['task']);
  });

  it('组内按最近动过倒序', () => {
    const older = { ...createTask({ title: '周报 旧' }), updatedAt: at(1) };
    const newer = { ...createTask({ title: '周报 新' }), updatedAt: at(9) };
    const groups = searchAll('周报', { tasks: [older, newer] });
    expect(groups[0].hits.map((h) => h.title)).toEqual(['周报 新', '周报 旧']);
  });

  describe('每类实体的那一行小字', () => {
    it('任务：全天说"全天"，没定时间直说，有时间给日期时刻', () => {
      const allDay = createTask({
        title: '全天的事',
        time: {
          attribute: TimeAttribute.Fixed,
          startAt: at(6, 0),
          endAt: at(6, 23),
          dueAt: null,
          allDay: true,
        },
      });
      const untimed = createTask({ title: '没时间的事' });
      const timed = createTask({
        title: '有时间的事',
        time: { attribute: TimeAttribute.Fixed, startAt: at(6, 14), endAt: null, dueAt: null },
      });

      const hits = searchAll('的事', { tasks: [allDay, untimed, timed] })[0].hits;
      const byTitle = new Map(hits.map((h) => [h.title, h.subtitle]));
      expect(byTitle.get('全天的事')).toBe('全天');
      expect(byTitle.get('没时间的事')).toBe('还没定时间');
      // 具体时刻不写死格式，只要求它落到那一行上（换格式不该让这条变红）
      expect(byTitle.get('有时间的事')).toContain('14:00');
    });

    it('课程：老师和地点拼一行，都没有就不显示', () => {
      const groups = searchAll('高数', {
        courses: [
          createCourse({ title: '高数', teacher: '张老师', location: '三教' }),
          createCourse({ title: '高数习题课' }),
        ],
      });
      const byTitle = new Map(groups[0].hits.map((h) => [h.title, h.subtitle]));
      expect(byTitle.get('高数')).toBe('张老师 · 三教');
      expect(byTitle.get('高数习题课')).toBeUndefined();
    });

    it('纪念日：日期按本地时区解析（跨时区不会偏成前一天）', () => {
      const groups = searchAll('生日', {
        marks: [createMark({ title: '妈妈生日', date: '2026-10-20' })],
      });
      expect(groups[0].hits[0].subtitle).toBe('10月20日');
    });
  });

  it('五类都搜得到（各自用自己该搜的字段）', () => {
    const groups = searchAll('张', {
      tasks: [createTask({ title: '找张老师签字' })],
      containers: [createContainer({ title: '张的项目' })],
      courses: [createCourse({ title: '专业课', teacher: '张老师' })],
      marks: [createMark({ title: '张的生日', date: '2026-10-20' })],
      ideas: [createIdea('问问张老师那个思路')],
    });
    expect(groups.map((g) => g.key)).toEqual(['task', 'container', 'course', 'mark', 'idea']);
  });

  it('想法：正文和标签都能搜', () => {
    const ideas = [createIdea('做一个记账小工具')];
    expect(searchAll('记账', { ideas })[0].hits).toHaveLength(1);
    expect(searchAll('工具', { ideas })[0].hits).toHaveLength(1);
    expect(searchAll('记账小工具', { ideas })[0].hits).toHaveLength(1);
  });

  it('一份数据都不传 → 空数组（搜索页刚打开的样子）', () => {
    expect(searchAll('周报', {})).toEqual([]);
  });
});
