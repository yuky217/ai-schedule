import { SyncState } from './enums';

/**
 * 所有实体的公共字段。
 *
 * 这里刻意带上 `updatedAt / deletedAt / remoteId / syncState` 四个字段：
 * 主文档第七节要求"先做纯本地，但数据模型预留同步能力"。
 * 现在它们不影响任何逻辑（全部当纯本地用），
 * 将来升级成"本地优先 + 云同步"时不需要改表结构、不需要数据迁移。
 */
export interface BaseEntity {
  /** 本地主键，客户端生成（离线也能建） */
  id: string;
  /** ISO 8601 字符串 */
  createdAt: string;
  updatedAt: string;
  /** 软删除时间。为同步预留：删除也要能同步出去，所以不物理删 */
  deletedAt?: string | null;
  /** 云端主键。纯本地阶段恒为 null */
  remoteId?: string | null;
  syncState: SyncState;
}
