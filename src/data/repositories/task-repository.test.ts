/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { TaskKind, TaskStatus, TimeAttribute } from '@/domain/enums';
import { createTask } from '@/domain/factory';
import type { Task } from '@/domain/task';

import { taskRepository } from './task-repository';

/**
 * 仓储（真实 SQL）的单测 —— 这是本项目**第一套数据层测试**。
 *
 * 为什么需要它：domain 层那 200 条用例全在纯逻辑里打转，而"任务查不到"这类 bug
 * 一条都抓不住 —— 它的成因根本不在逻辑里，而在 `WHERE` 子句里：
 * 收集箱带 `status != done`、日历带 `time_attribute != 'none'`、习惯页只取 `kind = habit`，
 * 各自看都合理，拼在一起就把一整类任务**同时排除在四个列表之外**。
 * 用户的表现就是"我勾了一下，它不见了"。
 *
 * 所以这里测的不是"函数返回什么"，而是**不变量**：
 * 任何一条没被删除的顶层任务，在任意状态下都必须能被某个列表查到。
 * 以后再加列表、再改过滤条件，这条不变量会替我们把关。
 */

vi.mock('@/data/db/client', () => ({
  // 仓储在这一层只会用到 getDatabase；真正连的是下面 beforeEach 塞进来的内存库
  getDatabase: () => Promise.resolve((globalThis as { __testDb?: unknown }).__testDb),
}));

interface TestDb extends BootstrapDb {
  getAllAsync<T>(source: string, params?: SqlParams): Promise<T[]>;
}

function memoryDb(): { db: DatabaseSync; adapter: TestDb } {
  const db = new DatabaseSync(':memory:');
  const adapter: TestDb = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, params: SqlParams) =>
      (db.prepare(sql).get(...params) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, params: SqlParams = []) =>
      db.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, params: SqlParams) => db.prepare(sql).run(...params),
  };
  return { db, adapter };
}

/** 无时间的执行型任务（收集箱里的样子） */
const untimed = () => createTask({ title: '写周报', kind: TaskKind.Execution });
/** 有固定时间的任务（日历上的样子） */
const scheduled = () =>
  createTask({
    title: '周会',
    kind: TaskKind.Schedule,
    time: {
      attribute: TimeAttribute.Fixed,
      startAt: '2026-10-06T06:00:00.000Z',
      endAt: '2026-10-06T07:00:00.000Z',
      dueAt: null,
    },
  });

beforeEach(async () => {
  const { adapter } = memoryDb();
  await bootstrapDatabase(adapter);
  (globalThis as { __testDb?: unknown }).__testDb = adapter;
});

