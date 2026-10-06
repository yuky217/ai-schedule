import { getDatabase } from '@/data/db/client';
import { checkinColumns, checkinFromRow, type CheckinRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql } from '@/data/db/sql';
import type { Checkin } from '@/domain/checkins';
import { createCheckin } from '@/domain/factory';
import { toDayKey } from '@/utils/datetime';

const TABLE = TABLES.checkins;
const LIVE = 'deleted_at IS NULL';

/**
 * 打卡仓储。
 *
 * 「一天一条」这条约束放在这里而不是数据库唯一索引：
 * 表是软删除的，唯一索引会和"撤销打卡"打架（删除后当天就再也插不进去了）。
 * 所以用"先查、有就返回原记录、没有才插"的幂等写法 —— 重复点打卡不会产生第二条。
 */
export const checkinRepository = {
  async listAll(): Promise<Checkin[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CheckinRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY day_key ASC`,
    );
    return rows.map(checkinFromRow);
  },

  async listByTask(taskId: string): Promise<Checkin[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CheckinRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND task_id = ? ORDER BY day_key ASC`,
      [taskId],
    );
    return rows.map(checkinFromRow);
  },

  async getByDay(taskId: string, dayKey: string): Promise<Checkin | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CheckinRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND task_id = ? AND day_key = ?`,
      [taskId, dayKey],
    );
    return row ? checkinFromRow(row) : null;
  },

  /** 打卡（幂等）：今天已经打过就原样返回，不重复插 */
  async checkIn(taskId: string, day: Date = new Date()): Promise<Checkin> {
    const dayKey = toDayKey(day);
    const existing = await this.getByDay(taskId, dayKey);
    if (existing) return existing;

    const checkin = createCheckin(taskId, day);
    const db = await getDatabase();
    const columns = checkinColumns(checkin);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
    return checkin;
  },

  /** 撤销打卡：软删掉这一天（重打时 getByDay 找不到，会新插一条） */
  async undo(taskId: string, day: Date = new Date()): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ?
       WHERE ${LIVE} AND task_id = ? AND day_key = ?`,
      [now, now, taskId, toDayKey(day)],
    );
  },

  /** 任务被删时连带软删它的打卡记录 */
  async softDeleteByTask(taskId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE ${LIVE} AND task_id = ?`,
      [now, now, taskId],
    );
  },
};
