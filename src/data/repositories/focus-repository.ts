import { getDatabase } from '@/data/db/client';
import { focusColumns, focusFromRow, type FocusRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { FocusSession } from '@/domain/focus';

const TABLE = TABLES.focusSessions;
const LIVE = 'deleted_at IS NULL';

export const focusRepository = {
  async listRecent(limit = 20): Promise<FocusSession[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<FocusRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY started_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(focusFromRow);
  },

  /**
   * 当前进行中的会话。
   * 用"最后一条没有 ended_at 的记录"来判定 —— 这样即使 App 被杀掉，
   * 重启后依然能恢复出"我刚才在专注"，不会丢会话。
   */
  async getActive(): Promise<FocusSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<FocusRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
    );
    return row ? focusFromRow(row) : null;
  },

  async listByTask(taskId: string): Promise<FocusSession[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<FocusRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND task_id = ? ORDER BY started_at DESC`,
      [taskId],
    );
    return rows.map(focusFromRow);
  },

  /**
   * 按开始时间区间取会话（含首尾）。
   *
   * 回顾页用它，一次查就覆盖"本期 + 上期"，环比不用来回查库。
   * started_at 一律是 toISOString() 的 UTC 串（等长、同格式），
   * 所以字符串比较和按时间比较等价。
   */
  async listBetween(fromIso: string, toIso: string): Promise<FocusSession[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<FocusRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND started_at >= ? AND started_at <= ?
        ORDER BY started_at ASC`,
      [fromIso, toIso],
    );
    return rows.map(focusFromRow);
  },

  async create(session: FocusSession): Promise<void> {
    const db = await getDatabase();
    const columns = focusColumns(session);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(session: FocusSession): Promise<FocusSession> {
    const db = await getDatabase();
    const next = touch(session);
    const columns = focusColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  /**
   * 结束会话。
   *
   * 「只涨不落，不惩罚」（主文档第六节）在这里落地：
   * growthSeconds 取 max(历史, 本次)，中途退出、提前结束都不会让它变小。
   */
  async finish(
    id: string,
    payload: { actualSeconds: number; intent?: string | null; note?: string | null },
  ): Promise<FocusSession | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<FocusRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    if (!row) return null;
    const current = focusFromRow(row);
    const actual = Math.max(0, Math.floor(payload.actualSeconds));
    const growth = Math.max(current.growthSeconds, actual);
    return this.save({
      ...current,
      endedAt: new Date().toISOString(),
      actualSeconds: actual,
      growthSeconds: growth,
      intent: payload.intent ?? current.intent,
      note: payload.note ?? current.note,
    });
  },

  /** 累计生长秒数：首页那个"小东西"用这个值渲染 */
  async totalGrowthSeconds(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ total: number | null }>(
      `SELECT SUM(growth_seconds) AS total FROM ${TABLE} WHERE ${LIVE}`,
    );
    return row?.total ?? 0;
  },
};
