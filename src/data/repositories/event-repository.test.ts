/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { CaptureSource } from '@/domain/enums';
import { createEvent } from '@/domain/factory';

import { eventRepository } from './event-repository';

/**
 * 考试仓储的真实 SQL 测试。
 *
 * 只守一件事，但它是这一层唯一致命的那件事：**"替换导入"不能连手动建的
 * 一起清掉**。手动加的那几场恰恰是教务系统里查不到的（补考、重修、随堂测验），
 * 被静默清掉之后用户不会知道 —— 他下次注意到的时候，那场考试已经考完了。
 *
 * 这条只能靠真实 SQL 测：判断写在 `WHERE source <> 'manual'` 里，
 * 纯逻辑层看不见它。
 */

vi.mock('@/data/db/client', () => ({
  getDatabase: () => Promise.resolve((globalThis as { __testDb?: unknown }).__testDb),
  // createMany 走事务：内存库上 BEGIN/COMMIT 由 node:sqlite 自己管，
  // 这里把回调直接执行掉就等价（测试关心的不是事务，而是那条 WHERE）
  withTransaction: async <T>(fn: (db: unknown) => Promise<T>): Promise<T> =>
    fn((globalThis as { __testDb?: unknown }).__testDb),
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

beforeEach(async () => {
  const { adapter } = memoryDb();
  await bootstrapDatabase(adapter);
  (globalThis as { __testDb?: unknown }).__testDb = adapter;
});

/** 一场导入来的考试（教务系统那个来源） */
const imported = (title: string) =>
  createEvent({
    title,
    startAt: new Date(2026, 6, 8, 14, 30).toISOString(),
    endAt: new Date(2026, 6, 8, 16, 30).toISOString(),
    source: 'exam-import',
  });

/** 手动加的一场（补考 / 重修这类查不到的） */
const manual = (title: string) =>
  createEvent({
    title,
    startAt: new Date(2026, 6, 20, 9, 0).toISOString(),
    endAt: new Date(2026, 6, 20, 11, 0).toISOString(),
    source: CaptureSource.Manual,
  });

describe('eventRepository.softDeleteImported', () => {
  it('只清导入来的，手动加的一场都不动', async () => {
    await eventRepository.createMany([imported('高等数学'), imported('线性代数')]);
    await eventRepository.create(manual('高数补考'));

    await eventRepository.softDeleteImported();

    const left = await eventRepository.listAll();
    expect(left.map((event) => event.title)).toEqual(['高数补考']);
    expect(left[0]!.source).toBe(CaptureSource.Manual);
  });

  it('没有导入的考试时也照样安全（库里只剩手动的）', async () => {
    await eventRepository.create(manual('重修考试'));

    await eventRepository.softDeleteImported();

    expect((await eventRepository.listAll()).map((event) => event.title)).toEqual(['重修考试']);
  });

  it('替换之后还能再导入 —— 清掉的确实是不再出现的那些', async () => {
    await eventRepository.createMany([imported('旧考试')]);
    await eventRepository.softDeleteImported();
    await eventRepository.createMany([imported('新考试')]);

    const left = await eventRepository.listAll();
    expect(left.map((event) => event.title)).toEqual(['新考试']);
  });

  it('手动建的那场能被 getById 查到（清完不是变成幽灵）', async () => {
    const keep = manual('随堂测验');
    await eventRepository.create(keep);
    await eventRepository.createMany([imported('高等数学')]);

    await eventRepository.softDeleteImported();

    expect(await eventRepository.getById(keep.id)).not.toBeNull();
  });
});

describe('eventRepository 的基本增删改', () => {
  it('手动建的考试默认就是 manual 来源，且能改时刻', async () => {
    const exam = createEvent({
      title: '补考',
      startAt: new Date(2026, 6, 20, 9, 0).toISOString(),
      endAt: null,
    });
    await eventRepository.create(exam);
    expect((await eventRepository.getById(exam.id))?.source).toBe(CaptureSource.Manual);

    const moved = new Date(2026, 6, 21, 9, 0).toISOString();
    await eventRepository.update(exam.id, { startAt: moved });
    expect((await eventRepository.getById(exam.id))?.startAt).toBe(moved);
  });

  it('删掉的考试不再出现在列表里', async () => {
    const exam = manual('删掉我');
    await eventRepository.create(exam);
    await eventRepository.softDelete(exam.id);

    expect(await eventRepository.listAll()).toEqual([]);
  });
});
