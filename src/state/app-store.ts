import { create } from 'zustand';

import { clearAllTables, getDatabase } from '@/data/db/client';
import { checkinRepository } from '@/data/repositories/checkin-repository';
import { containerRepository } from '@/data/repositories/container-repository';
import { courseRepository } from '@/data/repositories/course-repository';
import { eventRepository } from '@/data/repositories/event-repository';
import { focusRepository } from '@/data/repositories/focus-repository';
import { ideaRepository } from '@/data/repositories/idea-repository';
import { markRepository } from '@/data/repositories/mark-repository';
import { taskRepository } from '@/data/repositories/task-repository';
import { termRepository } from '@/data/repositories/term-repository';
import { quickCapture, type QuickCaptureInput, type QuickCaptureResult } from '@/entry/quick-capture';
import {
  cancelAllReminders,
  cancelTaskReminders,
  scheduleTaskReminder,
  syncCourseReminders,
  syncEventReminders,
  syncRepeatingTaskReminders,
} from '@/entry/notifications';
import type { Checkin } from '@/domain/checkins';
import type { Container, Mark } from '@/domain/container';
import { guessTermStart, mondayOfWeek, type Course, type Term } from '@/domain/course';
import type { CreateContainerInput, CreateMarkInput } from '@/domain/factory';
import {
  createContainer,
  createCourse,
  createFocusSession,
  createMark,
  createSubtask,
  createTask,
  createTerm,
} from '@/domain/factory';
import {
  applyFocusToTask,
  focusSpan,
  focusSpanTime,
  shouldStampFocusSpan,
} from '@/domain/focus-link';
import { describeFocusReceipt, type FocusMarkOutcome } from '@/domain/focus-receipt';
import type { FocusSession } from '@/domain/focus';
import { shiftIsoByDays } from '@/domain/gantt';
import type { CalEvent } from '@/domain/event';
import {
  describePeriodReached,
  desiredFrequencyStatus,
  occurrencesInPeriod,
} from '@/domain/habit-period';
import type { Idea } from '@/domain/idea';
import { planBreakdown } from '@/domain/idea-breakdown';
import { advanceRepeatingTask } from '@/domain/repeat-next';
import { desiredParentStatus } from '@/domain/subtask-progress';
import { CaptureSource, CompletionRule, TaskKind, TaskStatus } from '@/domain/enums';
import type { Task, TaskTime } from '@/domain/task';
import { toDayKey } from '@/utils/datetime';

/**
 * 全局数据状态。
 *
 * 界面不直接碰仓储，而是从这里读 —— 这样"记完一条，收集箱立刻多一条"
 * 这种联动只在一个地方发生（refresh），不需要页面之间互相通知。
 * 写入同理：容器、纪念日、专注联动也全部走这里的动作。
 */

/**
 * 一次专注结束后的**回执**：把"刚才那一下到底干了什么"说成一句话。
 *
 * 它不绑定在某一个页面上（以前只在任务详情页展示，而用户根本不经过那里），
 * 因为结束专注的副作用可能落在任务、日历、打卡表三处中的任意一处，
 * 用户需要一个"不管落在哪、回到首页就能看到"的地方。
 * 文案本身由 `domain/focus-receipt.ts` 产出（纯函数，有单测）。
 */
export interface FocusFeedback {
  /** 绑定的（或新建的）那条任务，有就能点进去看 */
  taskId: string | null;
  message: string;
  /** 这次专注的净秒数 */
  seconds: number;
}

interface AppState {
  /** 数据库初始化完成 */
  ready: boolean;
  initializing: boolean;
  error: string | null;

