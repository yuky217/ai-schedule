/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { TABLES } from '@/data/db/schema';
import { weeksFromRange, WeekParity, type Course } from '@/domain/course';
import { createCourse, createTerm } from '@/domain/factory';
import { DEFAULT_PERIODS } from '@/domain/timetable';

import { courseRepository } from './course-repository';
import { termRepository } from './term-repository';

/**
 * 课程 / 学期仓储的单测 —— 用 node:sqlite 内存库跑**真实 SQL**。
 *
 * 盯的是"写进去再读回来还是不是原来那条"。课表的时段存在 sessions_json 里，
 * 一旦映射层把周次当成"区间 + 单双周"处理（改模型之前就是这么存的），
 * 或者 JSON 读写时把 weeks 弄丢，界面上就是**整张课表少几周的课** ——
 * 这种错在纯逻辑测试里看不见（逻辑层拿到的对象永远是对的），
 * 只有真写一次库、再读回来才会暴露。
 */

vi.mock('@/data/db/client', () => ({
  getDatabase: () => Promise.resolve((globalThis as { __testDb?: unknown }).__testDb),
}));

interface TestDb extends BootstrapDb {
  getAllAsync<T>(source: string, params?: SqlParams): Promise<T[]>;
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
}

function memoryDb(): { db: DatabaseSync; adapter: TestDb } {
  const db = new DatabaseSync(':memory:');
  const adapter: TestDb = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, params: SqlParams = []) =>
      (db.prepare(sql).get(...params) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, params: SqlParams = []) =>
      db.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, params: SqlParams = []) => db.prepare(sql).run(...params),
    withTransactionAsync: async (work) => {
      db.exec('BEGIN');
      try {
        await work();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { db, adapter };
}

const testDb = (): TestDb => (globalThis as { __testDb?: unknown }).__testDb as TestDb;

beforeEach(async () => {
  const { adapter } = memoryDb();
  (globalThis as { __testDb?: unknown }).__testDb = adapter;
  await bootstrapDatabase(adapter);
});

/** 往库里塞一行学期原始数据（模拟历史/手改产生的行） */
async function insertRawTerm(row: {
  label: string;
  startDayKey: string;
  totalWeeks: number;
  periodsJson?: string;
  deletedAt?: string | null;
}): Promise<void> {
  await testDb().runAsync(
    `INSERT INTO ${TABLES.terms}
       (id, label, start_day_key, total_weeks, periods_json, created_at, updated_at, deleted_at, remote_id, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'local')`,
    [
      `term-${row.label}`,
      row.label,
      row.startDayKey,
      row.totalWeeks,
      row.periodsJson ?? '[]',
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      row.deletedAt ?? null,
    ],
  );
}

/** 毛概：同一节次、跳着上的周次，且换教室那几周是另一条 */
const mao = (): Course =>
  createCourse({
    title: '毛泽东思想和中国特色社会主义理论体系概论',
    teacher: '朱斌',
    sessions: [
      {
        weekday: 3,
        startPeriod: 1,
        endPeriod: 3,
        weeks: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16],
        location: '教A108',
      },
      { weekday: 3, startPeriod: 1, endPeriod: 3, weeks: [4, 8, 12], location: '在线网络教室03' },
    ],
  });

