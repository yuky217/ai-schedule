import type { SQLiteBindValue } from 'expo-sqlite';

/**
 * 极简 SQL 拼装工具。
 *
 * 思路：每个实体对外暴露一个 `xxxColumns(entity): Record<string, SQLiteBindValue>`，
 * 由这里统一生成 INSERT / UPDATE 语句 —— 新增字段时只改一处映射，不会出现
 * "加了字段忘了改 SQL" 这类低级错误。
 */

export type ColumnMap = Record<string, SQLiteBindValue>;

export function insertSql(table: string, columns: ColumnMap): string {
  const keys = Object.keys(columns);
  return `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
}

export function insertParams(columns: ColumnMap): SQLiteBindValue[] {
  return Object.values(columns);
}

/**
 * 备份导入专用：同主键就覆盖。
 * 这样"恢复备份"和"合并两份备份"能共用同一条语句。
 */
export function upsertSql(table: string, columns: ColumnMap): string {
  const keys = Object.keys(columns);
  return `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
}

/** UPDATE 语句里排除了 id（它是定位条件，不是被更新的值） */
export function updateSql(table: string, columns: ColumnMap, where = 'id = ?'): string {
  const keys = Object.keys(columns).filter((k) => k !== 'id');
  return `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${where}`;
}

export function updateParams(columns: ColumnMap): SQLiteBindValue[] {
  const keys = Object.keys(columns).filter((k) => k !== 'id');
  return [...keys.map((k) => columns[k]), columns.id];
}
