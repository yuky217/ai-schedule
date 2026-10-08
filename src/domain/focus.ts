import type { BaseEntity } from './base';

/** 时长档位（设置页与专注页共用同一份，两边不会出现不一样的档） */
export const FOCUS_MINUTE_PRESETS = [15, 25, 45, 60] as const;

/**
 * 专注会话（主文档第六节）。
 *
 * 设计要点，写死在模型里：
 * - `growthSeconds`「只涨不落，不惩罚」—— 它是小东西的生长量，
 *   中断也会保留，绝不因为退出而回退。
 * - `note` 绑定在"这件事"下（属于会话），而全局随手记是另一个入口，两者不混。
 * - `intent` 支持结束时才命名"这是什么事"（开始前可以不知道自己在干嘛）。
 */
export interface FocusSession extends BaseEntity {
  /** 绑定的任务；允许为空 —— 允许"先专注，稍后归类" */
  taskId?: string | null;
  /** 结束时命名 / 调整"这是什么事" */
  intent?: string | null;
  /** 专注中记的备注 */
  note?: string | null;
  startedAt: string;
  endedAt?: string | null;
  plannedMinutes?: number | null;
  actualSeconds: number;
  /** 小东西累计生长秒数（只涨不落） */
  growthSeconds: number;
}