  inbox: Task[];
  today: Task[];
  /**
   * 已完成、但**从没安排过时间**的顶层任务（收集箱底部那个折叠区）。
   *
   * 为什么单拎这一份出来：一条任务完成之后会离开收集箱，如果它又是"没时间"的，
   * 那它同时也不在日历上、不在首页今天里、不在任何容器里 —— 四个列表全都不收它，
   * 用户勾完就再也找不到（只有知道 id 才打得开）。这里就是它的落脚点。
   */
  recentlyDone: Task[];
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
  /**
   * 勾选圈的语义是**开关**：没做的做完，点错了再点一下就回来。
   * 完成动作只由明确的勾选触发，但"撤销"也必须就地可得 ——
   * 否则误点一下完成，日历/项目列表里那个圈就再也点不动了
   * （completeTask 对已完成的任务是空操作，等于把人锁在门外）。
   */
  toggleTaskDone: (id: string) => Promise<void>;
  /** 把已完成的任务放回待办（收集箱底部的"已完成"区用它撤销） */
  reopenTask: (id: string) => Promise<void>;
  /** 备份覆盖导入后重排全部提醒（旧通知还挂着、新通知没排） */
  resyncReminders: () => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  archiveIdea: (id: string) => Promise<void>;
  /**
   * 归档箱。**不进 refresh()** —— 它是"偶尔翻一次"的地方，跟着每次勾任务
   * 重拉一遍纯属浪费。页面自己 load，用 `dataVersion` 当失效信号
   * （跟日历"按可见范围查"是同一个模式）。
   */
  loadArchivedIdeas: () => Promise<Idea[]>;
  /** 从归档箱放回主列表 —— 没有它，归档就是一道单向门 */
  unarchiveIdea: (id: string) => Promise<void>;
  /** 真删一条想法（软删除）。只在归档箱里露出来：主列表上给"删除"太容易手滑。 */
  removeIdea: (id: string) => Promise<void>;
  /**
   * 把一条想法拆成"一条父任务 + N 条子任务"，返回父任务 id。
   *
   * 产出挂在同一条父任务下，而不是 N 条并列的任务：步骤离开那件事就没有意义
   * （"查资料"是谁在查？），散进收集箱只会把箱子搅浑。挂在父任务下还白拿一条规则 ——
   * 子任务全部完成时父任务自动完成，这正是"这件事做完了"的定义。
   *
   * `planBreakdown` 判为"这次什么都不该做"（没写步骤 / 想法是空的）时返回 null。
   */
  breakdownIdea: (ideaId: string, steps: readonly string[]) => Promise<string | null>;

  /**
   * 在某个容器下**直接新建**一条任务（容器页的「新建」）。
   * 刻意不给时间：没时间就是"待规划"（收集箱的定义），想排期再去任务详情页或日历拖。
   */
  addTaskToContainer: (containerId: string, title: string) => Promise<Task>;
  /** 一口气加好几条：一行一条写好，一次全建（只刷新一次） */
  addTasksToContainer: (containerId: string, titles: readonly string[]) => Promise<Task[]>;

  /** 子任务：读取 / 新增 / 勾选 / 删除。父任务完成态由子任务自动推导 */
  loadSubtasks: (parentId: string) => Promise<Task[]>;
  addSubtask: (parentId: string, title: string) => Promise<Task>;
  /**
   * 一口气加好几条（一行一步地写完之后一次提交）。
   * 与 addSubtask 的区别不只是"循环调几次"：它**只 refresh 一次** ——
   * 十条子项刷十次页面，会看到列表一条条蹦出来，像是卡了。
   */
  addSubtasks: (parentId: string, titles: readonly string[]) => Promise<Task[]>;
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
  /** 中途改计划时长等轻量更新（页面持着 startFocus 返回的会话对象改完存回） */
  saveFocusSession: (session: FocusSession) => Promise<void>;
  /**
   * 结束专注：落库 + 把时长记到任务上（够目标就自动完成）+ 给一句回执。
   *
   * `markDone` 是用户当场按下的"这段就算把它做完"。刻意做成参数而不是让页面
   * 结束后自己再调一次 completeTask —— 那样"完成了"这件事就发生在回执已经写好之后，
   * 回执说不出来（页面又立刻退场了），用户永远看不到它。
   */
  finishFocus: (
    sessionId: string,
    payload: {
      actualSeconds: number;
      intent?: string | null;
      note?: string | null;
      markDone?: boolean;
    },
  ) => Promise<FocusFeedback | null>;
  clearFocusFeedback: () => void;

  /** 危险操作：清空本地数据，仅用于开发调试 */
  wipeLocalData: () => Promise<void>;

  /* ---------------- 课程表（课表与任务并列，不改任务口径） ---------------- */

  /** 当前学期的课（已按 created_at DESC）；课表视图直接消费 */
  courses: Course[];
  /** 当前学期：开学日、总周数、作息表。null = 还没设置过 */
  term: Term | null;

