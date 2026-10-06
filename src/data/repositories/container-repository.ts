import { getDatabase } from '@/data/db/client';
import { containerColumns, containerFromRow, type ContainerRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { Container } from '@/domain/container';
import { nowIso } from '@/utils/datetime';

const TABLE = TABLES.containers;
const LIVE = 'deleted_at IS NULL';

/**
 * 容器仓储（目标 / 项目 / 文件夹）。
 * 排序、分组、甘特图视图都从这里取数，视图本身不落库。
 */
export const containerRepository = {
  async listAll(): Promise<Container[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ContainerRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY created_at DESC`,
    );
    return rows.map(containerFromRow);
  },

  async listChildren(parentId: string | null): Promise<Container[]> {
    const db = await getDatabase();
    const rows = parentId
      ? await db.getAllAsync<ContainerRow>(
          `SELECT * FROM ${TABLE} WHERE ${LIVE} AND parent_id = ? ORDER BY created_at DESC`,
          [parentId],
        )
      : await db.getAllAsync<ContainerRow>(
          `SELECT * FROM ${TABLE} WHERE ${LIVE} AND parent_id IS NULL ORDER BY created_at DESC`,
        );
    return rows.map(containerFromRow);
  },

  async getById(id: string): Promise<Container | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContainerRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    return row ? containerFromRow(row) : null;
  },

  /** 按类型取：项目 Tab 的分组列表用 */
  async listByKind(kind: string): Promise<Container[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ContainerRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND kind = ? ORDER BY created_at DESC`,
      [kind],
    );
    return rows.map(containerFromRow);
  },

  async update(id: string, patch: Partial<Container>): Promise<Container | null> {
    const current = await this.getById(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, id: current.id });
  },

  async create(container: Container): Promise<void> {
    const db = await getDatabase();
    const columns = containerColumns(container);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(container: Container): Promise<Container> {
    const db = await getDatabase();
    const next = touch(container);
    const columns = containerColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), id],
    );
  },
};
