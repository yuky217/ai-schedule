import { create } from 'zustand';

import { clearAllTables, getDatabase } from '@/data/db/client';
import { checkinRepository } from '@/data/repositories/checkin-repository';
import { containerRepository } from '@/data/repositories/container-repository';
import { focusRepository } from '@/data/repositories/focus-repository';
import { ideaRepository } from '@/data/repositories/idea-repository';
import { markRepository } from '@/data/repositories/mark-repository';
import { taskRepository } from '@/data/repositories/task-repository';
import { quickCapture, type QuickCaptureInput, type QuickCaptureResult } from '@/entry/quick-capture';
import { cancelTaskReminders, scheduleTaskReminder } from '@/entry/notifications';
import type { Checkin } from '@/domain/checkins';
import type { Container, Mark } from '@/domain/container';
import type { CreateContainerInput, CreateMarkInput } from '@/domain/factory';
import { createContainer, createFocusSession, createMark, createSubtask } from '@/domain/factory';
import { applyFocusToTask } from '@/domain/focus-link';
import type { FocusSession } from '@/domain/focus';
import { shiftIsoByDays } from '@/domain/gantt';
import {
  describePeriodReached,
  desiredFrequencyStatus,
  occurrencesInPeriod,
} from '@/domain/habit-period';
import type { Idea } from '@/domain/idea';
import { advanceRepeatingTask } from '@/domain/repeat-next';
import { desiredParentStatus } from '@/domain/subtask-progress';
import { CompletionRule, TaskStatus } from '@/domain/enums';
import type { Task, TaskTime } from '@/domain/task';

/**
 * 全局数据状态。
 *
 * 界面不直接碰仓储，而是从这里读 —— 这样"记完一条，收集箱立刻多一条"
 * 这种联动只在一个地方发生（refresh），不需要页面之间互相通知。
 * 写入同理：容器、纪念日、专注联动也全部走这里的动作。
 */

/** 一次专注带来的反馈，绑定到具体任务上，供任务详情页就地展示 */
export interface FocusFeedback {
  taskId: string;
  message: string;
}

interface AppState {
  /** 数据库初始化完成 */
  ready: boolean;
  initializing: boolean;
  error: string | null;

  inbox: Task[];
  today: Task[];
  /**
   * 数据版本号：每次 refresh 自增。
   *
   * 给"页面自己按需查库"的场景当失效信号用（日历的按范围查询、回顾页的专注会话）：
   * 那些数据刻意不进 refresh 的并行拉取里，就不可能顺着 set 自动更新，
   * 所以需要一个"底层数据变了"的显式标记，让这些页面知道该重新查一次。
   */
  dataVersion: number;
  /** 全部未删除任务（含已完成）—— 容器进度与甘特图需要完整视图 */
  tasks: Task[];
  containers: Container[];
  marks: Mark[];
  ideas: Idea[];
  /** 全部打卡记录（习惯页与任务详情页共用；量级很小，一次读全） */
  checkins: Checkin[];
  /** 习惯型任务（kind = habit 的顶层任务） */
  habits: Task[];
  /** 小东西的累计生长秒数（只涨不落） */
  growthSeconds: number;
  /** 最近一次记录的分流结果，用于给用户一句反馈 */
  lastCapture: QuickCaptureResult | null;
  /** 最近一次专注结束的联动反馈 */
  lastFocus: FocusFeedback | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 详情页用：按 id 取单条任务。读操作也走 store，界面永远不直接碰仓储 */
  loadTask: (id: string) => Promise<Task | null>;
  /** 日历页用：按可见区间取"已落到日历"的任务，不再全量读 */
  loadScheduledBetween: (fromIso: string, toIso: string) => Promise<Task[]>;
  loadContainer: (id: string) => Promise<Container | null>;
  capture: (input: QuickCaptureInput) => Promise<QuickCaptureResult>;
  /** 给收集箱任务定时间：安排后自动落到日历，并（在支持的环境里）排提醒 */
  scheduleTask: (id: string, time: TaskTime) => Promise<void>;
  /** 局部修改任务字段（提前量、重复规则等），改完统一 refresh */
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  archiveIdea: (id: string) => Promise<void>;

  /** 子任务：读取 / 新增 / 勾选 / 删除。父任务完成态由子任务自动推导 */
  loadSubtasks: (parentId: string) => Promise<Task[]>;
  addSubtask: (parentId: string, title: string) => Promise<Task>;
  setSubtaskDone: (subtaskId: string, done: boolean) => Promise<void>;
  removeSubtask: (subtaskId: string) => Promise<void>;

  /** 手动排序：按新的 id 顺序写库 */
  reorderTasks: (ids: readonly string[]) => Promise<void>;

