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
}
