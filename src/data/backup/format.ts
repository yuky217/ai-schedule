import { SCHEMA_VERSION, TABLES } from '@/data/db/schema';

/**
 * 备份文件格式（主文档 7.2「必须保留导出/备份出口」）。
 *
 * 直接存数据库原始行，不做领域映射 —— 备份的目标是"能原样恢复"，
 * 而不是"给人看的漂亮 JSON"。多带一个 schemaVersion，将来升级表结构时
 * 可以写迁移逻辑读旧备份。
 */

export const BACKUP_FORMAT = 'ai-schedule-backup';

/** 备份覆盖的表，顺序固定（便于 diff 两份备份） */
export const BACKUP_TABLES = [
  TABLES.containers,
  TABLES.tasks,
  TABLES.ideas,
  TABLES.chains,
  TABLES.marks,
  TABLES.focusSessions,
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
  return `ai-schedule-${stamp}.json`;
};

export const currentSchemaVersion = SCHEMA_VERSION;
