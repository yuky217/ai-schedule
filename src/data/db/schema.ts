/**
 * 本地数据库结构（SQLite）。
 *
 * 两条硬约束来自主文档第七节：
 * 1. 先做纯本地 —— 所有实体都能离线创建，主键由客户端生成，不需要服务端发号。
 * 2. 预留同步能力 —— 每张表都带 updated_at / deleted_at / remote_id / sync_state，
 *    将来接云端时直接增量推送"updated_at 比上次同步更晚的行"，不用改表。
 */

export const SCHEMA_VERSION = 3;

/** 表名集中放这里，避免各处硬编码字符串写错 */
export const TABLES = {
  tasks: 'tasks',
  ideas: 'ideas',
  containers: 'containers',
  chains: 'task_chains',
  marks: 'marks',
  focusSessions: 'focus_sessions',
  checkins: 'task_checkins',
  meta: 'app_meta',
} as const;

/**
 * 每个实体表都追加的公共列。
 * 单拎出来是为了保证"预留同步"这件事不在某张表上被漏掉。
 */
const COMMON_COLUMNS = `
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  remote_id   TEXT,
  sync_state  TEXT NOT NULL DEFAULT 'local'
`;

export const DDL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ${TABLES.tasks} (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  note              TEXT,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL,
  time_attribute    TEXT NOT NULL,
  start_at          TEXT,
  end_at            TEXT,
  due_at            TEXT,
  repeat_json       TEXT,
  completion        TEXT NOT NULL,
  target_minutes    INTEGER,
  target_occurrences INTEGER,
  container_id      TEXT,
  tags_json         TEXT NOT NULL DEFAULT '[]',
  priority          INTEGER NOT NULL DEFAULT 2,
  waiting_for       TEXT,
  source            TEXT NOT NULL DEFAULT 'manual',
  completed_at      TEXT,
  reminder_minutes_before INTEGER,
  parent_task_id    TEXT,
  sort_order        REAL,
  progress_json     TEXT NOT NULL DEFAULT '{"accumulatedMinutes":0}',
  ${COMMON_COLUMNS}
);

CREATE TABLE IF NOT EXISTS ${TABLES.ideas} (
  id          TEXT PRIMARY KEY NOT NULL,
  content     TEXT NOT NULL,
  tags_json   TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL DEFAULT 'manual',
  archived_at TEXT,
  ${COMMON_COLUMNS}
);

CREATE TABLE IF NOT EXISTS ${TABLES.containers} (
  id        TEXT PRIMARY KEY NOT NULL,
  kind      TEXT NOT NULL,
  title     TEXT NOT NULL,
  note      TEXT,
  parent_id TEXT,
  start_at  TEXT,
  end_at    TEXT,
  status    TEXT NOT NULL DEFAULT 'active',
  ${COMMON_COLUMNS}
);

CREATE TABLE IF NOT EXISTS ${TABLES.chains} (
  id         TEXT PRIMARY KEY NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  ${COMMON_COLUMNS}
);

CREATE TABLE IF NOT EXISTS ${TABLES.marks} (
  id            TEXT PRIMARY KEY NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  date          TEXT NOT NULL,
  repeat_yearly INTEGER NOT NULL DEFAULT 0,
  ${COMMON_COLUMNS}
);

CREATE TABLE IF NOT EXISTS ${TABLES.focusSessions} (
  id              TEXT PRIMARY KEY NOT NULL,
  task_id         TEXT,
  intent          TEXT,
  note            TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  planned_minutes INTEGER,
  actual_seconds  INTEGER NOT NULL DEFAULT 0,
  growth_seconds  INTEGER NOT NULL DEFAULT 0,
  ${COMMON_COLUMNS}
);

-- 习惯打卡：一件事在"某一天"发生过，就是一条记录。
-- 与"完成任务"分开存，是因为习惯是一件事重复发生多次（跑步第 30 天），
-- 而任务只有一次完成态；连续天数/热力图都靠这张表算。
CREATE TABLE IF NOT EXISTS ${TABLES.checkins} (
  id            TEXT PRIMARY KEY NOT NULL,
  task_id       TEXT NOT NULL,
  day_key       TEXT NOT NULL,
  minute_of_day INTEGER,
  note          TEXT,
  ${COMMON_COLUMNS}
);

-- 索引：查询路径都是"按状态筛 / 按时间筛 / 按容器筛"，且都要排除软删除
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON ${TABLES.tasks}(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due         ON ${TABLES.tasks}(due_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_start       ON ${TABLES.tasks}(start_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_container   ON ${TABLES.tasks}(container_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent      ON ${TABLES.tasks}(parent_task_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_ideas_archived    ON ${TABLES.ideas}(archived_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_focus_task        ON ${TABLES.focusSessions}(task_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_focus_started     ON ${TABLES.focusSessions}(started_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_checkins_task     ON ${TABLES.checkins}(task_id, day_key, deleted_at);
`;

/**
 * 增量迁移：key = 目标版本号，value = 该版本要执行的语句序列。
 *
 * 只做"加列"这类向后兼容的变更；破坏性变更将来在这里写
 * "建新表 → 搬数据 → 改名" 的完整脚本。语句尽量写成幂等安全的形式，
 * 执行器会对 "duplicate column" 容错（老库可能已被 DDL 兜底建出列）。
 */
export const MIGRATIONS: Readonly<Record<number, readonly string[]>> = {
  2: [`ALTER TABLE ${TABLES.tasks} ADD COLUMN reminder_minutes_before INTEGER`],
  /**
   * v3 = 子任务 + 手动排序（打卡表由 DDL 的 CREATE TABLE IF NOT EXISTS 兜底，
   * 不需要在这里重复写）。
   *
   * sort_order **不做事后回填**：老数据留 NULL，查询用
   * `COALESCE(sort_order, 0) ASC, created_at DESC` —— NULL 等价于 0，
   * 于是老数据的分组与顺序跟迁移前完全一致（同一时刻按创建时间倒序），
   * 用户拖过之后才写入 1..n 的显式顺序。这样迁移零风险、无需搬数据。
   */
  3: [
    `ALTER TABLE ${TABLES.tasks} ADD COLUMN parent_task_id TEXT`,
    `ALTER TABLE ${TABLES.tasks} ADD COLUMN sort_order REAL`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON ${TABLES.tasks}(parent_task_id, deleted_at)`,
  ],
};