describe('taskRepository 的查询口径', () => {
  it('待办的无时间任务在收集箱里', async () => {
    const task = untimed();
    await taskRepository.create(task);

    const inbox = await taskRepository.listInbox();
    expect(inbox.map((t) => t.id)).toEqual([task.id]);
    expect(await taskRepository.listRecentlyDone()).toEqual([]);
  });

  /**
   * 这条是本次的核心回归：勾掉之后它离开收集箱是**对的**（收集箱装的是待办），
   * 但它必须出现在别的地方 —— 否则"勾一下"就等于把任务弄丢了。
   */
  it('无时间的任务完成后：离开收集箱，但必须出现在「已完成」里（不能凭空消失）', async () => {
    const task = untimed();
    await taskRepository.create(task);
    await taskRepository.complete(task.id);

    expect(await taskRepository.listInbox()).toEqual([]);

    const done = await taskRepository.listRecentlyDone();
    expect(done.map((t) => t.id)).toEqual([task.id]);
    expect(done[0].status).toBe('done');
  });

  it('有时间的任务完成后靠日历兜底，不进「已完成」（否则同一件事出现在两处）', async () => {
    const task = scheduled();
    await taskRepository.create(task);
    await taskRepository.complete(task.id);

    expect(await taskRepository.listRecentlyDone()).toEqual([]);

    const onCalendar = await taskRepository.listScheduledBetween(
      '2026-10-06T00:00:00.000Z',
      '2026-10-07T00:00:00.000Z',
    );
    // 日历刻意不过滤状态：它回答"这段时间发生过什么"，已完成的也要画出来（灰的）
    expect(onCalendar.map((t) => t.id)).toEqual([task.id]);
  });

  it('软删除之后两边都不再收它（删掉就是删掉）', async () => {
    const task = untimed();
    await taskRepository.create(task);
    await taskRepository.complete(task.id);
    await taskRepository.softDelete(task.id);

    expect(await taskRepository.listRecentlyDone()).toEqual([]);
    expect(await taskRepository.listInbox()).toEqual([]);
    expect(await taskRepository.getById(task.id)).toBeNull();
  });

  it('子任务不进任何顶层列表（否则一件事会变成两行）', async () => {
    const parent = untimed();
    await taskRepository.create(parent);
    const child = createTask({ title: '子任务', kind: TaskKind.Execution, parentId: parent.id });
    await taskRepository.create(child);

    expect((await taskRepository.listInbox()).map((t) => t.id)).toEqual([parent.id]);
    expect((await taskRepository.listAll()).map((t) => t.id)).toEqual([parent.id]);
  });

  it('重新打开之后又回收集箱（撤销完成是个来回，不是单向门）', async () => {
    const task = untimed();
    await taskRepository.create(task);
    await taskRepository.complete(task.id);
    expect(await taskRepository.listInbox()).toEqual([]);

    await taskRepository.setStatus(task.id, TaskStatus.Todo);

    expect((await taskRepository.listInbox()).map((t) => t.id)).toEqual([task.id]);
    expect(await taskRepository.listRecentlyDone()).toEqual([]);
  });

  it('「已完成」按完成时间倒序，最近勾的在最上面', async () => {
    const older = untimed();
    const newer = untimed();
    await taskRepository.create(older);
    await taskRepository.create(newer);
    await taskRepository.complete(older.id);
    // complete() 写的是"此刻"，两条会撞在同一毫秒；显式错开一下
    await taskRepository.update(older.id, { completedAt: '2026-10-06T01:00:00.000Z' });
    await taskRepository.complete(newer.id);
    await taskRepository.update(newer.id, { completedAt: '2026-10-06T02:00:00.000Z' });

    const done = await taskRepository.listRecentlyDone();
    expect(done.map((t) => t.id)).toEqual([newer.id, older.id]);
  });
});

/**
 * 可达性扫描器。
 *
 * 上面那些用例是我"想到哪儿测到哪儿"，而这次两个 bug 的共性是：
 * **它们的组合我没想过**（"已完成 + 从没排过时间""有属性但没锚点"）。
 * 所以这里不猜具体组合，而是把三个维度**穷举一遍**，
 * 直接问："这条任务，用户从哪儿能看到它？"
 *
 * 之所以现在才写得出来：以前没有能在 node 里真跑的内存库，
 * 而这把扫描器的价值恰好全在"真的把数据存进去、再真的查出来"。
 */

/** 一条任务**此刻**能被哪些用户看得到的入口查到（等价于"用户翻到相应页面"） */
async function surfacesOf(task: Task): Promise<string[]> {
  const found: string[] = [];
  const has = (list: readonly Task[]) => list.some((item) => item.id === task.id);

  if (has(await taskRepository.listInbox())) found.push('收集箱');
  if (has(await taskRepository.listRecentlyDone())) found.push('收集箱·已完成');
  if (has(await taskRepository.listHabits())) found.push('习惯页');
  if (task.containerId && has(await taskRepository.listByContainer(task.containerId))) {
    found.push('容器页');
  }

  // 日历是"按窗口查"的：用覆盖它自己那一段（前后各一天余量）的窗口去问，
  // 等价于"用户翻到那一天"。锚点全空则日历无从问起 —— 那正是要抓的情况。
  const anchors = [task.time.startAt, task.time.dueAt].filter((v): v is string => Boolean(v));
  if (task.time.attribute !== TimeAttribute.None && anchors.length > 0) {
    const first = anchors.reduce((a, b) => (a < b ? a : b));
    const last = anchors.reduce((a, b) => (a > b ? a : b));
    const pad = 24 * 60 * 60 * 1000;
    const from = new Date(Date.parse(first) - pad).toISOString();
    const to = new Date(Date.parse(last) + pad).toISOString();
    if (has(await taskRepository.listScheduledBetween(from, to))) found.push('日历');
    if (has(await taskRepository.listToday(new Date(first)))) found.push('首页·今天');
  }

  return found;
}

