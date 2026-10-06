import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { clearAllTables, withTransaction } from '@/data/db/client';
import { insertParams, upsertSql, type ColumnMap } from '@/data/db/sql';

import {
  BACKUP_TABLES,
  isBackupEnvelope,
  type BackupEnvelope,
  type BackupRow,
  type BackupTableName,
} from './format';

export type ImportMode = 'replace' | 'merge';

export interface ImportSummary {
  mode: ImportMode;
  schemaVersion: number;
  exportedAt: string;
  imported: Record<string, number>;
}

/** 让用户挑一个备份文件 */
export async function pickBackupFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name ?? 'backup.json' };
}

export async function readBackupFromUri(uri: string): Promise<BackupEnvelope> {
  const raw = await new File(uri).text();
  const parsed: unknown = JSON.parse(raw);
  if (!isBackupEnvelope(parsed)) {
    throw new Error('这个文件不是 AI 日程的备份格式');
  }
  return parsed;
}

/** 只保留 SQLite 能绑定的原始值 */
function toColumnMap(row: BackupRow): ColumnMap {
  const columns: ColumnMap = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
      columns[key] = value;
    }
  }
  return columns;
}

/**
 * 导入备份。
 *
 * - replace：先清空再灌入，用于"换手机 / 恢复到某天"
 * - merge：同 id 覆盖、新 id 追加，用于"合并两份数据"
 *
 * 整体包在一个事务里：失败就整体回滚，不会留下半份数据。
 */
export async function importBackup(
  envelope: BackupEnvelope,
  mode: ImportMode = 'replace',
): Promise<ImportSummary> {
  const imported: Record<string, number> = {};

  await withTransaction(async (db) => {
    if (mode === 'replace') {
      // 清空必须按"子表在前"的顺序走 client.ts 的统一实现 ——
      // 自己按 BACKUP_TABLES 顺序删是反的（containers 在最前、它是被引用方）。
      // 现在表还没声明外键所以不炸，但一旦补上外键声明，反序删除当场失败。
      await clearAllTables();
    }
    for (const table of BACKUP_TABLES) {
      const rows = envelope.tables[table] ?? [];
      for (const row of rows) {
        const columns = toColumnMap(row);
        if (!Object.keys(columns).length) continue;
        await db.runAsync(upsertSql(table, columns), insertParams(columns));
      }
      imported[table] = rows.length;
    }
  });

  return {
    mode,
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    imported,
  };
}

/** 一步到位：选文件 → 校验 → 导入。用户取消返回 null */
export async function restoreFromPicker(mode: ImportMode = 'replace'): Promise<ImportSummary | null> {
  const picked = await pickBackupFile();
  if (!picked) return null;
  const envelope = await readBackupFromUri(picked.uri);
  return importBackup(envelope, mode);
}

export const backupTableNames: readonly BackupTableName[] = BACKUP_TABLES;
