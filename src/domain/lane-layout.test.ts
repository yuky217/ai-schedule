import { describe, expect, it } from 'vitest';

import { layoutLanes } from './lane-layout';

/**
 * 分道的唯一职责：重叠的并排、不重叠的不受影响。
 * 这三条是最容易被"顺手优化"改坏的，所以钉死在测试里。
 */
describe('layoutLanes', () => {
  const span = (start: number, end: number) => ({ start, end });

  it('完全不重叠：全部排在第 0 道，宽度不受影响', () => {
    const out = layoutLanes([span(9 * 60, 10 * 60), span(11 * 60, 12 * 60)]);
    expect(out.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('两件撞在同一时刻：分两半，各占一道', () => {
    const out = layoutLanes([span(9 * 60, 10 * 60), span(9 * 60 + 30, 10 * 60 + 30)]);
    expect(out.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('串在一条链上（A 撞 B、B 撞 C，A 不撞 C）：A 与 C 共用一道', () => {
    const out = layoutLanes([
      span(9 * 60, 10 * 60),
      span(9 * 60 + 30, 10 * 60 + 30),
      span(10 * 60 + 15, 11 * 60),
    ]);
    expect(out.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ]);
  });

  it('上午撞一次，不会把下午的事也压成半宽', () => {
    const out = layoutLanes([
      span(9 * 60, 10 * 60),
      span(9 * 60 + 30, 10 * 60 + 30),
      span(14 * 60, 15 * 60),
      span(16 * 60, 17 * 60),
    ]);
    expect(out.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
      [0, 1],
    ]);
  });

  it('首尾相接（前一个的终点 = 后一个的起点）不算重叠', () => {
    const out = layoutLanes([span(9 * 60, 10 * 60), span(10 * 60, 11 * 60)]);
    expect(out.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('空列表 → 空结果（不炸、也不编一条出来）', () => {
    expect(layoutLanes([])).toEqual([]);
  });

  it('自定义排序参与决策：起点相同的两件按传入的比较器定先后，顺序稳定', () => {
    const items = [
      { start: 540, end: 600, name: 'b' },
      { start: 540, end: 600, name: 'a' },
    ];
    const compare = (x: typeof items[number], y: typeof items[number]) =>
      x.start - y.start || x.name.localeCompare(y.name);
    const first = layoutLanes(items, compare);
    const second = layoutLanes([...items].reverse(), compare);
    expect(first.map((p) => p.item.name)).toEqual(second.map((p) => p.item.name));
    expect(first.map((p) => p.lane)).toEqual([0, 1]);
  });
});