  /**
   * 甘特图拖拽改期：把一条任务的时间整体平移 N 天（保留原来的时分）。
   * 只有任务条会调它 —— 容器条是甘特图的框架，不给拖（见 domain/gantt.canReschedule）。
   */
  shiftTaskByDays: (taskId: string, days: number) => Promise<void>;

  /**
   * 内部动作：子任务变动后重算父任务完成态。
   * 规则见 domain/subtask-progress.ts —— 全完成则完成，被取消一个就打回待办。
   */
  syncParentStatus: (parentId: string) => Promise<void>;

  /**
   * 内部动作：频率型任务的完成态对账（每次 refresh 之前跑）。
   * 规则见 domain/habit-period.desiredFrequencyStatus —— 本期够数则完成，
   * 不够数却停在完成态则打回待办（这就是"新的一周它自己回来了"）。
   */
  reconcileFrequencyTasks: () => Promise<void>;

  /** 习惯打卡 / 撤销 */
  checkIn: (taskId: string) => Promise<void>;
  undoCheckIn: (taskId: string) => Promise<void>;

  /**
   * 回顾页用：按区间取专注会话。
   * 刻意不进 refresh —— 回顾是"偶尔看一眼"的页面，
   * 没必要让每次记录都陪它拉一遍全部专注历史。
   */
  loadFocusSessions: (fromIso: string, toIso: string) => Promise<FocusSession[]>;

  /** 新建容器（目标 / 项目 / 文件夹） */
  createContainer: (input: CreateContainerInput) => Promise<Container>;
  updateContainer: (id: string, patch: Partial<Container>) => Promise<void>;
  /** 删容器不删任务：任务退回"不属于任何容器"，避免误删一堆工作 */
  removeContainer: (id: string) => Promise<void>;

  createMark: (input: CreateMarkInput) => Promise<Mark>;
  updateMark: (id: string, patch: Partial<Mark>) => Promise<void>;
  removeMark: (id: string) => Promise<void>;

  /** 开一次专注（可绑定任务）。返回会话，供页面拿到 id */
  startFocus: (taskId: string | null, plannedMinutes?: number | null) => Promise<FocusSession>;
  /** 结束专注：落库 + 把时长记到任务上（够目标就自动完成） */
  finishFocus: (
    sessionId: string,
    payload: { actualSeconds: number; intent?: string | null; note?: string | null },
  ) => Promise<FocusFeedback | null>;
  clearFocusFeedback: () => void;

  /** 危险操作：清空本地数据，仅用于开发调试 */
  wipeLocalData: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  initializing: false,
  error: null,
  inbox: [],
  today: [],
  dataVersion: 0,
  tasks: [],
  containers: [],
  marks: [],
  ideas: [],
  checkins: [],
  habits: [],
  growthSeconds: 0,
  lastCapture: null,
  lastFocus: null,

  init: async () => {
    if (get().ready || get().initializing) return;
    set({ initializing: true, error: null });
    try {
      await getDatabase();
      await get().refresh();
      set({ ready: true, initializing: false });
    } catch (err) {
      set({
        initializing: false,
        error: err instanceof Error ? err.message : '本地数据库初始化失败',
      });
    }
  },

  refresh: async () => {
    // 频率型任务的完成态是**从打卡记录推导出来的**，所以每次读数据之前先对账一次。
    // 这里是唯一同时握着任务表和打卡表的地方 —— 放页面里做会漏，放仓储里做会
    // 让"读"变成有副作用的操作。
    await get().reconcileFrequencyTasks();

    const [
      inbox,
      today,
      tasks,
      containers,
      marks,
      ideas,
      checkins,
      habits,
      growthSeconds,
    ] = await Promise.all([
      taskRepository.listInbox(),
      taskRepository.listToday(),
      taskRepository.listAll(),
      containerRepository.listAll(),
      markRepository.listAll(),
      ideaRepository.listActive(),
      checkinRepository.listAll(),
      taskRepository.listHabits(),
      focusRepository.totalGrowthSeconds(),
    ]);
    set({
      inbox,
      today,
      tasks,
      containers,
      marks,
      ideas,
      checkins,
      habits,
      growthSeconds,
      dataVersion: get().dataVersion + 1,
    });
  },

  loadTask: async (id) => taskRepository.getById(id),
  loadScheduledBetween: async (fromIso, toIso) =>
    taskRepository.listScheduledBetween(fromIso, toIso),
  loadContainer: async (id) => containerRepository.getById(id),

  capture: async (input) => {
    const result = await quickCapture(input);
    set({ lastCapture: result });
    await get().refresh();
    return result;
  },

