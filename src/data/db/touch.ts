import { SyncState } from '@/domain/enums';
import { nowIso } from '@/utils/datetime';

interface Touchable {
  updatedAt: string;
  syncState: SyncState;
}

/**
 * 每次写库前统一"打时间戳"。
 *
 * `synced` 的实体被改动后自动降级为 `dirty`，将来同步器只要扫 `dirty` 的行推送即可。
 * 纯本地阶段看不出差别，但语义先立起来，接云端那天不用回头补。
 */
export function touch<T extends Touchable>(entity: T): T {
  return {
    ...entity,
    updatedAt: nowIso(),
    syncState: entity.syncState === SyncState.Synced ? SyncState.Dirty : entity.syncState,
  };
}
