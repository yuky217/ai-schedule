/**
 * 本地数据库结构（SQLite）。
 *
 * 两条硬约束来自主文档第七节：
 * 1. 先做纯本地 —— 所有实体都能离线创建，主键由客户端生成，不需要服务端发号。
 * 2. 预留同步能力 —— 每张表都带 updated_at / deleted_at / remote_id / sync_state，
 *    将来接云端时直接增量推送"updated_at 比上次同步更晚的行"，不用改表。
 *
 * 启动顺序写在 bootstrap.ts：PRAGMA → 建表 → 迁移 → 建索引。
 * **顺序不能换**，原因见 INDEXES 上的注释（换过，代价是升级后 App 直接起不来）。
 */

export const SCHEMA_VERSION = 8;

/** 表名集中放这里，避免各处硬编码字符串写错 */
export const TABLES = {
  tasks: 'tasks',
  ideas: 'ideas',
  containers: 'containers',
  chains: 'task_chains',
  marks: 'marks',
  focusSessions: 'focus_sessions',
  checkins: 'task_checkins',
  courses: 'courses',
  terms: 'terms',
  events: 'events',
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

/**
 * 每次开库都先跑的 PRAGMA。
 * journal_mode 会返回一行结果，用 execAsync / exec 执行即可（返回值被忽略）。
 */
export const PRAGMAS: readonly string[] = [
  `PRAGMA journal_mode = WAL;`,
  // 外键约束默认关闭，显式打开，容器层级靠它兜底
  `PRAGMA foreign_keys = ON;`,
];

/**
 * 表结构（CREATE TABLE IF NOT EXISTS）。
 *
 * **不要往这里加"引用新增列"的索引** —— 见下面 INDEXES 的说明。
 */
export const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ${TABLES.tasks} (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  note              TEXT,
  location          TEXT,
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
  -- 拆解出来的那条父任务（见 domain/idea-breakdown.ts）。
  -- 想法库原本是条死路：只能归档、变不成"要做的"。这一列就是那条出口的凭据，
  -- 有了它，一条想法才能说出"我已经被拆成 N 步了"。
  breakdown_task_id TEXT,
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

-- 课程（课程表）：与任务并列的独立实体。
-- 为什么不塞进任务表：课没有"完成态"（下周它还得在），而且课表描述的是
-- "第几周、周几、第几节"这种学期框架，不是某天要做的一件事。
-- 上课安排（周几/节次/周次/地点）存成 sessions_json —— 它是课程的固有部分，
-- 没有单独查询的需要（课表按整门课读出来画格子），拆表只会多一层 join。
CREATE TABLE IF NOT EXISTS ${TABLES.courses} (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  teacher       TEXT,
  location      TEXT,
  note          TEXT,
  color_index   INTEGER NOT NULL DEFAULT 0,
  sessions_json TEXT NOT NULL DEFAULT '[]',
  -- 单次调课/停课（只覆盖某一天那一次，不动整学期）。与 sessions 同一个理由放在
  -- 课程行上：永远跟课程一起读出来画格子，没有单独查询的需要。
  changes_json  TEXT NOT NULL DEFAULT '[]',
  reminder_minutes_before INTEGER,
  ${COMMON_COLUMNS}
);

-- 固定日程（考试、纪念日这类"到点发生"的事）：与任务并列的独立实体。
-- 为什么不塞进任务表：考试没有"完成态"（考完不需要勾，勾了反而要处理
-- "完成的考试还算不算日程"这种怪问题），也没有专注时长；硬塞进去会污染
-- 收集箱/回顾的口径。纪念日目前仍在 marks 表（它是"倒数几天的标记"，
-- 不带时刻、不进日历时间轴），将来若要统一再迁，不急着动老数据。
CREATE TABLE IF NOT EXISTS ${TABLES.events} (
  id        TEXT PRIMARY KEY NOT NULL,
  kind      TEXT NOT NULL,
  title     TEXT NOT NULL,
  location  TEXT,
  note      TEXT,
  start_at  TEXT NOT NULL,
  end_at    TEXT,
  source    TEXT NOT NULL DEFAULT 'manual',
  ${COMMON_COLUMNS}
);

-- 学期：把"第几周"落到具体日期的唯一依据，也存作息表（第几节 = 几点）。
-- 做成表而不是塞进 app_meta：**它是用户数据，必须跟着备份走** ——
-- 藏在 meta 里的话，恢复备份之后学期起始日没了，整张课表算不出一周是第几周，
-- 界面上就是"课表空了"，而且是静默的。
CREATE TABLE IF NOT EXISTS ${TABLES.terms} (
  id            TEXT PRIMARY KEY NOT NULL,
  label         TEXT NOT NULL,
  start_day_key TEXT NOT NULL,
  total_weeks   INTEGER NOT NULL,
  periods_json  TEXT NOT NULL DEFAULT '[]',
  ${COMMON_COLUMNS}
);

`;

/**
 * 索引：查询路径都是"按状态筛 / 按时间筛 / 按容器筛"，且都要排除软删除。
 *
 * **必须在迁移之后执行**（见 client.ts 的启动顺序），原因是踩过的坑：
 * `CREATE TABLE IF NOT EXISTS` 对老库是空操作，老库的 tasks 表里没有新列；
 * 如果索引跟建表语句写在同一段里、在 `ALTER TABLE ADD COLUMN` 之前执行，
 * 就会以 `no such column: parent_task_id` 整个失败，连库都打不开。
 *
 * 规则：**凡是引用"某个迁移版本才加出来的列"的索引，一律放这里**；
 * 只引用建表时就有的列的索引，放哪里都行，但为了统一也放这里。
 */
export const INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_tasks_status      ON ${TABLES.tasks}(status, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due         ON ${TABLES.tasks}(due_at, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_start       ON ${TABLES.tasks}(start_at, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_container   ON ${TABLES.tasks}(container_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent      ON ${TABLES.tasks}(parent_task_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ideas_archived    ON ${TABLES.ideas}(archived_at, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_focus_task        ON ${TABLES.focusSessions}(task_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_focus_started     ON ${TABLES.focusSessions}(started_at, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_checkins_task     ON ${TABLES.checkins}(task_id, day_key, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_courses_title     ON ${TABLES.courses}(title, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_start      ON ${TABLES.events}(start_at, deleted_at)`,
];

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
   * v3 = 子任务 + 手动排序（打卡表与索引由 DDL / INDEXES 兜底，
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
  ],
  /**
   * v4 = 课程表（courses + terms）。
   * 两张都是**新表**，由 DDL 的 `CREATE TABLE IF NOT EXISTS` 建出来，
   * 老库升级不需要任何 ALTER —— 这里留空数组是为了让版本号照常推进。
   */
  4: [],
  /**
   * v5 = events 表（固定日程，第一批数据是考试）。
   * 新表由 DDL 的 `CREATE TABLE IF NOT EXISTS` 建出来，老库升级无需 ALTER。
   */
  5: [],
  /**
   * v6 = courses 加 changes_json（单次调课：只改某一天那一次，不动整学期）。
   *
   * 加列而不是开新表：它跟 sessions_json 一样，永远跟课程一起读出来画格子，
   * 没有单独查询的需要，量也极小（一学期几条）。**带上 NOT NULL DEFAULT '[]'**，
   * 于是老数据不需要回填 —— 没有单次调整就是空数组，读出来跟以前完全一致。
   */
  6: [
    `ALTER TABLE ${TABLES.courses} ADD COLUMN changes_json TEXT NOT NULL DEFAULT '[]'`,
  ],
  /**
   * v7 = ideas 加 breakdown_task_id（想法拆解成任务）。
   *
   * 加列而不是开新表：它只是想法上的一个指针（"我说出去的那件事在哪"），
   * 永远跟着想法一起读出来，没有单独查询的需要。
   * **可空**，于是老数据不用回填 —— 没拆过的想法读出来跟以前完全一样。
   */
  7: [
    `ALTER TABLE ${TABLES.ideas} ADD COLUMN breakdown_task_id TEXT`,
  ],
  /**
   * v8 = tasks 加 location（地点）。
   *
   * 课程与固定日程**早就有这个列**，只有任务没有 —— 于是"粘一整段通知"里
   * 那句「地点：xxx」只能躺在备注里，日历上看不见"要去哪"。
   * 加列而不是开新表：它跟 note 一样是任务自己的一行属性，永远随任务一起读出来。
   * **可空**，于是老数据不用回填 —— 没填过地点的任务读出来跟以前完全一样。
   */
  8: [`ALTER TABLE ${TABLES.tasks} ADD COLUMN location TEXT`],
};
