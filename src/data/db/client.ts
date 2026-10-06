import * as SQLite from 'expo-sqlite';

import { DDL, MIGRATIONS, SCHEMA_VERSION, TABLES } from './schema';

/**
 * 数据库连接与迁移。
 *
 * 用模块级单例 Promise 而不是全局变量：并发调用 getDatabase() 时只会真正 open 一次，
 * 避免 App 启动阶段多个页面同时初始化导致重复建表。
 */

const DATABASE_NAME = 'ai-schedule.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openAndMigrate();
  }
  return databasePromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // 外键约束默认关闭，显式打开，将来接容器层级时能靠它兜底
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(DDL);
  await runMigrations(db);
  return db;
}

/**
 * 增量迁移：从 meta 表里读当前版本，把缺的版本逐个补上。
 *
 * 注意这里不能用 getSchemaVersion()（它会递归调 getDatabase），
 * 直接查一次 meta 表。版本号只在全部成功后才写入。
 */
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLES.meta} WHERE key = ?`,
    ['schema_version'],
  );
  const current = row ? Number(row.value) : 0;
  if (current >= SCHEMA_VERSION) return;

  for (let version = current + 1; version <= SCHEMA_VERSION; version++) {
    for (const statement of MIGRATIONS[version] ?? []) {
      try {
        await db.execAsync(statement);
      } catch (err) {
        // 老库可能已被 DDL 的 CREATE TABLE 兜底建出同名列，重复加列不算失败
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  }

  await db.runAsync(
    `INSERT INTO ${TABLES.meta} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['schema_version', String(SCHEMA_VERSION)],
  );
}

/** 事务包装：写操作尽量走这里，保证要么全成、要么全不成 */
export async function withTransaction<T>(
  work: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();
  let result!: T;
  await db.withTransactionAsync(async () => {
    result = await work(db);
  });
  return result;
}

export async function getSchemaVersion(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLES.meta} WHERE key = ?`,
    ['schema_version'],
  );
  return row ? Number(row.value) : 0;
}

/** 导出/导入时的"清空重灌"用得上 */
export async function clearAllTables(): Promise<void> {
  await withTransaction(async (db) => {
    for (const table of [
      TABLES.checkins,
      TABLES.focusSessions,
      TABLES.chains,
      TABLES.marks,
      TABLES.tasks,
      TABLES.ideas,
      TABLES.containers,
    ]) {
      await db.execAsync(`DELETE FROM ${table}`);
    }
  });
}
