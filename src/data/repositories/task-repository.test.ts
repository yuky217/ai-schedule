/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { TaskKind, TaskStatus, TimeAttribute } from '@/domain/enums';
import { createTask } from '@/domain/factory';

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
