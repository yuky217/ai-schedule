import { getDatabase } from '@/data/db/client';
import { ideaColumns, ideaFromRow, type IdeaRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { Idea } from '@/domain/idea';
import { nowIso } from '@/utils/datetime';

const TABLE = TABLES.ideas;
const LIVE = 'deleted_at IS NULL';

/** 想法库仓储：只负责"存住 + 捞出来"，不做任何提醒逻辑（想法不提醒） */
export const ideaRepository = {
  async listActive(): Promise<Idea[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<IdeaRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND archived_at IS NULL ORDER BY created_at DESC`,
    );
    return rows.map(ideaFromRow);
  },

  /**
   * 按关键词模糊查。
   * 骨架阶段的降级方案 —— 能力层开启后，语义检索会替换掉这里的 LIKE。
   */
  async search(keyword: string): Promise<Idea[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<IdeaRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND content LIKE ? ORDER BY created_at DESC`,
      [`%${keyword}%`],
    );
    return rows.map(ideaFromRow);
  },

  /**
   * 已归档的想法。
   *
   * 存在的理由：归档此前是一道**单向门** —— 界面上的归档按钮点一下，
   * 想法就从列表里消失，而没有任何地方能看到它、更没有地方能把它找回来
   * （`archived_at` 只被 `listActive` 用来过滤）。用户分不清"归档了"
   * 和"弄丢了"，而那一下点击还不需要确认。
   */
  async listArchived(): Promise<Idea[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<IdeaRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND archived_at IS NOT NULL ORDER BY archived_at DESC`,
    );
    return rows.map(ideaFromRow);
  },

  async countArchived(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${LIVE} AND archived_at IS NOT NULL`,
    );
    return row?.n ?? 0;
  },

  async getById(id: string): Promise<Idea | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<IdeaRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    return row ? ideaFromRow(row) : null;
  },

  async create(idea: Idea): Promise<void> {
    const db = await getDatabase();
    const columns = ideaColumns(idea);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(idea: Idea): Promise<Idea> {
    const db = await getDatabase();
    const next = touch(idea);
    const columns = ideaColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async archive(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET archived_at = ?, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), id],
    );
  },

  /** 反归档：把想法放回主列表。跟 `archive` 对称，缺了它归档就是单向门。 */
  async unarchive(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET archived_at = NULL, updated_at = ? WHERE id = ?`,
      [nowIso(), id],
    );
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), id],
    );
  },
};
