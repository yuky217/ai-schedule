/**
 * 本地 ID 生成。
 *
 * 刻意不引入 uuid 依赖：离线优先的应用需要"客户端可生成、单调递增、肉眼可读"的 ID。
 * 时间戳前缀让按 ID 排序 ≈ 按创建时间排序，调试时也能一眼看出创建先后。
 */
export function createId(prefix?: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const body = `${time}${rand}`;
  return prefix ? `${prefix}_${body}` : body;
}
