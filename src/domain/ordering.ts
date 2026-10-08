/**
 * 手动排序（纯逻辑）。
 *
 * 两个动作：把某一项挪到某个位置、把整份列表换算成写库用的权重。
 * 手指位移到落点的换算**不在这里** —— 它跟行高、是否拖出、有没有投递区
 * 都有关，已经收在 `components/reorderable-list` 里（那里才知道自己长什么样）。
 */

/** 把 from 位置的元素移到 to 位置（to 是移动后的目标下标），返回新数组 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(next.length - 1, to));
  if (clamped === from) return next;
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * 写库用的权重：整份列表按当前顺序编成 1..n。
 *
 * 为什么整份重写而不是"插到两项中间取中值"：
 * 个人待办一份列表几十条，一次全写无所谓；而中值法会随着反复插入
 * 让浮点精度耗尽（两次插入就分不开了），到时候还得写重整逻辑。
 * 简单可靠优先。
 */
export function orderWeights(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}
