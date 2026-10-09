/**
 * 领域枚举与常量 —— 对应《项目主文档》第五、七节。
 *
 * 这一层是纯 TypeScript，不依赖 React Native / Expo：
 * 方便单测、方便将来抽成 shared 包给多端复用。
 */

/** 任务类型（主文档 5.1） */
export const TaskKind = {
  /** 日程型：开会、上课。固定时间，到点提醒一声，到点/手动完成 */
  Schedule: 'schedule',
  /** 执行型：写作业、写策划。可无时间（常有截止），点击进专注，手动勾选完成 */
  Execution: 'execution',
  /** 时长 / 习惯型：跑步、背单词、"每周 3 次"。重复/频率，够时长或够频率自动完成 */
  Habit: 'habit',
  /** 想法型：灵感、念头。无时间，不提醒，待在想法库 */
  Idea: 'idea',
} as const;
export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

/** 状态流转（主文档 5.2）：待办 → 进行中 → 等待中（等别人） → 完成 */
export const TaskStatus = {
  Todo: 'todo',
  Doing: 'doing',
  /** 阻塞在别人身上，不算"该你做"，排程时要跳过 */
  Waiting: 'waiting',
  Done: 'done',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** 时间属性（主文档 5.3） */
export const TimeAttribute = {
  /** 固定时间：几点到几点 */
  Fixed: 'fixed',
  /** 截止：有个 ddl */
  Deadline: 'deadline',
  /** 无时间 */
  None: 'none',
} as const;
export type TimeAttribute = (typeof TimeAttribute)[keyof typeof TimeAttribute];

/** 完成判定（主文档 5.3） */
export const CompletionRule = {
  /** 手动勾选 */
  Check: 'check',
  /** 够时长自动完成 */
  Duration: 'duration',
  /** 够频率自动完成 */
  Frequency: 'frequency',
} as const;
export type CompletionRule = (typeof CompletionRule)[keyof typeof CompletionRule];

/**
 * 容器类型（主文档 5.3）：甘特图只是视图，不是新实体。
 *
 * 只有「目标」和「项目」两种 —— **「文件夹」已经撤掉**（2026-10-10）：
 * 它在界面上跟项目长得一样（都能装任务、都能套娃、都出现在同一个列表里），
 * 唯一的区别是名字。多一个类型，就多一次"建的时候该选哪个"的判断，
 * 和一处永远要跟着维护的文案，换来的却是"这俩到底有什么不一样"的困惑。
 *
 * 库里历史数据可能还有 kind='folder' 的行。**不写迁移改它们** ——
 * 读库时统一归成项目（见 `db/mappers.containerFromRow`）：
 * 存量数据一个不丢，而写迁移要动整张表，收益为零。
 */
export const ContainerKind = {
  Goal: 'goal',
  Project: 'project',
} as const;
export type ContainerKind = (typeof ContainerKind)[keyof typeof ContainerKind];

/** 链（主文档 5.3）：模板 / 工作流（完成 A → 生成 B） */
export const ChainKind = {
  Template: 'template',
  Workflow: 'workflow',
} as const;
export type ChainKind = (typeof ChainKind)[keyof typeof ChainKind];

/** 标记（主文档 5.3）：独立于任务 */
export const MarkKind = {
  /** 倒数纪念日：还剩几天 */
  Countdown: 'countdown',
  /** 正数纪念日：已经多少天 */
  CountUp: 'countup',
} as const;
export type MarkKind = (typeof MarkKind)[keyof typeof MarkKind];

/** 记录来源（主文档 3.1 入口层）：顺其自然、随用随走 */
export const CaptureSource = {
  Manual: 'manual',
  Voice: 'voice',
  Screenshot: 'screenshot',
  Share: 'share',
  Widget: 'widget',
  Ai: 'ai',
  /** 从专注里长出来的记录：坐下来做了，结束后才命名 */
  Focus: 'focus',
} as const;
export type CaptureSource = (typeof CaptureSource)[keyof typeof CaptureSource];

/** 同步状态（主文档 7.2：数据模型预留同步能力） */
export const SyncState = {
  /** 纯本地，从未同步 */
  Local: 'local',
  /** 有本地改动待推送 */
  Dirty: 'dirty',
  /** 与远端一致 */
  Synced: 'synced',
} as const;
export type SyncState = (typeof SyncState)[keyof typeof SyncState];

/**
 * 优先级（主文档 5.3）：决定"谁先被排、谁被挤掉"，是自动填充的输入。
 * 约定：数字越小越优先。
 *
 * 目前**界面不暴露**这个维度 —— 主文档的"默认极简、按需展开"里，
 * 优先级属于"高级功能默认关闭"，等自动填充/排程做出来再让它露面。
 */
export const Priority = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
} as const;
export type Priority = 0 | 1 | 2 | 3;

/** 重复频率（时长 / 习惯型） */
export const RepeatFreq = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
} as const;
export type RepeatFreq = (typeof RepeatFreq)[keyof typeof RepeatFreq];

/** 容器生命周期 */
export const ContainerStatus = {
  Active: 'active',
  Done: 'done',
  Archived: 'archived',
} as const;
export type ContainerStatus = (typeof ContainerStatus)[keyof typeof ContainerStatus];
