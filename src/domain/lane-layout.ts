/**
 * 重叠分道：把同一条时间轴上的若干区间排成"互不遮挡的并列道"。
 *
 * 为什么要有这一层：**同一时刻安排多件事是允许的**（上午两件撞了很常见），
 * 但日历里块是绝对定位的 —— 两个块落在同一段坐标上，后画的那个会整个盖住
 * 前一个，用户看到的是"我另一件事凭空没了"，而不是"这两件撞了"。
 * 分道就是把它们并排铺开，谁都看得见。
 *
 * 规则（纯几何，与颜色、名字无关）：
 * - 互相重叠的算一簇；一簇内每件放进"最早空出来的那条道"；
 * - 一簇里所有件共享同一个道数，这样上午撞一次不会把晚上的事也压成半宽；
 * - 不重叠的件可以共用同一条道，宽度完全不受影响。
 *
 * 课表（`course.layoutSlots`）与日历（日/周）三处共用这一份实现 ——
 * 三处各写一遍的话，很容易出现"日视图并排、周视图叠着"这种不一致。
 */
export interface TimeSpan {
  /** 起点（当天第几分钟 / 任意可比较的刻度） */
  start: number;
  /** 终点，必须 > start */
  end: number;
}

export interface LanePlacement<T> {
  item: T;
  /** 在这簇并发项里排第几条道（0 起） */
  lane: number;
  /** 这簇并发项一共几条道（1 = 独占整幅宽） */
  lanes: number;
}

/**
 * 默认排序：先按起点，再按终点。
 * 给定 `compare` 时必须保证**确定性**——排序不稳的话，同一份数据每次
 * 渲染都可能换位置，界面看着像在抖。
 */
const defaultCompare = <T extends TimeSpan>(a: T, b: T): number => a.start - b.start || a.end - b.end;

export function layoutLanes<T extends TimeSpan>(
  items: readonly T[],
  compare: (a: T, b: T) => number = defaultCompare,
): Array<LanePlacement<T>> {
  const ordered = [...items].sort(compare);
  const out: Array<LanePlacement<T>> = [];
  let cluster: Array<LanePlacement<T>> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const placement of cluster) placement.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const item of ordered) {
    // 与当前这一簇完全断开（起点不早于簇内最晚的终点）→ 收口，另起一簇
    if (cluster.length && item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    clusterEnd = Math.max(clusterEnd, item.end);
    cluster.push({ item, lane, lanes: 1 });
  }
  flush();
  return out;
}
