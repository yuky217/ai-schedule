import { ideaRepository } from '@/data/repositories/idea-repository';
import { taskRepository } from '@/data/repositories/task-repository';
import { CaptureSource } from '@/domain/enums';
import type { TaskKind } from '@/domain/enums';
import { createIdea, createTask } from '@/domain/factory';
import { decideRoute, type CaptureRoute } from '@/domain/routing';
import { parseSchedule } from '@/domain/parse-schedule';
import { resolveReminderMinutes } from '@/domain/reminder';
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
  /**
   * 用户当场设的提醒提前量（分钟）：0 = 准点，**null = 明确不要提醒**。
   * **不传 = 没动过** —— 这时才轮到"文字里写了什么"和"这件事的类型默认值"来决定。
   */
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

  /*
   * 先解析一次（本地启发式，能力层关闭也可用）。
   *
   * **不再"用户给了时间就跳过解析"**：解析出来的不只是时间，还有标题与备注 ——
   * 用户在 chip 里手选过时刻之后，粘进来的那一整段通知照样得提炼出名字，
   * 否则他得到的是一条标题两百字的日程。时间那一项仍然**手动的压过猜的**。
   */
  const parsed = parseSchedule(text);
  const time: TaskTime | null = input.time ?? parsed.time ?? null;
  const displayText = parsed.title.trim() ? parsed.title : text;
  /*
   * 重复同样要接上。"每天 8 点吃药"识别出了 repeat，但如果只把它算出来不写进任务，
   * 用户得到的就是一条**只有今天**的任务 —— 明天不会再出现，而且看不出哪里不对。
   * 用户当场在快捷按钮里设过就以他的为准（手写的永远压过猜的）。
   */
  const repeat = input.repeat ?? parsed.repeat ?? null;

  const decision = decideRoute({
    text: displayText,
    time,
    markedAsInspiration: input.markedAsInspiration,
  });

  // 【灵感】→ 想法库：不提醒、不催办
  if (decision.route === 'idea') {
    /*
     * 想法库的 content 是**用户输入的那段原文**，一字不改。
     * 不能拿解析后的 title/note：那是给任务用的"提炼 + 抠掉时间地点"，
     * 想法不排时间、也没有地点字段，抠掉任何一个字都是白丢信息。
     */
    const idea = createIdea(text, source);
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
  const kind = input.kind ?? decision.kind;
  /*
   * 提醒：**没提就不提醒**（2026-10-08 用户拍板）。
   *
   * 以前只要落到日历就一律排一条准点提醒，于是"没点过提醒那一格"的人也被提醒，
   * 而且准点提醒对"要出门的事"等于没提醒（那一刻人该出发了）。现在的规则：
   * 文字里提到提醒（"提前半小时提醒我"）或用户在 chip 里设过，才有提醒；
   * 只提了"提醒"没给量的，按这件事的类型给默认值（domain/reminder）。
   * 收口在 resolveReminderMinutes —— chip 上显示的值和这里存进库的值必须同源。
   */
  const reminderMinutesBefore = time
    ? resolveReminderMinutes({
        manual: input.reminderMinutesBefore,
        parsed: parsed.reminder,
        parsedUnspecified: parsed.reminderUnspecified,
        kind,
        attribute: time.attribute,
        repeat,
      })
    : null;

  const task = createTask({
    title: displayText,
    note: parsed.note,
    // 地点：解析出来的直接带走（"地点：xxx"已经从备注里切走，不会两边各留一份）
    location: parsed.location,
    kind,
    time: time ?? undefined,
    source,
    containerId: input.containerId ?? null,
    repeat,
    reminderMinutesBefore,
  });
  await taskRepository.create(task);

  // 只有落到日历（有明确时间）的才排提醒；没设提醒时 scheduleTaskReminder 直接返回 null
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
