import { getDatabase, withTransaction } from '@/data/db/client';
import { eventColumns, eventFromRow, type EventRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { CalEvent } from '@/domain/event';
import { nowIso } from '@/utils/datetime';

const TABLE = TABLES.events;
const LIVE = 'deleted_at IS NULL';

/**
 * 固定日程仓储（考试等）。
 *
 * 跟其他仓储同样的两条约定：查询自动排除软删除、写入自动更新时间戳。
 * 数量级很小（一学期十来场考试），所以只给全量列表 —— 界面按日期自己分桶。
 */
export const eventRepository = {
  async listAll(): Promise<CalEvent[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<EventRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY start_at ASC, title ASC`,
    );
    return rows.map(eventFromRow);
  },

  async getById(id: string): Promise<CalEvent | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<EventRow>(`SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`, [
      id,
    ]);
    return row ? eventFromRow(row) : null;
  },

  async count(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${LIVE}`);
    return row?.n ?? 0;
  },

  async create(event: CalEvent): Promise<void> {
    const db = await getDatabase();
    const columns = eventColumns(event);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(event: CalEvent): Promise<CalEvent> {
    const db = await getDatabase();
    const next = touch(event);
    const columns = eventColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async update(id: string, patch: Partial<CalEvent>): Promise<CalEvent | null> {
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

  /** 整表清（软删）—— 重新导入考试时用，跟着"替换"语义走 */
  async softDeleteAll(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE ${LIVE}`, [
      nowIso(),
      nowIso(),
    ]);
  },

  /**
   * 一次性写入多场（导入用）。
   *
   * 走一个事务：导 9 场考试中途失败不能留下一半 —— 用户没法知道缺了哪场，
   * 而考试恰恰是一场都不能漏的。
   */
  async createMany(events: readonly CalEvent[]): Promise<void> {
    if (!events.length) return;
    await withTransaction(async (db) => {
      for (const event of events) {
        const columns = eventColumns(event);
        await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
      }
    });
  },
};