  scheduleTask: async (id, time) => {
    // 改期前先撤掉旧通知，否则旧时刻仍会弹出与现状不符的提醒
    await cancelTaskReminders(id);
    const updated = await taskRepository.update(id, { time });
    if (updated) {
      // 通知不可用的环境（Expo Go / web）里这是 no-op，返回 null，不影响安排
      await scheduleTaskReminder(updated);
    }
    await get().refresh();
  },

  updateTask: async (id, patch) => {
    const updated = await taskRepository.update(id, patch);
    if (updated) {
      // 提前量 / 重复规则变了，旧通知的触发时间可能不再正确
      await cancelTaskReminders(id);
      await scheduleTaskReminder(updated);
    }
    await get().refresh();
  },

  completeTask: async (id) => {
    const task = await taskRepository.getById(id);
    if (!task) return;

    // 频率型（"每周跑 3 次"）的"完成"不是一次性状态，而是"今天做了一次"——
    // 判定域在打卡表。勾这一下就该记到那里；否则它会被对账（reconcileFrequencyTasks）
    // 立刻打回待办，等于按钮按了没反应。列表行里的圆圈同样走这条路。
    if (task.completion === CompletionRule.Frequency) {
      await checkinRepository.checkIn(id);
      await get().refresh();
      return;
    }

    // 重复任务：完成一次 = 滚到下一期（时间前移、状态回待办），不标记完成
    const advance = advanceRepeatingTask(task);
    await cancelTaskReminders(id);
    if (advance) {
      const rolled = await taskRepository.update(id, advance);
      if (rolled) await scheduleTaskReminder(rolled);
    } else {
      await taskRepository.complete(id);
    }
    await get().refresh();
  },

  removeTask: async (id) => {
    // 先摘子任务与打卡记录，再删本体 —— 否则会留下指向空任务的行
    await taskRepository.detachSubtasks(id);
    await checkinRepository.softDeleteByTask(id);
    await cancelTaskReminders(id);
    await taskRepository.softDelete(id);
    await get().refresh();
  },

  archiveIdea: async (id) => {
    await ideaRepository.archive(id);
    await get().refresh();
  },

  loadSubtasks: async (parentId) => taskRepository.listSubtasks(parentId),

  addSubtask: async (parentId, title) => {
    const subtask = createSubtask(parentId, title);
    await taskRepository.create(subtask);
    await get().refresh();
    return subtask;
  },

  setSubtaskDone: async (subtaskId, done) => {
    const subtask = await taskRepository.getById(subtaskId);
    if (!subtask?.parentId) return;

    if (done) await taskRepository.complete(subtaskId);
    else await taskRepository.setStatus(subtaskId, TaskStatus.Todo);

    await get().syncParentStatus(subtask.parentId);
    await get().refresh();
  },

  removeSubtask: async (subtaskId) => {
    const subtask = await taskRepository.getById(subtaskId);
    await taskRepository.softDelete(subtaskId);
    if (subtask?.parentId) await get().syncParentStatus(subtask.parentId);
    await get().refresh();
  },

  reorderTasks: async (ids) => {
    await taskRepository.reorder(ids);
    await get().refresh();
  },

  shiftTaskByDays: async (taskId, days) => {
    if (!days || !Number.isFinite(days)) return;
    const task = await taskRepository.getById(taskId);
    if (!task) return;

    // 三个时间字段各自平移；本来是 null 的仍然是 null（不凭空长出 startAt）
    const next: TaskTime = {
      ...task.time,
      startAt: shiftIsoByDays(task.time.startAt, days),
      endAt: shiftIsoByDays(task.time.endAt, days),
      dueAt: shiftIsoByDays(task.time.dueAt, days),
    };

    // 时间变了，旧提醒的触发时刻就不对了，必须撤掉重排
    await cancelTaskReminders(taskId);
    const updated = await taskRepository.update(taskId, { time: next });
    if (updated) await scheduleTaskReminder(updated);
    await get().refresh();
  },

  syncParentStatus: async (parentId) => {
    const parent = await taskRepository.getById(parentId);
    if (!parent) return;
    const children = await taskRepository.listSubtasks(parentId);
    const desired = desiredParentStatus(parent, children);
    if (!desired) return;

    await cancelTaskReminders(parentId);
    const updated = await taskRepository.setStatus(parentId, desired);
    // 打回待办时要把提醒排回去；完成时提醒已被撤掉
    if (updated && desired !== TaskStatus.Done) await scheduleTaskReminder(updated);
  },

