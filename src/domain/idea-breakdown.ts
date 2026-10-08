/**
 * 想法 → 能动手的步骤。
 *
 * 想法库在此之前是一条**死路**：记进去的东西只能归档，没有任何办法变成"要做的"
 * （想法页上只有「记下来」和「归档」两个动作）。于是"不丢"这个承诺只兑现了一半 ——
 * 没丢，但也没用。
 *
 * 拆解就是那条出口。它是**纯手写**的，不依赖能力层：此刻最清楚这件事该怎么拆的
 * 是用户自己；AI 只在能力层开启时作为替代（主文档 3.1 的 Breakdown）。
 *
 * 三条口径：
 *
 * 1. **标题取第一行，不取整段。** 想法常常是"一句标题 + 一段展开"，
 *    把整段塞进任务标题，收集箱里就会出现一条糊成一团的巨长行。
 * 2. **第一行过长要截断，但一个字都不丢。** 任务标题的用途是"扫一眼认出来"；
 *    截掉的部分进 note —— 截断是为了好看，不是为了省地方。
 * 3. **步骤先洗一遍。** 空串直接去掉（手机上多敲一个换行太容易了），
 *    重复的合并（同一步写两遍是误操作，不是"要做两次"），顺序原样保留。
 *
 * 产出的形态是**一条父任务 + N 条子任务**，而不是 N 条并列的任务：
 * 拆出来的步骤离开那件事就没有意义（"查资料"是谁在查？），
 * 散进收集箱只会把箱子搅浑。挂在父任务下还白拿一条规则 ——
 * 子任务全部完成时父任务自动完成，正是"这件事做完了"的定义。
 */

/** 父任务标题的字数上限。超出的部分不丢，进 note */
export const BREAKDOWN_TITLE_MAX = 40;

/** 一次最多拆几步。再多就该分成两个想法了，收集箱也不是堆料场 */
export const BREAKDOWN_STEP_MAX = 20;

export interface BreakdownPlan {
  /** 父任务标题（想法第一行，必要时截断） */
  title: string;
  /** 想法原文。与标题一致时为 null —— 一样的话写两遍是噪音 */
  note: string | null;
  /** 洗完的步骤，顺序保留 */
  steps: string[];
}

/**
 * 把一条想法 + 用户写下的步骤，整理成"要落库的东西"。
 *
 * 返回 null 表示**这次什么都不该做**（没写步骤、想法是空的）。
 * 让调用方拿到 null 就停手，比返回一个半成品再去判空安全。
 */
export function planBreakdown(content: string, rawSteps: readonly string[]): BreakdownPlan | null {
  const steps = cleanSteps(rawSteps);
  if (!steps.length) return null;

  const trimmed = content.trim();
  // 第一个**非空**行才是标题：想法前面拖了几个空行是很常见的
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const title = firstLine.trim().slice(0, BREAKDOWN_TITLE_MAX);
  if (!title) return null;

  return { title, note: trimmed === title ? null : trimmed, steps };
}

function cleanSteps(rawSteps: readonly string[]): string[] {
  const seen = new Set<string>();
  const steps: string[] = [];

  for (const raw of rawSteps) {
    const step = raw.trim();
    if (!step || seen.has(step)) continue;
    seen.add(step);
    steps.push(step);
    if (steps.length >= BREAKDOWN_STEP_MAX) break;
  }

  return steps;
}
