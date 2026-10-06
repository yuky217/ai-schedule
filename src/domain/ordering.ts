/**
 * 手动排序（纯逻辑）。
 *
 * 只有两个动作：把某一项挪到某个位置、以及把整份列表换算成写库用的权重。
 * 界面上"拖到哪儿"那个判断也放在这里，是为了能用用例把边界（拖到最前/最后/原地不动）
 * 钉死 —— 拖拽的坐标换算最容易出现"差一格"的 off-by-one。
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
 * 手指位移 → 落点下标。
 *
 * 向上/向下都是"跨过多少个行高"，用四舍五入而不是取整：
 * 拖到相邻行的中线上就该换位，取整会让手感迟半格。
 */
export function dropIndex(
  originIndex: number,
  deltaY: number,
  rowHeight: number,
  count: number,
): number {
  if (rowHeight <= 0) return originIndex;
  const shifted = originIndex + Math.round(deltaY / rowHeight);
  return Math.max(0, Math.min(count - 1, shifted));
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
