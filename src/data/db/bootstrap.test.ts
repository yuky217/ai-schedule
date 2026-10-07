/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from './bootstrap';
import { INDEXES, MIGRATIONS, SCHEMA_VERSION, TABLES, TABLES_DDL } from './schema';

/**
 * 开库流程的单测 —— 用 node:sqlite（Node 自带）在内存里把**各代老库**真跑一遍。
 *
 * 为什么非要测这个：这一层的 bug 只有在"已经用过一段时间的库"上才出现，
 * 全新安装一切正常，模拟器上新建库也一切正常。曾经就因为
 * "建索引跑在加列之前"，让所有老用户升级后 App 直接起不来
 * （`no such column: parent_task_id`）。这类回归必须被钉住。
 */

interface Harness {
  db: DatabaseSync;
  adapter: BootstrapDb;
}

function memoryDb(): Harness {
  const db = new DatabaseSync(':memory:');
  const adapter: BootstrapDb = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, params: SqlParams) => {
      const row = db.prepare(sql).get(...params);
      return (row ?? null) as unknown as T | null;
    },
    runAsync: async (sql: string, params: SqlParams) => db.prepare(sql).run(...params),
  };
  return { db, adapter };
}

/** 每个迁移版本"加出来的列" → 版本号。从 MIGRATIONS 反推，新增迁移无需改测试。 */
const COLUMN_ADDED_IN = new Map<string, number>();
for (const [version, statements] of Object.entries(MIGRATIONS)) {
  for (const statement of statements) {
    const column = /ADD COLUMN\s+(\w+)/i.exec(statement)?.[1];
    if (column) COLUMN_ADDED_IN.set(column, Number(version));
  }
}

/** 从 from 版本升到当前版本，应该被补上的版本号序列。
 *  **从 SCHEMA_VERSION 推出来**，新增迁移版本时测试自动跟上 ——
 *  写死 [2, 3] 的话，加一个版本就要回来手改两处，迟早漏掉一处。 */
const versionsAppliedFrom = (from: number): number[] =>
  Array.from({ length: Math.max(0, SCHEMA_VERSION - from) }, (_, i) => from + 1 + i);

/** 造出一个"当时那个版本"的表结构：把后来版本才加的列从建表语句里删掉。
 * 这样老库的样子永远由 schema.ts 推导出来，不会随开发漂移。
 */
function ddlAtVersion(version: number): string {
  return TABLES_DDL.split('\n')
    .filter((line) => {
      const column = /^\s*([a-z_]+)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/i.exec(line)?.[1];
      if (!column) return true;
      const addedIn = COLUMN_ADDED_IN.get(column);
      return addedIn === undefined || addedIn <= version;
    })
    .join('\n');
}

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

const schemaVersionOf = (db: DatabaseSync): number =>
  Number((db.prepare(`SELECT value FROM ${TABLES.meta} WHERE key = 'schema_version'`).get() as { value: string }).value);

const indexNames = (db: DatabaseSync): string[] =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((i) => i.name);

/** INDEXES 里声明的索引名（正则取，避免这里再抄一份名字） */
const declaredIndexNames = INDEXES.map((sql) => /CREATE INDEX IF NOT EXISTS\s+(\w+)/i.exec(sql)?.[1] ?? '');

