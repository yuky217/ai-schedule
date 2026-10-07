import { getDatabase } from '@/data/db/client';
import { courseColumns, courseFromRow, type CourseRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { Course } from '@/domain/course';
import { nowIso } from '@/utils/datetime';

const TABLE = TABLES.courses;
const LIVE = 'deleted_at IS NULL';

/**
 * 课程仓储。
 *
 * 排序：`created_at DESC`（新导入的课在最前）—— 课表本身按"周几 + 节次"
 * 排，由 domain 的 weekGrid/coursesOnDate 负责，仓储不掺和。
 */
export const courseRepository = {
  async listAll(): Promise<Course[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CourseRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY created_at DESC`,
    );
    return rows.map(courseFromRow);
  },

  async getById(id: string): Promise<Course | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CourseRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    return row ? courseFromRow(row) : null;
  },

  async count(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${LIVE}`,
    );
    return row?.n ?? 0;
  },

  async create(course: Course): Promise<void> {
    const db = await getDatabase();
    const columns = courseColumns(course);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  async save(course: Course): Promise<Course> {
    const db = await getDatabase();
    const next = touch(course);
    const columns = courseColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async update(id: string, patch: Partial<Course>): Promise<Course | null> {
    const current = await this.getById(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, id: current.id });
  },

  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), id],
    );
  },

  /**
   * 一次性写入多门课（导入用）。
   *
   * 走一个事务：导入 20 门课中途失败的话，不能留下"一半课表"——
   * 用户看到的是缺了几门、而且再也说不清是哪几门。
   */
  async createMany(courses: readonly Course[]): Promise<void> {
    if (!courses.length) return;
    const db = await getDatabase();
    await db.withTransactionAsync(async () => {
      for (const course of courses) {
        const columns = courseColumns(course);
        await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
      }
    });
  },

  /** 清空课表（重新导入前用）—— 软删除，保留可回退的余地 */
  async softDeleteAll(): Promise<void> {
    const db = await getDatabase();
    const at = nowIso();
    await db.runAsync(`UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE ${LIVE}`, [at, at]);
  },
};