describe('courseRepository', () => {
  it('写进去再读出来：周次数组（含跳着上的那几周）原样回来', async () => {
    await courseRepository.create(mao());
    const [saved] = await courseRepository.listAll();
    expect(saved!.title).toBe('毛泽东思想和中国特色社会主义理论体系概论');
    expect(saved!.teacher).toBe('朱斌');
    expect(saved!.sessions).toHaveLength(2);
    expect(saved!.sessions[0]!.weeks).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16]);
    expect(saved!.sessions[1]!.weeks).toEqual([4, 8, 12]);
    expect(saved!.sessions[1]!.location).toBe('在线网络教室03');
    // 配色由课名决定，不改课名就不该换色
    expect(saved!.colorIndex).toBe(mao().colorIndex);
  });

  it('单双周课：存下来的就是偶数周列表，不是"区间 + 双周"', async () => {
    await courseRepository.create(
      createCourse({
        title: '软件工程导论',
        sessions: [
          {
            weekday: 1,
            startPeriod: 7,
            endPeriod: 8,
            weeks: weeksFromRange(2, 16, WeekParity.Even),
            location: '信205C',
          },
        ],
      }),
    );
    const [saved] = await courseRepository.listAll();
    expect(saved!.sessions[0]!.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('批量导入走一个事务：一次写入多门课', async () => {
    await courseRepository.createMany([
      createCourse({ title: '高等数学', sessions: [{ weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] }] }),
      createCourse({ title: '大学英语', sessions: [{ weekday: 3, startPeriod: 3, endPeriod: 4, weeks: [1, 2] }] }),
    ]);
    expect(await courseRepository.count()).toBe(2);
  });

  it('软删除：listAll 不再返回，但行还在库里（可回退）', async () => {
    const course = mao();
    await courseRepository.create(course);
    await courseRepository.softDelete(course.id);
    expect(await courseRepository.listAll()).toEqual([]);
    const rows = await testDb().getAllAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLES.courses}`);
    expect(rows[0]!.n).toBe(1);
  });

  it('清空课表：全部软删除（重新导入整学期时用）', async () => {
    await courseRepository.createMany([createCourse({ title: 'A' }), createCourse({ title: 'B' })]);
    await courseRepository.softDeleteAll();
    expect(await courseRepository.listAll()).toEqual([]);
  });

  it('非法时段在写库前就被清掉（一个坏节次不该让整张课表画错位置）', async () => {
    await courseRepository.create(
      createCourse({
        title: '脏数据',
        sessions: [
          { weekday: 3, startPeriod: 3, endPeriod: 4, weeks: [1] },
          { weekday: 9, startPeriod: 3, endPeriod: 4, weeks: [1] },
          { weekday: 4, startPeriod: 5, endPeriod: 3, weeks: [1] },
          { weekday: 5, startPeriod: 1, endPeriod: 2, weeks: [] },
        ],
      }),
    );
    const [saved] = await courseRepository.listAll();
    expect(saved!.sessions).toHaveLength(1);
    expect(saved!.sessions[0]!.weekday).toBe(3);
  });
});

describe('termRepository：学期（开学日 / 总周数 / 作息表）', () => {
  it('没有学期时返回 null（由调用方决定怎么建）', async () => {
    expect(await termRepository.getCurrent()).toBeNull();
  });

  it('保存再读取：开学日、总周数、作息表都在', async () => {
    await termRepository.save(
      createTerm({ label: '2026-2027-1', startDayKey: '2026-09-07', totalWeeks: 16 }),
    );
    const term = await termRepository.getCurrent();
    expect(term).toMatchObject({ label: '2026-2027-1', startDayKey: '2026-09-07', totalWeeks: 16 });
    expect(term!.periods.length).toBe(DEFAULT_PERIODS.length);
  });

  it('**作息表丢了也要能画课表**：空作息回落到默认作息，而不是"课表整张消失"', async () => {
    await insertRawTerm({ label: '坏学期', startDayKey: '2026-09-07', totalWeeks: 16, periodsJson: '[]' });
    const term = await termRepository.getCurrent();
    expect(term).not.toBeNull();
    expect(term!.periods.length).toBeGreaterThan(0);
  });

  it('单例语义：同一个学期改一次，取到的是最新的值', async () => {
    const first = createTerm({ label: '2026-2027-1', startDayKey: '2026-09-07', totalWeeks: 16 });
    await termRepository.save(first);
    await termRepository.update(first.id, { startDayKey: '2026-09-14', totalWeeks: 18 });
    const term = await termRepository.getCurrent();
    expect(term).toMatchObject({ id: first.id, startDayKey: '2026-09-14', totalWeeks: 18 });
  });

  it('已软删除的学期不会被取到（避免"看不见但还在生效"）', async () => {
    await insertRawTerm({ label: '旧学期', startDayKey: '2026-02-23', totalWeeks: 18 });
    await testDb().runAsync(`UPDATE ${TABLES.terms} SET deleted_at = ?`, ['2026-03-01T00:00:00.000Z']);
    expect(await termRepository.getCurrent()).toBeNull();
  });
});
