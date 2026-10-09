import { SCHEMA_VERSION, TABLES } from '@/data/db/schema';

/**
 * 备份文件格式（主文档 7.2「必须保留导出/备份出口」）。
 *
 * 直接存数据库原始行，不做领域映射 —— 备份的目标是"能原样恢复"，
 * 而不是"给人看的漂亮 JSON"。多带一个 schemaVersion，将来升级表结构时
 * 可以写迁移逻辑读旧备份。
 */

/**
 * 备份文件的"我是谁"标记。**这个值不跟着应用名改** ——
 * 改了它，改名之前导出的备份就 recognized 不出来，用户手里那份旧备份直接废掉。
 * 应用名换成 JUST 之后，`buildBackupFileName` 出的文件名会变，
 * 但文件里这个标记必须还是老样子：能读旧备份比名字一致重要。
 */
export const BACKUP_FORMAT = 'ai-schedule-backup';

/**
 * 备份覆盖的表，顺序固定（便于 diff 两份备份）。
 *
 * **加新表时必须把表名挂进来** —— import.test.ts 有一条不变量
 * （BACKUP_TABLES 覆盖 schema 除 app_meta 外的所有表）会把漏掉的当场揪红。
 * task_checkins（打卡）就漏过一次：v3 加了表没进备份，恢复后习惯
 * 连续天数、频率型达标记录全部蒸发。
 */
export const BACKUP_TABLES = [
  TABLES.containers,
  TABLES.tasks,
  TABLES.checkins,
  TABLES.ideas,
  TABLES.chains,
  TABLES.marks,
  TABLES.focusSessions,
  TABLES.courses,
  TABLES.terms,
  TABLES.events,
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export type BackupRow = Record<string, string | number | null>;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<BackupTableName, BackupRow[]>;
}

export function isBackupEnvelope(value: unknown): value is BackupEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackupEnvelope>;
  return candidate.format === BACKUP_FORMAT && typeof candidate.tables === 'object';
}

export const buildBackupFileName = (date: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `just-${stamp}.json`;
};

export const currentSchemaVersion = SCHEMA_VERSION;
