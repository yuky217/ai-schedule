import { TimeAttribute } from './enums';
import type { TaskKind } from './enums';
import type { TaskTime } from './task';

/**
 * 两档分流（主文档第四节）。
 *
 * 这是整个产品的"记 → 分"环节，也是最该被单测覆盖的一段：
 * 纯函数、没有 IO、没有 UI，输入一段记录 + 解析出的时间，输出它该去哪儿。
 */

export type CaptureRoute = 'idea' | 'calendar' | 'inbox';

export interface CaptureDraft {
  text: string;
  /** 解析出的时间。来源可以是能力层（AI）解析，也可以是用户手动点选 */
  time?: TaskTime | null;
  /** 用户在记录当下就明确"这是灵感" */
  markedAsInspiration?: boolean;
}

export interface RouteDecision {
  route: CaptureRoute;
  /** 建议的任务类型 */
  kind: TaskKind;
  /** 为什么这么分 —— 界面可以直接展示给用户，让他一眼看懂 */
  reason: string;
}

export function decideRoute(draft: CaptureDraft): RouteDecision {
  if (draft.markedAsInspiration) {
    return { route: 'idea', kind: 'idea', reason: '标记为灵感 → 想法库' };
  }

  const time = draft.time;
  if (!time || time.attribute === TimeAttribute.None) {
    return {
      route: 'inbox',
      kind: inferKind(draft.text),
      reason: '没有明确时间 → 待办（等你安排）',
    };
  }

  if (time.attribute === TimeAttribute.Fixed) {
    return { route: 'calendar', kind: 'schedule', reason: '有固定时间 → 日历' };
  }

  return { route: 'calendar', kind: 'execution', reason: '有明确截止 → 日历' };
}

/**
 * 没有时间信息时的兜底分类。
 *
 * 骨架阶段用最朴素的启发式，够用就行；
 * 真正的"理解"是能力层的事（主文档 3.1），能力关闭时这段启发式就是降级方案。
 */
function inferKind(text: string): TaskKind {
  const t = text.trim();
  if (!t) return 'execution';
  if (/(每周|每天|每月|每日|隔天|每周\d次|习惯)/.test(t)) return 'habit';
  if (/(跑步|健身|背单词|阅读|冥想|练琴|打卡|喝\d*杯水)/.test(t)) return 'habit';
  if (/(灵感|想法|点子|也许|要不要|考虑)/.test(t)) return 'idea';
  return 'execution';
}
