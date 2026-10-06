import { INDEXES, MIGRATIONS, PRAGMAS, SCHEMA_VERSION, TABLES, TABLES_DDL } from './schema';

/**
 * 开库的完整流程 —— **顺序就是正确性**：
 *
 * 1. `PRAGMA`（WAL / 外键）
 * 2. 建表 `CREATE TABLE IF NOT EXISTS`
 * 3. 增量迁移 `ALTER TABLE ADD COLUMN`
 * 4. 建索引
 *
 * 第 4 步必须在第 3 步之后。之前索引和建表写在同一段 SQL 里、先于迁移执行，
 * 于是**老库升级时直接开不了库**：`CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，
 * 老库里没有 `parent_task_id` 这一列，建索引就报 `no such column: parent_task_id`，
 * 整段 execAsync 失败，App 里每个页面都拿不到数据库。全新安装反而是好的 ——
 * 只有"已经用过一段时间的老库"会撞上，最难被发现的那种。
 *
 * 这里刻意只依赖一个极简接口（不 import expo-sqlite），
 * 好让 bootstrap.test.ts 用 node:sqlite 在内存里把各代老库真跑一遍。
 */

/** 绑定参数。只用到位置参数，够本层使用。 */
export type SqlParams = (string | number | null)[];

/**
 * 本层需要的最小数据库能力。expo-sqlite 的 SQLiteDatabase 天然满足，
 * 测试里用一个 node:sqlite 的适配器满足。
 */
export interface BootstrapDb {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, params: SqlParams): Promise<T | null>;
  runAsync(source: string, params: SqlParams): Promise<unknown>;
}

export interface BootstrapReport {
  /** 打开时库里的版本号（全新库为 0） */
  fromVersion: number;
  /** 执行完之后的版本号 */
  toVersion: number;
  /** 本次真正补上的版本号 */
  applied: number[];
  /** 建失败的索引（正常应为空；索引只是加速，建失败不该拖垮整个 App） */
  failedIndexes: string[];
}

export async function bootstrapDatabase(db: BootstrapDb): Promise<BootstrapReport> {
  for (const pragma of PRAGMAS) {
    await db.execAsync(pragma);
  }
  await db.execAsync(TABLES_DDL);

  const migration = await runMigrations(db);
  const failedIndexes = await createIndexes(db);

  return {
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    applied: migration.applied,
    failedIndexes,
  };
}

interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

/**
 * 增量迁移：从 meta 表读当前版本，把缺的版本逐个补上。
 *
 * 版本号只在全部语句跑完之后才写入 —— 中途失败就保持老版本号，
 * 下次启动重跑（所有语句都写成幂等的，重跑安全）。
 */
export async function runMigrations(db: BootstrapDb): Promise<MigrationReport> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${TABLES.meta} WHERE key = ?`,
    ['schema_version'],
  );
  const fromVersion = row ? Number(row.value) : 0;
  if (fromVersion >= SCHEMA_VERSION) {
    return { fromVersion, toVersion: fromVersion, applied: [] };
  }

  const applied: number[] = [];
  for (let version = fromVersion + 1; version <= SCHEMA_VERSION; version++) {
    for (const statement of MIGRATIONS[version] ?? []) {
      try {
        await db.execAsync(statement);
      } catch (err) {
        // 老库可能已被建表语句兜底建出同名列，重复加列不算失败
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    applied.push(version);
  }

  await db.runAsync(
    `INSERT INTO ${TABLES.meta} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['schema_version', String(SCHEMA_VERSION)],
  );

  return { fromVersion, toVersion: SCHEMA_VERSION, applied };
}

/**
 * 建索引。逐条执行、逐条容错：
 * 索引只影响查询快慢，不影响数据对错，不该因为它让 App 起不来。
 * 但"该有的索引有没有建出来"由单测盯着（bootstrap.test.ts），
 * 免得这里默默降级到没人发现。
 */
async function createIndexes(db: BootstrapDb): Promise<string[]> {
  const failed: string[] = [];
  for (const statement of INDEXES) {
    try {
      await db.execAsync(statement);
    } catch (err) {
      failed.push(statement);
      console.warn('[db] 索引创建失败，已跳过（只影响查询速度）：', statement, err);
    }
  }
  return failed;
}
