/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  currentSchemaVersion,
  type BackupEnvelope,
  type BackupRow,
} from '@/data/backup/format';
import { importBackup } from '@/data/backup/import';
import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { TABLES } from '@/data/db/schema';

/**
 * 备份导入的数据层测试 —— 用内存库跑真实 SQL。
 *
 * 这一层盯两条不变量：
 * 1. **备份范围覆盖 schema 里所有用户表**。打卡表（task_checkins）是 v3 才加的，
 *    加表时忘了把它挂进 BACKUP_TABLES，恢复之后习惯连续天数、频率型达标
 *    全部蒸发 —— 这种"新表没进备份"的错，人眼盯 format.ts 盯不住，
 *    必须让 schema 和 BACKUP_TABLES 当面对质。
 * 2. **replace 导入是完整的清空重灌**：旧数据（含打卡、专注记录）不能留残骸。
 */

// import.ts / format.ts 的依赖链里带着 expo 的文件与选文件模块，
// 在 node 测试环境里会一路拽进 react-native（Flow 语法直接解析失败）。
// 这里只测纯数据路径，把它们掐成空壳。
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('expo-sharing', () => ({}));

vi.mock('@/data/db/client', () => {
  const testDb = () => (globalThis as { __testDb?: unknown }).__testDb;
  return {
    getDatabase: () => Promise.resolve(testDb()),
    withTransaction: async (work: (db: unknown) => Promise<unknown>): Promise<unknown> =>
      work(testDb()),
    // 与生产实现同序：子表在前、容器收尾（import.ts 的 replace 分支依赖它）
    clearAllTables: async (): Promise<void> => {
      const db = testDb() as {
        execAsync: (sql: string) => Promise<void>;
      };
      for (const table of [
        'task_checkins',
        'focus_sessions',
        'task_chains',
        'marks',
        'tasks',
        'ideas',
        'containers',
      ]) {
        await db.execAsync(`DELETE FROM ${table}`);
      }
    },
  };
});

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

describe('备份范围不变量', () => {
  it('BACKUP_TABLES 覆盖 schema 中除 app_meta 外的所有表', () => {
    const expected = Object.values(TABLES).filter((t) => t !== TABLES.meta);
    expect([...BACKUP_TABLES].sort()).toEqual([...expected].sort());
  });
});

function envelope(tables: Record<string, BackupRow[]>): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: currentSchemaVersion,
    exportedAt: '2026-10-07T00:00:00.000Z',
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    tables: tables as BackupEnvelope['tables'],
  };
}

describe('replace 导入', () => {
  it('打卡记录能随备份恢复', async () => {
    const db = (globalThis as { __testDb?: unknown }).__testDb as TestDb;
    await importBackup(
      envelope({
        [TABLES.checkins]: [
          {
            id: 'c1',
            task_id: 't1',
            day_key: '2026-10-07',
            minute_of_day: 480,
            note: null,
            created_at: '2026-10-07T00:00:00.000Z',
            updated_at: '2026-10-07T00:00:00.000Z',
            deleted_at: null,
            remote_id: null,
            sync_state: 'local',
          },
        ],
      }),
      'replace',
    );

    const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${TABLES.checkins}`);
    expect(rows.map((r) => r.id)).toEqual(['c1']);
  });

  it('清空旧数据不留残骸（旧任务、旧打卡一起走）', async () => {
    const db = (globalThis as { __testDb?: unknown }).__testDb as TestDb;
    await db.runAsync(
      `INSERT INTO ${TABLES.tasks} (id, title, kind, status, time_attribute, completion, tags_json, priority, source, progress_json, created_at, updated_at, sync_state)
       VALUES ('old', '旧任务', 'execution', 'todo', 'none', 'checkbox', '[]', 2, 'manual', '{"accumulatedMinutes":0}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'local')`,
      [],
    );
    await db.runAsync(
      `INSERT INTO ${TABLES.checkins} (id, task_id, day_key, created_at, updated_at, sync_state)
       VALUES ('old-c', 'old', '2026-10-01', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'local')`,
      [],
    );

    await importBackup(
      envelope({
        [TABLES.tasks]: [
          {
            id: 'new',
            title: '新任务',
            kind: 'execution',
            status: 'todo',
            time_attribute: 'none',
            completion: 'checkbox',
            tags_json: '[]',
            priority: 2,
            source: 'manual',
            progress_json: '{"accumulatedMinutes":0}',
            created_at: '2026-10-07T00:00:00.000Z',
            updated_at: '2026-10-07T00:00:00.000Z',
            sync_state: 'local',
          },
        ],
      }),
      'replace',
    );

    const tasks = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${TABLES.tasks}`);
    const checkins = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${TABLES.checkins}`);
    expect(tasks.map((r) => r.id)).toEqual(['new']);
    expect(checkins).toEqual([]);
  });
});