  loadCourses: () => Promise<Course[]>;
  loadTerm: () => Promise<Term | null>;
  /** 改一门课（改名/改时段/换教室/设提醒都走它） */
  saveCourse: (course: Course) => Promise<void>;
  /** 删一门课（软删除） */
  removeCourse: (id: string) => Promise<void>;
  /**
   * 导入一批课（导入页确认草稿之后调它）。
   * `replace` = 先清空现有课表 —— 重新导入整学期的默认动作，
   * 但要由用户明确选，不替用户决定（老课表可能已经手动调过）。
   */
  importCourses: (courses: readonly Course[], options?: { replace?: boolean }) => Promise<void>;
  /** 学期设置：不传就沿用当前值（首次会自动建一条，开学日默认本周一） */
  saveTerm: (patch: Partial<Term>) => Promise<Term>;

  /* ---------------- 固定日程（考试等，与任务并列） ---------------- */

  /** 全部固定日程（量小，一学期十来条，refresh 里顺带全量读） */
  events: CalEvent[];
  /** 导入一批（导入页确认草稿之后调它）。replace = 先清掉现有考试再写 */
  importEvents: (events: readonly CalEvent[], options?: { replace?: boolean }) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  initializing: false,
  error: null,
  inbox: [],
  today: [],
  recentlyDone: [],
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
  courses: [],
  term: null,
  events: [],

