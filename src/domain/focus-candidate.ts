import { formatTime, isSameDayIso } from '@/utils/datetime';

import { TaskStatus, TimeAttribute } from './enums';
import type { Task } from './task';

/**
 * 「现在做哪件」—— 首页专注卡的提案来源。
 *
 * 为什么要有这一层：
 * 首页若只给一个空白计时器，用户答不出"我该专注什么"，就会切回列表去挑；
 * 若直接铺一整张列表，那又回到"进门先做管理"。所以首页给的是**一个提案**：
 * 一件事 + 一句"为什么是它"；觉得不对就「换一件」，一路换到底。
 *
 * 规则刻意做得又笨又短，从上往下第一个命中就是答案：
 *   ① 进行中        —— 你自己已经说了"我在做这个"，最该回到它
 *   ② 今天有固定时间 —— 按"离现在多近"排；已过点的也算（欠着的比未来的更该做）
 *   ③ 今天到期       —— 按到期时间先后
 *   ④ 收集箱第一条   —— 那是你自己拖出来的顺序，就是你的意愿
 *   ⑤ 都没有        —— 返回 null，界面不显示提案卡（只留输入框），不硬凑一件出来
 *
 * 排序必须**确定性**：同一份数据换个读取顺序，提案不能跟着变。
 * 所以每条规则都补了固定的次关键字（updatedAt → id），不依赖数组顺序。
 */

export interface FocusCandidate {
  task: Task;
  /** 为什么是它。直接显示给用户 —— 提案解释不了自己，就不如不提 */
  reason: string;
}

export interface FocusCandidateInput {
  /** 今天要面对的（含正在进行的），来自 taskRepository.listToday */
  today: readonly Task[];
  /** 收集箱（中档待规划）。顺序 = 用户手动排的序，这里不再重排 */
  inbox: readonly Task[];
  now?: Date;
}

const isOpen = (task: Task): boolean => task.status !== TaskStatus.Done;

/** 按优先级排好的候选队列 —— 首页「换一件」就是往后走一格 */
export function listFocusCandidates(input: FocusCandidateInput): FocusCandidate[] {
  const now = input.now ?? new Date();
  const pool = input.today.filter(isOpen);
  const out: FocusCandidate[] = [];

  // ① 进行中：最近动过的那件最像"手头这件事"
  const doing = pool
    .filter((task) => task.status === TaskStatus.Doing)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  for (const task of doing) {
    out.push({ task, reason: '你标了「进行中」，接着做' });
  }

  // ② 今天有固定时间：离现在最近的在最前
  const timed = pool
    .filter((task) => task.time.attribute === TimeAttribute.Fixed && task.time.startAt)
    .filter((task) => isSameDayIso(task.time.startAt, now))
    .map((task) => ({ task, at: Date.parse(task.time.startAt as string) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort(
      (a, b) =>
        Math.abs(a.at - now.getTime()) - Math.abs(b.at - now.getTime()) ||
        a.at - b.at ||
        a.task.id.localeCompare(b.task.id),
    );
  for (const { task, at } of timed) {
    out.push({
      task,
      reason:
        at > now.getTime()
          ? `${formatTime(task.time.startAt)} 开始，是现在最近的一件事`
          : '已经过点了，还挂着',
    });
  }

  // ③ 今天到期
  const due = pool
    .filter((task) => Boolean(task.time.dueAt) && isSameDayIso(task.time.dueAt, now))
    .map((task) => ({ task, at: Date.parse(task.time.dueAt as string) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at || a.task.id.localeCompare(b.task.id));
  for (const { task } of due) {
    out.push({ task, reason: '今天到期' });
  }

  // ④ 收集箱：保留用户自己的排序
  for (const task of input.inbox.filter(isOpen)) {
    out.push({ task, reason: '收集箱里排在最前面的' });
  }

  // 同一件事可能同时命中多条（"进行中 + 今天 15:00"），去重但保留最靠前的理由
  const seen = new Set<string>();
  return out.filter((candidate) => {
    if (seen.has(candidate.task.id)) return false;
    seen.add(candidate.task.id);
    return true;
  });
}

/** 提案 = 队列里的第一个；撑不起来就 null */
export function pickFocusCandidate(input: FocusCandidateInput): FocusCandidate | null {
  return listFocusCandidates(input)[0] ?? null;
}
