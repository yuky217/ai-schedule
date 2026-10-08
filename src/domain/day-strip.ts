/**
 * 日期投递条：把一件事「拖到某一天」时，那一条日期格的数据与命中检测。
 *
 * 为什么不是整个月历：拖拽时浮出的面板不能盖住手指。收集箱列表从屏幕顶部
 * 往下排，手指多半停在中段，一块六行的月历会正好压在手指底下 —— 用户看不见
 * 自己扔到哪儿了。所以只给「今天起两周」这一条细带（两行 × 7 格），贴在最底下，
 * 手指往下扔就行。
 *
 * 为什么只有两周：再远的日子不该靠拖。收集箱的长按菜单（今天/明天/周末/下周）
 * 已经覆盖了高频说法；真要安排到下个月，那是「想清楚了」的事，该进详情页写清楚，
 * 而不是在一条浮带上划过去。
 *
 * 纯 TypeScript（可单测），不依赖 RN / Expo。
 */

/** 投递条上的天数（两行 × 7 列） */
export const DAY_STRIP_COUNT = 14;
/** 列数固定 7 —— 一行就是一个星期，与月历、周视图同一套读法 */
export const DAY_STRIP_COLS = 7;

/** 一块矩形（窗口坐标，来自 measureInWindow） */
export interface StripRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 「今天起 count 天」，每天取**本地零点** —— 只谈哪天，不谈几点。
 *
 * 零点而不是此刻：投递条回答的是「放到哪一天」，如果拿此刻当基准，
 * 同一格在 23:59 和次日 00:01 会差一天，用户看不出为什么。
 */
export function dayStripDays(base: Date = new Date(), count: number = DAY_STRIP_COUNT): Date[] {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/**
 * 手指落在第几个格子上（0 起）；不在条上就 null。
 *
 * 纯数学，不给每个格子注册 ref：格子等宽等高、排成规则的网格，拿整条的外框
 * 一除就够了。14 个 ref + 14 次 measureInWindow 是白花的钱，而且测量是异步的
 * —— 条刚浮出来、格子还没量到时按下，就等于没反应。
 *
 * 落在条外返回 null 而不是「就近算一格」：松手时宁可什么都不做（这条留在
 * 收集箱里），也不能猜一个用户没指的日期把任务悄悄搬走。
 */
export function dayStripIndexAt(
  rect: StripRect,
  point: { x: number; y: number },
  count: number = DAY_STRIP_COUNT,
): number | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (point.x < rect.x || point.x > rect.x + rect.width) return null;
  if (point.y < rect.y || point.y > rect.y + rect.height) return null;

  const rows = Math.ceil(count / DAY_STRIP_COLS);
  const col = Math.min(
    DAY_STRIP_COLS - 1,
    Math.floor(((point.x - rect.x) / rect.width) * DAY_STRIP_COLS),
  );
  const row = Math.min(rows - 1, Math.floor(((point.y - rect.y) / rect.height) * rows));
  const index = row * DAY_STRIP_COLS + col;
  return index < count ? index : null;
}
