import { ideaRepository } from '@/data/repositories/idea-repository';
import { taskRepository } from '@/data/repositories/task-repository';
import { CaptureSource } from '@/domain/enums';
import type { TaskKind } from '@/domain/enums';
import { createIdea, createTask } from '@/domain/factory';
import { decideRoute, type CaptureRoute } from '@/domain/routing';
import { parseSchedule } from '@/domain/parse-schedule';
import type { RepeatRule, TaskTime } from '@/domain/task';

import { scheduleTaskReminder } from './notifications';

/**
 * 入口层的统一记录动作 —— 主文档主流程的「记 → 分 → 落」三步。
 *
 * 所有入口（首页输入框、语音、截图 OCR、系统分享、桌面小组件）最终都调这一个函数。
 * 好处是分流规则只有一份，改一次全端生效；界面层只管把文本递进来。
 */

export interface QuickCaptureInput {
  text: string;
  source?: CaptureSource;
  /** 用户当场标记"这是灵感" */
  markedAsInspiration?: boolean;
  /** 已解析出的时间。能力层关闭时为 null，走本地启发式 */
  time?: TaskTime | null;
  /**
   * 下面这些来自输入框的"快捷设置按钮"（借鉴滴答清单）：
   * 记的时候顺手把清单 / 重复 / 提醒定了，省得之后再点进详情页补。
   * 全部可选 —— 一个都不给就是最原始的一行字。
   */
  containerId?: string | null;
  repeat?: RepeatRule | null;
  /** 提醒提前量（分钟），0 = 准点 */
  reminderMinutesBefore?: number | null;
  /** 覆盖自动分流的类型（用户明确指定"这是习惯"） */
  kind?: TaskKind;
}

export interface QuickCaptureResult {
  id: string;
  title: string;
  route: CaptureRoute;
  kind: TaskKind;
  /** 分流理由，可直接展示给用户 */
  reason: string;
  /** 是否成功排了提醒 */
  reminderScheduled: boolean;
}

export async function quickCapture(input: QuickCaptureInput): Promise<QuickCaptureResult> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('记录内容不能为空');
  }

  const source = input.source ?? CaptureSource.Manual;

  // 自动识别日程：调用方没给时间时，先从文本里解析一次（本地启发式，能力层关闭也可用）
  const parsed = input.time == null ? parseSchedule(text) : null;
  const time: TaskTime | null = input.time ?? parsed?.time ?? null;
  const displayText = parsed && parsed.title.trim() ? parsed.title : text;

  const decision = decideRoute({
    text: displayText,
    time,
    markedAsInspiration: input.markedAsInspiration,
  });

  // 【灵感】→ 想法库：不提醒、不催办
  if (decision.route === 'idea') {
    const idea = createIdea(displayText, source);
    await ideaRepository.create(idea);
    return {
      id: idea.id,
      title: idea.content,
      route: decision.route,
      kind: decision.kind,
      reason: decision.reason,
      reminderScheduled: false,
    };
  }

  // 【要完成的事】→ 收集箱 / 日历
  const task = createTask({
    title: displayText,
    kind: input.kind ?? decision.kind,
    time: time ?? undefined,
    source,
    containerId: input.containerId ?? null,
    repeat: input.repeat ?? null,
    reminderMinutesBefore: input.reminderMinutesBefore ?? null,
  });
  await taskRepository.create(task);

  // 只有落到日历（有明确时间）的才排提醒
  const reminderScheduled =
    decision.route === 'calendar' ? (await scheduleTaskReminder(task)) !== null : false;

  return {
    id: task.id,
    title: task.title,
    route: decision.route,
    kind: decision.kind,
    reason: decision.reason,
    reminderScheduled,
  };
}
