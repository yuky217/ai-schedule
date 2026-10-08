import * as SQLite from 'expo-sqlite';

import { bootstrapDatabase } from './bootstrap';
import { TABLES } from './schema';

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
    databasePromise = openAndMigrate().catch((err) => {
      /**
       * 关键：**失败的 promise 绝不能留在缓存里**。
       *
       * 留着的后果是这一次失败会绑死整个会话 —— 之后每一次 getDatabase() 都拿到
       * 同一个旧错误，用户看到的是"重启也没用、每个页面都崩"，而真正的原因
       * 早就飘过去了。清掉缓存后，下一次调用会重试，也让错误可恢复。
       */
      databasePromise = null;
      console.error('[db] 开库/迁移失败（不缓存失败状态，下次调用会重试）:', err);
      throw err;
    });
  }
  return databasePromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await bootstrapDatabase(db);
  return db;
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
      TABLES.courses,
      TABLES.terms,
      TABLES.events,
      TABLES.tasks,
      TABLES.ideas,
      TABLES.containers,
    ]) {
      await db.execAsync(`DELETE FROM ${table}`);
    }
  });
}
