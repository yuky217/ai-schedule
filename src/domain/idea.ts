import type { BaseEntity } from './base';
import type { CaptureSource } from './enums';

/**
 * 想法 / 灵感（主文档第四节的两档分流之一，软的那一档）。
 *
 * 想法不提醒、不催办，只要求"记下来不丢"，
 * 之后再靠语义检索（能力层）把它捞出来。
 */
export interface Idea extends BaseEntity {
  content: string;
  tags: string[];
  source: CaptureSource;
  /** 归档时间：不删除，只是从主列表移走 */
  archivedAt?: string | null;
  /**
   * 已经被拆成任务时，指向那条父任务。
   *
   * 记在想法这一侧（而不是在任务上留 ideaId）：想法是**来源**，它只需要知道
   * "我说出去的话有没有人接"，不需要反过来遍历谁引用过它。
   * 步数不存这里 —— 那是子任务表的实时事实，存一份就会跟实际对不上。
   */
  breakdownTaskId?: string | null;
}