describe('可达性扫描：每条任务都必须有个"看得见"的地方', () => {
  const STATUSES = [TaskStatus.Todo, TaskStatus.Doing, TaskStatus.Waiting, TaskStatus.Done];
  const KINDS = [TaskKind.Schedule, TaskKind.Execution, TaskKind.Habit];
  const TIMES = {
    无时间: { attribute: TimeAttribute.None, startAt: null, endAt: null, dueAt: null },
    固定时间: {
      attribute: TimeAttribute.Fixed,
      startAt: '2026-10-06T06:00:00.000Z',
      endAt: '2026-10-06T07:00:00.000Z',
      dueAt: null,
    },
    截止: {
      attribute: TimeAttribute.Deadline,
      startAt: null,
      endAt: null,
      dueAt: '2026-10-09T09:00:00.000Z',
    },
  };

  it('状态 × 类型 × 时间 全组合：没有一条会同时被所有列表排除', async () => {
    const holes: string[] = [];
    for (const status of STATUSES) {
      for (const kind of KINDS) {
        for (const [timeName, time] of Object.entries(TIMES)) {
          const task = createTask({ title: `${status}-${kind}-${timeName}`, kind, time });
          await taskRepository.create(task);
          if (status !== TaskStatus.Todo) await taskRepository.setStatus(task.id, status);

          if ((await surfacesOf(task)).length === 0) {
            holes.push(`${status} + ${kind} + ${timeName}`);
          }
        }
      }
    }
    expect(holes, `这些组合在全 App 都查不到：\n${holes.join('\n')}`).toEqual([]);
  });

  /**
   * 退化的时间：属性说"有时间"，两个锚点却都是空的。
   *
   * 正常路径产不出它，但**库里可能已经有**（早期版本写下的、导入的、手改的）。
   * 它最危险的地方是：收集箱用 `time_attribute = 'none'` 收人、日历用两个锚点收人，
   * 于是它两边都不沾 —— 而且它不会有任何报错，就是安静地消失。
   */
  it('有属性但两个锚点都空：也不能消失', async () => {
    for (const attribute of [TimeAttribute.Fixed, TimeAttribute.Deadline]) {
      const task = createTask({
        title: `空锚点-${attribute}`,
        kind: TaskKind.Execution,
        time: { attribute, startAt: null, endAt: null, dueAt: null },
      });
      await taskRepository.create(task);

      expect(await surfacesOf(task), `attribute=${attribute} 的任务全 App 都查不到`).not.toEqual([]);
    }
  });

  /**
   * 只有截止、没有起始的截止型任务：日历必须能画出来。
   * （查询用的是 `COALESCE(start_at, due_at)`，万一排序或筛选写成只看 start_at，这条就会消失。）
   */
  it('截止型（只有 dueAt、没有 startAt）在日历上', async () => {
    const task = createTask({
      title: '交方案',
      kind: TaskKind.Execution,
      time: {
        attribute: TimeAttribute.Deadline,
        startAt: null,
        endAt: null,
        dueAt: '2026-10-09T09:00:00.000Z',
      },
    });
    await taskRepository.create(task);

    const onCalendar = await taskRepository.listScheduledBetween(
      '2026-10-09T00:00:00.000Z',
      '2026-10-10T00:00:00.000Z',
    );
    expect(onCalendar.map((t) => t.id)).toEqual([task.id]);
  });
});

/**
 * 日历的取数判据是"时间窗重叠"，而重叠要**两端各取一个锚点**，
 * 只看开始锚点会漏掉跨午夜的事。
 */
