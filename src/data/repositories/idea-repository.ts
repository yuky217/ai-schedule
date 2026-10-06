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

  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), id],
    );
  },
};