describe('bootstrapDatabase', () => {
  it('全新库：建表 + 建索引 + 版本号写成最新', async () => {
    const { db, adapter } = memoryDb();

    const report = await bootstrapDatabase(adapter);

    expect(report.fromVersion).toBe(0);
    expect(report.toVersion).toBe(SCHEMA_VERSION);
    expect(report.failedIndexes).toEqual([]);
    expect(schemaVersionOf(db)).toBe(SCHEMA_VERSION);
    expect(columnsOf(db, TABLES.tasks)).toEqual(
      expect.arrayContaining(['parent_task_id', 'sort_order', 'reminder_minutes_before']),
    );
    for (const name of declaredIndexNames) {
      expect(indexNames(db), `索引 ${name} 没建出来`).toContain(name);
    }
  });

  it('v2 老库升级：不再因 idx_tasks_parent 报 no such column（曾被它整个卡死）', async () => {
    const { db, adapter } = memoryDb();
    // 造一个 v2 时代的库：没有 parent_task_id / sort_order，也没有打卡表
    db.exec(ddlAtVersion(2));
    db.exec(`DROP TABLE ${TABLES.checkins}`);
    db.exec(
      `INSERT INTO ${TABLES.meta} (key, value) VALUES ('schema_version', '2')`,
    );
    db.exec(
      `INSERT INTO ${TABLES.tasks}
         (id, title, kind, status, time_attribute, completion, tags_json, priority, created_at, updated_at)
       VALUES ('old-1', '升级前就有的任务', 'task', 'todo', 'unscheduled', 'check', '[]', 2,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    const report = await bootstrapDatabase(adapter);

    expect(report.fromVersion).toBe(2);
    expect(report.applied).toEqual(versionsAppliedFrom(2));
    expect(report.failedIndexes).toEqual([]);
    expect(columnsOf(db, TABLES.tasks)).toEqual(expect.arrayContaining(['parent_task_id', 'sort_order']));
    for (const name of declaredIndexNames) {
      expect(indexNames(db), `索引 ${name} 没建出来`).toContain(name);
    }
    // 老数据一条都不能少
    expect(db.prepare(`SELECT title FROM ${TABLES.tasks} WHERE id = 'old-1'`).get()).toEqual({
      title: '升级前就有的任务',
    });
    // 升级出来的新列对老行是 NULL —— 查询侧用 COALESCE 兜底，不需要回填
    expect(db.prepare(`SELECT sort_order, parent_task_id FROM ${TABLES.tasks} WHERE id = 'old-1'`).get()).toEqual({
      sort_order: null,
      parent_task_id: null,
    });
    expect(schemaVersionOf(db)).toBe(SCHEMA_VERSION);
  });

  it('v1 老库升级：reminder_minutes_before 也补得上', async () => {
    const { db, adapter } = memoryDb();
    db.exec(ddlAtVersion(1));
    db.exec(`INSERT INTO ${TABLES.meta} (key, value) VALUES ('schema_version', '1')`);

    const report = await bootstrapDatabase(adapter);

    expect(report.applied).toEqual(versionsAppliedFrom(1));
    expect(columnsOf(db, TABLES.tasks)).toEqual(
      expect.arrayContaining(['reminder_minutes_before', 'parent_task_id', 'sort_order']),
    );
  });

  it('同一个库反复开：第二次什么都不做、也不报错', async () => {
    const { db, adapter } = memoryDb();

    await bootstrapDatabase(adapter);
    const second = await bootstrapDatabase(adapter);

    expect(second.fromVersion).toBe(SCHEMA_VERSION);
    expect(second.applied).toEqual([]);
    expect(second.failedIndexes).toEqual([]);
    expect(schemaVersionOf(db)).toBe(SCHEMA_VERSION);
  });

  it('迁移失败时不写版本号，下次启动会重跑', async () => {
    const { db, adapter } = memoryDb();
    db.exec(ddlAtVersion(1));
    db.exec(`INSERT INTO ${TABLES.meta} (key, value) VALUES ('schema_version', '1')`);

    // 让 v2 那条 ALTER 换成一个必然失败的语句，模拟迁移中断
    const boom: BootstrapDb = {
      ...adapter,
      execAsync: async (sql: string) => {
        if (/ADD COLUMN reminder_minutes_before/i.test(sql)) throw new Error('disk I/O error');
        db.exec(sql);
      },
    };

    await expect(bootstrapDatabase(boom)).rejects.toThrow(/disk I\/O error/);
    expect(schemaVersionOf(db)).toBe(1);
  });
});
