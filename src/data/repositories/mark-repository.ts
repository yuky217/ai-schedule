import { getDatabase } from '@/data/db/client';
import { markColumns, markFromRow, type MarkRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { Mark } from '@/domain/container';
import { nowIso } from '@/utils/datetime';

const TABLE = TABLES.marks;
const LIVE = 'deleted_at IS NULL';

/**
 * 纪念日仓储（主文档 5.3 的"标记"）。
 *
 * 它跟任务仓储一样遵守两条约定：查询自动排除软删除、写入自动更新时间戳。
 * 纪念日不参与排程，所以这里没有"按范围查""按状态查"，只有一条列表。
 */
export const markRepository = {
  async listAll(): Promise<Mark[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<MarkRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY date ASC, created_at DESC`,
    );
    return rows.map(markFromRow);
  },

  async getById(id: string): Promise<Mark | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<MarkRow>(`SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`, [
      id,
    ]);
    return row ? markFromRow(row) : null;
  },

  async create(mark: Mark): Promise<void> {
    const db = await getDatabase();
    const columns = markColumns(mark);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(mark: Mark): Promise<Mark> {
    const db = await getDatabase();
    const next = touch(mark);
    const columns = markColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async update(id: string, patch: Partial<Mark>): Promise<Mark | null> {
    const current = await this.getById(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, id: current.id });
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      nowIso(),
      nowIso(),
      id,
    ]);
  },
};
