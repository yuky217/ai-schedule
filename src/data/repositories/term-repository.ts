import { getDatabase } from '@/data/db/client';
import { termColumns, termFromRow, type TermRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { Term } from '@/domain/course';

const TABLE = TABLES.terms;
const LIVE = 'deleted_at IS NULL';

/**
 * 学期仓储（当前学期 = 最近更新的那一条）。
 *
 * 为什么允许"多条"而不是"就一条"：换学期时先写新的一条、确认无误再删旧的，
 * 中间不会出现"没有学期"的空窗（那会让整张课表算不出一周是第几周而消失）。
 * 界面上永远只用 `getCurrent()`。
 */
export const termRepository = {
  async getCurrent(): Promise<Term | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<TermRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    );
    return row ? termFromRow(row) : null;
  },

  async listAll(): Promise<Term[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TermRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY updated_at DESC`,
    );
    return rows.map(termFromRow);
  },

  async save(term: Term): Promise<Term> {
    const db = await getDatabase();
    const next = touch(term);
    const columns = termColumns(next);
    // UPSERT：学期是单例语义，同 id 直接覆盖（重复保存不该报错）
    await db.runAsync(
      `INSERT OR REPLACE INTO ${TABLE} (${Object.keys(columns).join(', ')})
       VALUES (${Object.keys(columns).map(() => '?').join(', ')})`,
      insertParams(columns),
    );
    return next;
  },

  /** 兼容"改字段"的写法（界面改开学日期/总周数都走它） */
  async update(id: string, patch: Partial<Term>): Promise<Term | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<TermRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    if (!row) return null;
    const next = touch({ ...termFromRow(row), ...patch, id });
    const columns = termColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },
};