  /**
   * 频率型任务对账。
   *
   * "每周跑 3 次"这类任务的本期次数由打卡记录**现算**，够不够数也就能算出来，
   * 所以它的完成态不该由某个动作去"推送"，而应该每次读之前**收敛到正确值**。
   * 这一个动作同时解决两件事：新的一周它自己回到待办、撤销打卡后也回到待办。
   * 两件事用的是同一个纯函数，没有第二套规则。
   */
  reconcileFrequencyTasks: async () => {
    const [tasks, checkins] = await Promise.all([
      taskRepository.listAll(),
      checkinRepository.listAll(),
    ]);
    const frequency = tasks.filter((task) => task.completion === CompletionRule.Frequency);
    if (!frequency.length) return;

    const keysByTask = new Map<string, string[]>();
    for (const record of checkins) {
      const bucket = keysByTask.get(record.taskId);
      if (bucket) bucket.push(record.dayKey);
      else keysByTask.set(record.taskId, [record.dayKey]);
    }

    const now = new Date();
    for (const task of frequency) {
      const keys = keysByTask.get(task.id) ?? [];
      const desired = desiredFrequencyStatus(task, occurrencesInPeriod(keys, task.repeat, now));
      // null = 不干预（待办就是待办，"等待中"是用户手动设的，别踩掉）
      if (!desired || desired === task.status) continue;

      // 状态翻转时提醒要跟着走：完成 = 撤掉，打回待办 = 排回去
      await cancelTaskReminders(task.id);
      const updated = await taskRepository.setStatus(task.id, desired);
      if (updated && desired !== TaskStatus.Done) await scheduleTaskReminder(updated);
    }
  },

  checkIn: async (taskId) => {
    // 幂等：今天已经打过就直接返回，不会产生第二条
    await checkinRepository.checkIn(taskId);
    // 任务状态刻意不在这里改：频率型达标与否由 refresh 前的对账统一收敛
    await get().refresh();
  },

  undoCheckIn: async (taskId) => {
    await checkinRepository.undo(taskId);
    await get().refresh();
  },

  loadFocusSessions: async (fromIso, toIso) => focusRepository.listBetween(fromIso, toIso),

  createContainer: async (input) => {
    const container = createContainer(input);
    await containerRepository.create(container);
    await get().refresh();
    return container;
  },

  updateContainer: async (id, patch) => {
    await containerRepository.update(id, patch);
    await get().refresh();
  },

  removeContainer: async (id) => {
    // 先把成员任务摘出来，再删容器 —— 顺序反了会留下指向空容器的任务
    const members = get().tasks.filter((task) => task.containerId === id);
    await Promise.all(members.map((task) => taskRepository.update(task.id, { containerId: null })));
    await containerRepository.softDelete(id);
    await get().refresh();
  },

  createMark: async (input) => {
    const mark = createMark(input);
    await markRepository.create(mark);
    await get().refresh();
    return mark;
  },

  updateMark: async (id, patch) => {
    await markRepository.update(id, patch);
    await get().refresh();
  },

  removeMark: async (id) => {
    await markRepository.softDelete(id);
    await get().refresh();
  },

  startFocus: async (taskId, plannedMinutes) => {
    const session = createFocusSession(taskId, plannedMinutes ?? null);
    await focusRepository.create(session);
    return session;
  },

  finishFocus: async (sessionId, payload) => {
    const session = await focusRepository.finish(sessionId, payload);
    if (!session) return null;

    let feedback: FocusFeedback | null = null;

    if (session.taskId) {
      const task = await taskRepository.getById(session.taskId);
      if (task) {
        const outcome = applyFocusToTask(task, session.actualSeconds);
        if (outcome) {
          await taskRepository.update(task.id, outcome.patch);

          let message = outcome.message;

          // 频率型：这次专注算"今天做过一次"，落一条打卡记录。
          // 本期进度只认打卡表，所以这里写完再数一遍，反馈里说的是事实而不是推算。
          if (outcome.countsAsOccurrence) {
            await checkinRepository.checkIn(task.id);
            const keys = (await checkinRepository.listByTask(task.id)).map((row) => row.dayKey);
            const count = occurrencesInPeriod(keys, task.repeat, new Date());
            message = `${message} · ${describePeriodReached(
              task.repeat,
              task.targetOccurrences,
              count,
            )}`;
          }

          if (outcome.completed) {
            // 达标完成 = 这条任务不再需要提醒
            await cancelTaskReminders(task.id);
          } else {
            // 时间没变，但状态可能从别处改过，重排一次更稳妥
            const fresh = await taskRepository.getById(task.id);
            if (fresh) await scheduleTaskReminder(fresh);
          }
          feedback = { taskId: task.id, message };
        }
      }
    }

    set({ lastFocus: feedback });
    await get().refresh();
    return feedback;
  },

  clearFocusFeedback: () => set({ lastFocus: null }),

  wipeLocalData: async () => {
    await clearAllTables();
    await get().refresh();
  },
}));