describe('日历时间窗（判据 = 整段重叠）', () => {
  const overnight = () =>
    createTask({
      title: '通宵改稿',
      kind: TaskKind.Execution,
      time: {
        attribute: TimeAttribute.Fixed,
        startAt: '2026-10-06T22:30:00.000Z',
        endAt: '2026-10-07T01:00:00.000Z',
        dueAt: null,
      },
    });

  it('跨午夜的事在后一天也能查到（22:30 → 次日 01:00）', async () => {
    const task = overnight();
    await taskRepository.create(task);

    const day6 = await taskRepository.listScheduledBetween(
      '2026-10-06T00:00:00.000Z',
      '2026-10-07T00:00:00.000Z',
    );
    const day7 = await taskRepository.listScheduledBetween(
      '2026-10-07T00:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
    );

    expect(day6.map((t) => t.id)).toEqual([task.id]);
    // 只看开始锚点的话，这一天会是空的 —— 而用户记得自己凌晨在做它
    expect(day7.map((t) => t.id)).toEqual([task.id]);
  });

  /**
   * 反过来也要盯住：判据放宽之后不能变成"什么都能捞出来"。
   * 把两侧都开成 OR / 或者漏掉一半条件，这条会立刻变红。
   */
  it('窗口之外的事不会被顺带捞出来', async () => {
    const task = overnight();
    await taskRepository.create(task);

    const lastWeek = await taskRepository.listScheduledBetween(
      '2026-09-28T00:00:00.000Z',
      '2026-09-29T00:00:00.000Z',
    );
    const nextWeek = await taskRepository.listScheduledBetween(
      '2026-10-12T00:00:00.000Z',
      '2026-10-13T00:00:00.000Z',
    );

    expect(lastWeek).toEqual([]);
    expect(nextWeek).toEqual([]);
  });

  it('窗宽为零（就在那一秒问）也能被重叠判据接住', async () => {
    const task = overnight();
    await taskRepository.create(task);

    const at = await taskRepository.listScheduledBetween(
      '2026-10-07T00:30:00.000Z',
      '2026-10-07T00:30:00.000Z',
    );
    expect(at.map((t) => t.id)).toEqual([task.id]);
  });

  it('「有属性但没锚点」的数据进不了库：写的时候就被收口成没时间', async () => {
    const task = createTask({
      title: '半截时间',
      kind: TaskKind.Execution,
      time: { attribute: TimeAttribute.Fixed, startAt: null, endAt: null, dueAt: null },
    });
    await taskRepository.create(task);

    const stored = await taskRepository.getById(task.id);
    expect(stored?.time.attribute).toBe(TimeAttribute.None);
    expect((await taskRepository.listInbox()).map((t) => t.id)).toEqual([task.id]);
  });
});

/**
 * 地点（schema v8 加的列）。
 *
 * 这一组测的是**真实 SQL**，因为列名写错、mapper 漏映射这类错，tsc 一个字都不会报 ——
 * 它们只在跑起来的那一刻现形。库里存不住的行**就是没有**，用户不会收到任何报错。
 */
describe('地点：存得下，也读得回', () => {
  it('写进去的地点原样读回来（含引号这种容易被"清洗"掉的字符）', async () => {
    const task = createTask({
      title: '团委大会',
      kind: TaskKind.Schedule,
      location: '"一站式"学生社区211',
    });
    await taskRepository.create(task);

    expect((await taskRepository.getById(task.id))?.location).toBe('"一站式"学生社区211');
  });

  it('没填地点读出来是 null，不是空串', async () => {
    const task = untimed();
    await taskRepository.create(task);

    expect((await taskRepository.getById(task.id))?.location).toBeNull();
  });

  it('改地点与清空地点都落得下', async () => {
    const task = untimed();
    await taskRepository.create(task);

    await taskRepository.update(task.id, { location: '三教101' });
    expect((await taskRepository.getById(task.id))?.location).toBe('三教101');

    await taskRepository.update(task.id, { location: null });
    expect((await taskRepository.getById(task.id))?.location).toBeNull();
  });
});
