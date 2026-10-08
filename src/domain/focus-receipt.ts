import { formatTime } from '@/utils/datetime';

import { MIN_FOCUS_SECONDS } from './focus-link';

/**
 * 专注结束之后的那句"回执"。
 *
 * 为什么单独抽出来做纯函数：专注结束是这个 App 里**副作用最多的一个动作** ——
 * 记时长、补日历时段、写打卡、标完成、新建一条记录，分散在好几条分支里。
 * 而用户按下"结束"之后看到的只有一个计时器消失、页面退回首页，
 * 于是"我刚才那一下到底干了什么"完全靠猜 —— 这就是"任务不知道去哪了"的另一半。
 *
 * 所以规矩是：**凡是有副作用的路径，都必须产出一句说清事实的话**，
 * 而且这句话的措辞要跟着"实际发生了什么"走：
 * 没记上就说没记上，别说得像记上了（这就是它值得被测的原因）。
 */

/**
 * 用户按下"这段就算把它做完"之后，**实际**发生了什么。
 *
 * 必须分成三种：勾选型是"标成完成"，重复型是"滚到下一次"（状态根本没变完成），
 * 频率型是"记下今天这一次"（它的完成态在打卡表那边）。三者在界面上看起来
 * 都是"我勾了一下"，但落库结果完全不同 —— 回执要是统一说成"已完成"，
 * 用户下次看到它还在清单里会以为出了 bug。
 */
export type FocusMarkOutcome = 'done' | 'rolled' | 'checked-in';

export interface FocusReceiptFacts {
  /** 这次专注的净秒数 */
  seconds: number;
  /** 绑定的任务标题；没绑定任务则为 null */
  boundTitle: string | null;
  /** 没绑定任务、结束时才起的名字 */
  intent: string | null;
  /** 补到日历上的那一段（没落日历就是 null） */
  span: { startAt: string; endAt: string } | null;
  /** 绑定的那条任务已经不在清单里了（用户在这期间把它删了） */
  taskMissing?: boolean;
  /** 这次专注是否让任务够目标、自动完成 */
  completed?: boolean;
  /**
   * 本来可以补一段到日历上，但因为"还没做完"而没补。
   * 不说这句，用户会奇怪"上次这段日历上有、这次怎么没有"。
   */
  keptOffCalendar?: boolean;
  /** 频率型的本期进度（已经算好的一句话，来自 habit-period） */
  periodNote?: string | null;
  /** 用户勾了"这段就算把它做完"且确实生效时的真实结果 */
  markOutcome?: FocusMarkOutcome | null;
}

const MARK_TAIL: Record<FocusMarkOutcome, string> = {
  done: '并按你说的标成了完成',
  rolled: '并按重复规则滚到了下一次',
  'checked-in': '并记下了今天这一次',
};

/** 秒数 → 人话。不到一分钟不说"0 分钟" */
export function describeFocusSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < MIN_FOCUS_SECONDS) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分钟`;
}

export function describeFocusReceipt(facts: FocusReceiptFacts): string {
  const { seconds, boundTitle, intent, span } = facts;
  const tooShort = seconds < MIN_FOCUS_SECONDS;
  const duration = describeFocusSeconds(seconds);

  // ① 没绑任务 —— 这段专注自己成了一条日历记录（名字可选，没名字就叫「专注」）
  if (!boundTitle && span) {
    const where = `${formatTime(span.startAt)}–${formatTime(span.endAt)}`;
    return intent
      ? `「${intent}」已经记到日历上：${where}，统计里也算这一段。`
      : `这段 ${duration} 记到了日历上：${where}，统计里也算这一段。`;
  }

  // ② 绑定的任务不见了（用户中途删了它，或者任务详情页那边刚把它删掉）
  if (boundTitle && facts.taskMissing) {
    return `这段 ${duration} 记进了统计，但原本挂着的「${boundTitle}」已经不在清单里了。`;
  }

  // ③ 太短，什么都没记到任务上 —— 必须明说，否则用户以为记上了
  if (boundTitle && tooShort) {
    return `只专注了 ${duration}，不到一分钟，没记到「${boundTitle}」身上 —— 它在清单里没动。`;
  }

  // ④ 有绑定的任务，正常记账
  if (boundTitle) {
    const parts: string[] = [`${duration}记到了「${boundTitle}」身上`];

    if (span) {
      parts.push(`日历上留下 ${formatTime(span.startAt)}–${formatTime(span.endAt)} 这一段`);
    } else if (facts.keptOffCalendar) {
      parts.push('没往日历上放，因为它还没做完');
    }
    if (facts.completed) parts.push('够目标了，已自动完成');
    if (facts.markOutcome) parts.push(MARK_TAIL[facts.markOutcome]);

    let message = parts.join('，') + '。';
    if (facts.periodNote) message += ` · ${facts.periodNote}`;
    return message;
  }

  // ⑤ 太短 —— 什么都不记，明说
  if (tooShort) {
    return `只专注了 ${duration}，不到一分钟，没记进统计。`;
  }
  // 兜底：时段没算出来（极少，比如起点时间读不出来）—— 统计里至少有这一段
  return `这段 ${duration} 记进了统计。`;
}