  init: async () => {
    if (get().ready || get().initializing) return;
    set({ initializing: true, error: null });
    try {
      await getDatabase();
      await get().refresh();
      set({ ready: true, initializing: false });
      // 启动时补排考试提醒：系统重启后可能丢掉已排的一次性通知，而考试远在几周后、
      // 不像课表那样每次改动都会重排。**不请求权限**（启动就弹权限框太唐突），
      // 已授权就排上，没授权等用户下次主动导入/记录时自然会问。
      // 也**不 await**：它跟"App 能打开"没关系 —— 这正是把提醒从主流程里摘出去的意义。
      void syncEventReminders(get().events, { requestPermission: false });
      // 重复任务（"每天 8 点吃药"）一次只排 7 天，隔了 8 天再打开 App，
      // 后面那几天的通知压根没排过 —— 那条提醒会**凭空消失**且无从察觉。
      // 冷启动补满窗口，把"我不打开它也得响"这件事兜住。同样不请求权限、不 await。
      void syncRepeatingTaskReminders(get().tasks);
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
      recentlyDone,
      tasks,
      containers,
      marks,
      ideas,
      checkins,
      habits,
      growthSeconds,
      courses,
      term,
      events,
    ] = await Promise.all([
      taskRepository.listInbox(),
      taskRepository.listToday(),
      taskRepository.listRecentlyDone(),
      taskRepository.listAll(),
      containerRepository.listAll(),
      markRepository.listAll(),
      ideaRepository.listActive(),
      checkinRepository.listAll(),
      taskRepository.listHabits(),
      focusRepository.totalGrowthSeconds(),
      courseRepository.listAll(),
      termRepository.getCurrent(),
      eventRepository.listAll(),
    ]);
    set({
      inbox,
      today,
      recentlyDone,
      tasks,
      containers,
      marks,
      ideas,
      checkins,
      habits,
      growthSeconds,
      courses,
      term,
      events,
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

  /** 勾选圈 = 开关：已完成就放回待办，否则按各类型的规则完成 */
  toggleTaskDone: async (id) => {
    const task = await taskRepository.getById(id);
    if (!task) return;
    if (task.status === TaskStatus.Done) await get().reopenTask(id);
    else await get().completeTask(id);
  },

  /** 撤销完成：把任务放回待办。收集箱底部的"已完成"区和任务详情页都用它 */
  reopenTask: async (id) => {
    const updated = await taskRepository.setStatus(id, TaskStatus.Todo);
    if (updated) {
      // completeTask 已经把通知撤了，撤销完成 = 这件事回到"到点该提醒"的行列，
      // 必须把提醒排回去 —— 否则"取消勾选之后它就再也不提醒了"。
      await cancelTaskReminders(id);
      await scheduleTaskReminder(updated);
    }
    await get().refresh();
  },

  /**
   * 重排全部提醒。备份"覆盖导入"后调用：库整体换血了，
   * 旧任务的已排通知还挂着（会照弹）、新任务的通知一条没排。
   * 全撤重来，按现库逐条排 —— 提醒不可用的环境里 scheduleTaskReminder
   * 是 no-op，这条动作照常安全。
   */
  resyncReminders: async () => {
    await cancelAllReminders();
    const tasks = await taskRepository.listAll();
    for (const task of tasks) {
      if (task.status !== TaskStatus.Done) await scheduleTaskReminder(task);
    }
    // 备份里的考试也要重新排上（cancelAllReminders 把它们的通知也撤了）
    await syncEventReminders(get().events);
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

  loadArchivedIdeas: async () => ideaRepository.listArchived(),

  unarchiveIdea: async (id) => {
    await ideaRepository.unarchive(id);
    await get().refresh();
  },

  removeIdea: async (id) => {
    await ideaRepository.softDelete(id);
    await get().refresh();
  },

  breakdownIdea: async (ideaId, steps) => {
    // 想法从库里现读一份：界面手上的那份可能是翻页前拿到的旧对象
    const idea = await ideaRepository.getById(ideaId);
    if (!idea) return null;

    const plan = planBreakdown(idea.content, steps);
    if (!plan) return null;

    // 父任务**刻意不给时间**。拆出来的是一份"要做哪些事"的清单，不是排期；
    // 没时间 = 待规划，它会自动落到收集箱 —— 那正是拆解产物该去的地方。
    // 给每一步自动派一份时间是排程算法该做的事，这里做等于替用户排了一遍程。
    const parent = createTask({
      title: plan.title,
      note: plan.note,
      kind: TaskKind.Execution,
      source: CaptureSource.Manual,
    });
    await taskRepository.create(parent);

    for (const title of plan.steps) {
      await taskRepository.create(createSubtask(parent.id, title));
    }

    // 指针回写到想法上：这是"拆过"的唯一凭据（步数不存，问子任务表要）
    await ideaRepository.setBreakdownTaskId(ideaId, parent.id);

    await get().refresh();
    return parent.id;
  },

  addTaskToContainer: async (containerId, title) => {
    const task = createTask({
      title,
      kind: TaskKind.Execution,
      containerId,
      source: CaptureSource.Manual,
    });
    await taskRepository.create(task);
    await get().refresh();

    return task;
  },

  /**
   * 一口气加好几条（项目页里一行一条写好，一次全建）。
   * 与子项批量同理：只 refresh 一次，条子才不会一条条往外蹦。
   */
  addTasksToContainer: async (containerId, titles) => {
    if (!titles.length) return [];
    const created = titles.map((title) =>
      createTask({
        title,
        kind: TaskKind.Execution,
        containerId,
        source: CaptureSource.Manual,
      }),
    );
    for (const task of created) {
      await taskRepository.create(task);
    }
    await get().refresh();
    return created;
  },

  loadSubtasks: async (parentId) => taskRepository.listSubtasks(parentId),

  addSubtask: async (parentId, title) => {
    const subtask = createSubtask(parentId, title);
    await taskRepository.create(subtask);
    await get().refresh();
    return subtask;
  },

  addSubtasks: async (parentId, titles) => {
    if (!titles.length) return [];
    const created = titles.map((title) => createSubtask(parentId, title));
    for (const subtask of created) {
      await taskRepository.create(subtask);
    }
    await get().refresh();
    return created;
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

  saveFocusSession: async (session) => {
    await focusRepository.save(session);
  },

  finishFocus: async (sessionId, payload) => {
    const session = await focusRepository.finish(sessionId, payload);
    if (!session) return null;

    // 这次专注占用的那段时间：让"我花了多久"变成日历上看得见的"几点到几点"
    const span = focusSpan(session.startedAt, session.actualSeconds);
    const seconds = session.actualSeconds;
    /**
     * 所有分支最后都汇到这一处：**先记账，再按事实写回执**。
     *
     * 分成"记账"和"说话"两段是有意的 —— 以前每加一条分支就顺手 return 一下，
     * 于是"没绑定任务"和"太短"这两条路都不留话，用户按完结束什么都看不到。
     */
    let feedback: FocusFeedback;

    /**
     * ① 没绑定任务 —— 这段专注本身就是一条记录。
     *
     * 起了名字用名字，没起名就叫「专注」（2026-10-08 用户拍板：未命名的也进日历，
     * 统计和日历不该是两个口径）。这段时间**已经发生过**，它是一条"做过什么"的日志，
     * 记成"已完成" —— 这与"不许替用户把已有的待办标完成"是两件事：
     * 我们**新建**了一条记录，而没有改动用户已有的任何决定。
     */
    if (!session.taskId && span) {
      const title = session.intent?.trim() || '专注';
      const logged = createTask({
        title,
        kind: TaskKind.Execution,
        time: focusSpanTime(span),
        source: CaptureSource.Focus,
        note: session.note ?? null,
      });
      await taskRepository.create(logged);
      await taskRepository.complete(logged.id);
      feedback = {
        taskId: logged.id,
        seconds,
        message: describeFocusReceipt({
          seconds,
          boundTitle: null,
          intent: session.intent ?? null,
          span,
        }),
      };
    } else if (session.taskId) {
      const task = await taskRepository.getById(session.taskId);

      if (!task) {
        // 专注途中用户把这条任务删了。时长仍然进统计，但不能假装它还挂着
        feedback = {
          taskId: null,
          seconds,
          message: describeFocusReceipt({
            seconds,
            boundTitle: payload.intent ?? '这件事',
            intent: null,
            span: null,
            taskMissing: true,
          }),
        };
      } else {
        const outcome = applyFocusToTask(task, seconds);

        if (!outcome) {
          // 不到一分钟：不记账（防误触刷数据）。什么都不能写，但这句话必须说
          feedback = {
            taskId: task.id,
            seconds,
            message: describeFocusReceipt({
              seconds,
              boundTitle: task.title,
              intent: null,
              span: null,
            }),
          };
        } else {
          /**
           * 还没安排过时间的任务，用这次专注的时段把它落到日历上 ——
           * 但**只在这件事确实算做完了的时候**（够目标了，或用户勾了"这段就算把它做完"）。
           *
           * 为什么加这个前提：日历上的时段读出来只有两种意思 —— 「安排」或
           * 「已经发生并确认的事」。一条**还没做完**的待办被塞进一个刚刚过去的时段，
           * 会被 `task-state` 判成 `missed`（已过去、没打勾），于是它出现在首页"今天"里、
           * 在日期上淡出、详情页还弹一张"这段时间已经过去了，怎么处理你说了算"——
           * 而用户十分钟前刚在这件事上花了 25 分钟。那是自相矛盾。
           *
           * 时长照记不误（累计分钟数在详情页/回顾页都看得到），只是不占日历上的一个位置。
           * 已经排好时间的任务一如既往不动它的时间：专注只提供"投入了多少"。
           */
          const willBeDone = outcome.completed || Boolean(payload.markDone);
          const stamp =
            span && shouldStampFocusSpan(task) && willBeDone ? { time: focusSpanTime(span) } : {};
          await taskRepository.update(task.id, { ...outcome.patch, ...stamp });

          // 频率型：这次专注算"今天做过一次"，落一条打卡记录。
          // 本期进度只认打卡表，所以这里写完再数一遍，反馈里说的是事实而不是推算。
          let periodNote: string | null = null;
          if (outcome.countsAsOccurrence) {
            await checkinRepository.checkIn(task.id);
            const keys = (await checkinRepository.listByTask(task.id)).map((row) => row.dayKey);
            const count = occurrencesInPeriod(keys, task.repeat, new Date());
            periodNote = describePeriodReached(task.repeat, task.targetOccurrences, count);
          }

          if (outcome.completed) {
            // 达标完成 = 这条任务不再需要提醒
            await cancelTaskReminders(task.id);
          } else {
            // 时间没变，但状态可能从别处改过，撤旧排新才不会出现双提醒
            await cancelTaskReminders(task.id);
            const fresh = await taskRepository.getById(task.id);
            if (fresh) await scheduleTaskReminder(fresh);
          }

          /**
           * 用户当场按下的"这段就算把它做完"。
           *
           * 走的是和列表里那个勾一样的 completeTask（重复任务要滚期、频率型要打卡），
           * 所以这里不能自己写 status —— 写完再读一次，按**实际结果**说话：
           * 否则重复任务会被回执说成"完成了"，而它其实只是滚到了下一次。
           */
          let markOutcome: FocusMarkOutcome | null = null;
          if (payload.markDone) {
            await get().completeTask(task.id);
            const after = await taskRepository.getById(task.id);
            if (after) {
              if (after.status === TaskStatus.Done) markOutcome = 'done';
              else if (after.time.startAt !== task.time.startAt) markOutcome = 'rolled';
              else markOutcome = 'checked-in';
            }
          }

          feedback = {
            taskId: task.id,
            seconds,
            message: describeFocusReceipt({
              seconds,
              boundTitle: task.title,
              intent: null,
              span: stamp.time ? span : null,
              completed: outcome.completed,
              keptOffCalendar: Boolean(span && shouldStampFocusSpan(task) && !willBeDone),
              markOutcome,
              periodNote,
            }),
          };
        }
      }
    } else {
      // ② 没绑定任务、时段也没落成（不到一分钟）—— 日历上没有它，回执里要明说
      feedback = {
        taskId: null,
        seconds,
        message: describeFocusReceipt({
          seconds,
          boundTitle: null,
          intent: session.intent ?? null,
          span,
        }),
      };
    }

    set({ lastFocus: feedback });
    await get().refresh();
    return feedback;
  },

  clearFocusFeedback: () => set({ lastFocus: null }),

  /* ---------------- 课程表 ---------------- */

  loadCourses: async () => courseRepository.listAll(),

  loadTerm: async () => termRepository.getCurrent(),

  /**
   * 课表这边一律在 `refresh()` 之后再调一次 `syncCourseReminders` ——
   * **为什么不放进 refresh() 里**：refresh 每次勾选任务都会跑，跟着它重排
   * 等于"点一下就撤销重排几十条通知"，白耗电还容易被系统限流。
   * 也**不 await**：提醒排不上不该拖慢"导入课表"这个主流程。
   */
  saveCourse: async (course) => {
    await courseRepository.save(course);
    await get().refresh();
    void syncCourseReminders(get().courses, get().term);
  },

  removeCourse: async (id) => {
    await courseRepository.softDelete(id);
    await get().refresh();
    // 删课要顺手把它的通知撤掉，否则那门课还会继续弹
    void syncCourseReminders(get().courses, get().term);
  },

  importCourses: async (courses, options) => {
    if (options?.replace) await courseRepository.softDeleteAll();
    await courseRepository.createMany(courses);
    await get().refresh();
    void syncCourseReminders(get().courses, get().term);
  },

  saveTerm: async (patch) => {
    const current = await termRepository.getCurrent();
    // 没有学期就先建一条。开学日的兜底改成"按学期名推出来的第一周周一" ——
    // "本周一"在学期中途是错的（10 月打开就变成 10 月的周一，整张课表的
    // 周次全偏），只当推不出来时的最后兜底。
    const base =
      current ??
      createTerm({
        label: patch.label ?? '当前学期',
        startDayKey:
          patch.startDayKey ??
          guessTermStart(patch.label ?? '') ??
          toDayKey(mondayOfWeek(new Date())),
        totalWeeks: patch.totalWeeks,
        periods: patch.periods,
      });
    const next = await termRepository.save({ ...base, ...patch, id: base.id });
    set({ term: next, dataVersion: get().dataVersion + 1 });
    // 开学日或作息表一动，每节课的**时刻**就全变了 —— 必须重排
    void syncCourseReminders(get().courses, next);
    return next;
  },

  /* ---------------- 固定日程（考试等） ---------------- */

  importEvents: async (events, options) => {
    if (options?.replace) await eventRepository.softDeleteAll();
    await eventRepository.createMany(events);
    await get().refresh();
    // 考试提醒一贯"全撤重排"（理由见 syncEventReminders）。**不 await**：
    // 排提醒不该拖慢"导入考试"这个主流程，失败也只是这次没排上。
    void syncEventReminders(get().events);
  },

  wipeLocalData: async () => {
    // 清库之前先把通知全撤了：旧任务的提醒还挂在系统里，清完数据它照样会响
    await cancelAllReminders();
    await clearAllTables();
    await get().refresh();
  },
}));
