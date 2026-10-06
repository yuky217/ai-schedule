import { getDatabase } from '@/data/db/client';
import { taskColumns, taskFromRow, type TaskRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import { TaskKind, TaskStatus } from '@/domain/enums';
import type { Task } from '@/domain/task';
import { endOfDayIso, startOfDayIso } from '@/utils/datetime';

const TABLE = TABLES.tasks;
const LIVE = 'deleted_at IS NULL';
/**
 * 顶层任务 = 不是别人的子任务。
 *
 * 所有"列表"查询都必须带上它 —— 否则子任务会同时出现在收集箱里，
 * 一件事变成两行，用户还得自己想"哪个才是要做的那个"。
 * 子任务只在父任务详情页里出现（listSubtasks）。
 */
const TOP_LEVEL = 'parent_task_id IS NULL';
/**
 * 手动排序：排过的在前（1..n），没排过的（NULL≡0）仍按创建时间倒序在最上面。
 * 这样"用户拖过的顺序"和"新记进来的在最上面"两件事互不干扰。
 */
const ORDER_MANUAL = 'COALESCE(sort_order, 0) ASC, created_at DESC';

/**
 * 任务仓储 —— 界面层唯一被允许碰数据的地方。
 *
 * 约定：所有查询都自动排除软删除行；所有写入都走 touch() 更新时间戳。
 * 这样"同步预留"和"软删除"是仓储的默认行为，而不是每个调用点各自的自觉。
 */
export const taskRepository = {
  async listAll(): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND ${TOP_LEVEL} ORDER BY ${ORDER_MANUAL}`,
    );
    return rows.map(taskFromRow);
  },

  /** 收集箱 = 中档待规划：既没固定时间、也没截止时间，且还没做完 */
  async listInbox(): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE}
          AND ${TOP_LEVEL}
          AND status != ?
          AND time_attribute = 'none'
        ORDER BY ${ORDER_MANUAL}`,
      [TaskStatus.Done],
    );
    return rows.map(taskFromRow);
  },

  /** 今天要面对的：今天开始 / 今天到期 / 正在进行的 */
  async listToday(day: Date = new Date()): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE}
          AND ${TOP_LEVEL}
          AND (
            (start_at  BETWEEN ? AND ?)
            OR (due_at BETWEEN ? AND ?)
            OR status = ?
          )
        ORDER BY COALESCE(due_at, start_at) ASC`,
      [startOfDayIso(day), endOfDayIso(day), startOfDayIso(day), endOfDayIso(day), TaskStatus.Doing],
    );
    return rows.map(taskFromRow);
  },

  /**
   * 指定区间内"已落到日历"的任务。日历页用它，不再全量读。
   *
   * 判据是**时间窗重叠**，不是单一锚点：
   * `COALESCE(start_at, due_at) <= to AND COALESCE(due_at, start_at) >= from`
   * 第一个式子是"最早的那个时间点不晚于窗口末端"，
   * 第二个是"最晚的那个时间点不早于窗口起点"，两个都成立才说明有交集。
   * 只比较 startAt 会把"上个月开始、下周截止"的任务漏掉。
   *
   * **刻意不过滤状态**：日历回答的是"这段时间发生过什么"，不是"还剩什么没做"，
   * 所以已完成的事必须查得出来（由界面画成灰色）。以前这里带 `status != done`，
   * 结果"完成的日程在日历上显示"从查询这一步就断了 —— 界面再怎么写都没用。
   */
  async listScheduledBetween(fromIso: string, toIso: string): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE}
          AND ${TOP_LEVEL}
          AND time_attribute != 'none'
          AND COALESCE(start_at, due_at) <= ?
          AND COALESCE(due_at, start_at) >= ?
        ORDER BY COALESCE(start_at, due_at) ASC`,
      [toIso, fromIso],
    );
    return rows.map(taskFromRow);
  },

  /**
   * 已完成、但没安排过时间的顶层任务 —— 收集箱底部那个"已完成"折叠区。
   *
   * 存在的唯一理由是**兜底"查不到"**：一条任务完成后会离开收集箱（收集箱带 status != done），
   * 如果它又没时间，那它也不在日历（日历带 time_attribute != 'none'）、不在首页今天
   * （按时间窗匹配）、不在习惯页（只取 kind = habit）。四个列表全都不收，
   * 用户勾完就等于把它弄丢了 —— 只有知道 id 才打得开。
   *
   * 所以这里的条件刻意和收集箱**互补**：收集箱是「未完成 + 无时间」，
   * 这里是「已完成 + 无时间」，两条拼起来刚好覆盖"无时间的顶层任务"全集。
   * 有时间的已完成任务不需要它 —— 那些在日历上看得见。
   */
  async listRecentlyDone(limit = 20): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE}
          AND ${TOP_LEVEL}
          AND status = ?
          AND time_attribute = 'none'
        ORDER BY completed_at DESC, created_at DESC
        LIMIT ?`,
      [TaskStatus.Done, limit],
    );
    return rows.map(taskFromRow);
  },

  async listByContainer(containerId: string): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND ${TOP_LEVEL} AND container_id = ?
        ORDER BY ${ORDER_MANUAL}`,
      [containerId],
    );
    return rows.map(taskFromRow);
  },

  /** 习惯：只取习惯型顶层任务，习惯页用 */
  async listHabits(): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND ${TOP_LEVEL} AND kind = ?
        ORDER BY ${ORDER_MANUAL}`,
      [TaskKind.Habit],
    );
    return rows.map(taskFromRow);
  },

  /**
   * 一次取多份列表的子任务（避免每行各查一次库）。
   * 返回 parentId → 子任务[] 的映射；调用方按需取。
   */
  async listSubtasksOf(parentIds: readonly string[]): Promise<Map<string, Task[]>> {
    const map = new Map<string, Task[]>();
    if (!parentIds.length) return map;
    const db = await getDatabase();
    const placeholders = parentIds.map(() => '?').join(', ');
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND parent_task_id IN (${placeholders})
        ORDER BY ${ORDER_MANUAL}`,
      [...parentIds],
    );
    for (const row of rows) {
      const task = taskFromRow(row);
      const parentId = task.parentId;
      if (!parentId) continue;
      const bucket = map.get(parentId) ?? [];
      bucket.push(task);
      map.set(parentId, bucket);
    }
    return map;
  },

  async listSubtasks(parentId: string): Promise<Task[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT * FROM ${TABLE}
        WHERE ${LIVE} AND parent_task_id = ?
        ORDER BY ${ORDER_MANUAL}`,
      [parentId],
    );
    return rows.map(taskFromRow);
  },

  async getById(id: string): Promise<Task | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<TaskRow>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`,
      [id],
    );
    return row ? taskFromRow(row) : null;
  },

  async create(task: Task): Promise<void> {
    const db = await getDatabase();
    const columns = taskColumns(task);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
  },

  /** 全量覆盖写。适合"改完再存"的场景 */
  async save(task: Task): Promise<Task> {
    const db = await getDatabase();
    const next = touch(task);
    const columns = taskColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  /** 局部修改：先读、再合并、再存 */
  async update(id: string, patch: Partial<Task>): Promise<Task | null> {
    const current = await this.getById(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, id: current.id });
  },

  /**
   * 手动排序落库：把 id 顺序写成 1..n。
   *
   * 整份重写而不是插值，理由见 domain/ordering.ts 的 orderWeights 注释。
   * 一条 UPDATE ... CASE 搞定，不用循环 n 次写库。
   */
  async reorder(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const db = await getDatabase();
    const now = new Date().toISOString();
    const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
    const params: (string | number)[] = [];
    ids.forEach((id, index) => {
      params.push(id, index + 1);
    });
    params.push(now);
    await db.runAsync(
      `UPDATE ${TABLE}
         SET sort_order = CASE id ${cases} END, updated_at = ?
       WHERE ${LIVE} AND id IN (${ids.map(() => '?').join(', ')})`,
      [...params, ...ids],
    );
  },

  /**
   * 取消所有子任务的父级指向（删父任务时用）。
   * 不连带删除子任务 —— 用户删的是"这个壳"，不是壳里那几件真的事。
   */
  async detachSubtasks(parentId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.runAsync(
      `UPDATE ${TABLE} SET parent_task_id = NULL, updated_at = ?
       WHERE ${LIVE} AND parent_task_id = ?`,
      [now, parentId],
    );
  },

  async setStatus(id: string, status: TaskStatus, extra: Partial<Task> = {}): Promise<Task | null> {
    return this.update(id, {
      status,
      ...extra,
      completedAt: status === TaskStatus.Done ? new Date().toISOString() : null,
    });
  },

  async complete(id: string): Promise<Task | null> {
    return this.setStatus(id, TaskStatus.Done);
  },

  /** 软删除：行还在，只是查不到了 */
  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), id],
    );
  },

  async countOpen(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${LIVE} AND ${TOP_LEVEL} AND status != ?`,
      [TaskStatus.Done],
    );
    return row?.n ?? 0;
  },
};
