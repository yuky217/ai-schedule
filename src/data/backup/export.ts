import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDatabase } from '@/data/db/client';

import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  buildBackupFileName,
  currentSchemaVersion,
  type BackupEnvelope,
  type BackupRow,
} from './format';

/** 备份落地的目录：document 目录不会被系统清理 */
const BACKUP_DIR_NAME = 'backups';

/** 把整库读成一份可序列化的信封 */
export async function buildBackup(): Promise<BackupEnvelope> {
  const db = await getDatabase();
  const tables = {} as BackupEnvelope['tables'];
  const counts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const rows = await db.getAllAsync<BackupRow>(`SELECT * FROM ${table}`);
    tables[table] = rows;
    counts[table] = rows.length;
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: currentSchemaVersion,
    exportedAt: new Date().toISOString(),
    counts,
    tables,
  };
}

export interface ExportResult {
  uri: string;
  fileName: string;
  counts: Record<string, number>;
  /** 是否成功唤起系统分享面板；false 表示文件已写好但分享不可用 */
  shared: boolean;
}

function resolveBackupDir(): Directory {
  const dir = new Directory(Paths.document, BACKUP_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

/** 只写文件，不分享 */
export async function writeBackupToFile(
  envelope?: BackupEnvelope,
): Promise<{ file: File; uri: string; fileName: string; counts: Record<string, number> }> {
  const payload = envelope ?? (await buildBackup());
  const dir = resolveBackupDir();
  const fileName = buildBackupFileName();
  const file = new File(dir, fileName);
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(payload, null, 2));
  return { file, uri: file.uri, fileName, counts: payload.counts };
}

/**
 * 导出备份：写文件 + 唤起系统分享。
 * 手机端用户可以直接"存到文件 / 发给自己"，这就是主文档要求的备份出口。
 */
export async function exportBackup(): Promise<ExportResult> {
  const { uri, fileName, counts } = await writeBackupToFile();

  let shared = false;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: '导出 AI 日程备份',
      UTI: 'public.json',
    });
    shared = true;
  }

  return { uri, fileName, counts, shared };
}
