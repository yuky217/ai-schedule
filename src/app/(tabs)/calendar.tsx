import { Ionicons } from '@expo/vector-icons';
import { addDays, addMonths, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CalendarDay, type EventSlot } from '@/components/calendar-day';
import { CalendarMonth } from '@/components/calendar-month';
import { CalendarWeek } from '@/components/calendar-week';
import { Card } from '@/components/card';
import { CourseSessionSheet } from '@/components/course-session-sheet';
import { CourseSlotSheet } from '@/components/course-slot-sheet';
import { DragGrip } from '@/components/drag-grip';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { TimetableView } from '@/components/timetable-view';
import { TodoView } from '@/components/todo-view';
import { Spacing } from '@/constants/theme';
import type { DayMarks } from '@/domain/calendar-shape';
import { calendarWindow, monthGridDays, windowKey } from '@/domain/calendar-window';
import {
  applyCourseChange,
  changeAnchor,
  coursesOnDate,
  dropCourseChange,
  makeCourseChange,
  mondayOfWeek,
  moveSession,
  sessionKey,
  weekIndexOf,
  type Course,
  type CourseSession,
  type CourseSlot,
} from '@/domain/course';
import { describeEvent, type CalEvent } from '@/domain/event';
import { TaskStatus } from '@/domain/enums';
import { describeMark, nextMarkDate, pickUpcoming, sortMarkViews, type MarkView } from '@/domain/marks';
import { buildPlacedTime, buildRetimedSpanTime, buildRetimedTime, buildTimeOnDay } from '@/domain/schedule-presets';
import { taskAnchor, type Task } from '@/domain/task';
import { isMuted, taskDisplayState } from '@/domain/task-state';
import { groupTodos } from '@/domain/todo';
import { useCrossDayDrag } from '@/hooks/use-cross-day-drag';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { toDate } from '@/utils/datetime';

/**
 * 日历：只呈现"有明确时间"的事。
 *
 * 四个视图共用一套导航（切视图不重新查库、不重挂列表）：
 * - 月：看全局节奏（哪天忙），**长按任意一行**拖到日期格即改期；
 *   纪念日也落在这里 —— 格子点出它落在哪天，点中那天的卡片说清是什么日子
 * - 周：7 天列 × 小时轴的时间网格，**长按任务块横拖换天、纵拖换时刻**；
 *   跨天落下后自动切到那天的日视图，接着微调；点表头也能直接进某天
 * - 日：看当天时间轴，**长按任务块上下拖**即改时刻（吸 15 分钟刻度）
 * - 课：一周的课表（周几 × 第几节），**点课块**开这一块的面板（改这一次 / 不上这一次 /
 *   去改整学期），**长按拖动课块**换星期/节次（那是改整学期）
 *
 * **课是背景，不是日程**：日/周视图里会把当天的课画成虚线带子（点不动、
 * 不参与分道），只回答"这段时间有课"；它是用户可以在设置里整个关掉的一层
 * （`settings.timetableEnabled`）。任务排在课上也丝毫不冲突 —— 同刻多件事
 * 本来就允许，分道算法在 `domain/lane-layout`。
 *
 * 前三视图手势全部交给 react-native-gesture-handler，动画全部交给 react-native-reanimated：
 * - 手势在原生层识别（长按拾起 / 拖拽 / 翻页互不抢），单击仍然照常触发按钮；
 * - 跟手的浮块与页面位移由 shared value 驱动，跑在 UI 线程，JS 忙也不会掉帧。
 *
 * **课表视图例外：它关掉翻页手势。** 课表在窄屏上要横向滚动（7 列放不下），
 * 而横滑翻页和横滑滚动是同一个方向 —— 两个手势都想要，结果一定是"想滚却翻页了"。
 * 所以课表里换周只走 ‹ › 两个按钮，横向手势全留给表格。
 */

type CalendarMode = 'month' | 'week' | 'day' | 'timetable' | 'todo';

/** 跟手位移上限（超过就不动，给用户"到头了"的手感） */
const PAN_LIMIT = 56;
/** 松手判定翻页的位移（px）/ 速度（px/s）阈值 */
const PAN_THRESHOLD = 56;
const VELOCITY_THRESHOLD = 350;
/** 翻页时新旧内容错位的距离 */
const PAGE_OFFSET = 44;
/**
 * 月视图里"收集箱抽屉"最多列出几行。
 *
 * 抽屉贴在屏幕底部（Screen 的 bottomBar 槽位，不随页面滚动），
 * 拖动期间页面滚动被锁，所以能拖到的只有屏幕上看得见的日期格 ——
 * 限行是为了让抽屉自己别长高到把月历顶出屏幕：抽屉每多一行，
 * 上方的月历就少一行可见空间。
 */
const INBOX_DRAG_LIMIT = 4;

const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');
const keyToDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** 日卡里的纪念日行：把 describeMark 的大字小字拼成一句话（"3 天后 · 第 2 周年"） */
const markLine = (view: MarkView): string =>
  view.headline === '今天'
    ? view.caption === '就是这天'
      ? '就是今天'
      : `今天 · ${view.caption}`
    : `${view.headline} ${view.caption}`;

export default function CalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const loadScheduledBetween = useAppStore((state) => state.loadScheduledBetween);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const scheduleTask = useAppStore((state) => state.scheduleTask);
  // 课表的数据不走"按可见范围查"，它整学期就那十几门课，直接拿 store 里的
  const courses = useAppStore((state) => state.courses);
  const term = useAppStore((state) => state.term);
  /**
   * 收集箱（顶层、未完成、完全没时间的那些）也放这一页当一个**拖拽源头**。
   *
   * 为什么要放在日历里：想"排到具体哪天"时，用户脑子里对照的是**日历本身**
   * ——这天有没有课、那天是不是周末。在收集箱里拖只能看到一条两周的日期带，
   * 看不到这张月历。而跨 Tab 拖拽在手机上不成立（切页那一下手势就被系统掐断了），
   * 所以只能把源头搬进日历，不能让手指把条目拖过去。
   */
  const inbox = useAppStore((state) => state.inbox);
  // 考试同理：一学期十来场，全量放 store，页面按日期分桶
  const events = useAppStore((state) => state.events);
  // 纪念日也全量在 store：它就那么几个日子，月历的圆点和日卡里的行都从这儿出
  const marks = useAppStore((state) => state.marks);
  /**
   * 待办视图要的是**全部任务**（含已完成）—— 分档、排序都在 `domain/todo.ts`。
   *
   * 这里刻意不自己查库：`tasks` 本来就被 `app-store.refresh` 拉全量存着
   * （容器进度与甘特图一直用它），数据早就在内存里，页面直接取。
   */
  const allTasks = useAppStore((state) => state.tasks);
  const saveCourse = useAppStore((state) => state.saveCourse);
  /** 课表总开关：关掉后「课」这一栏和日/周里的上课时段一起消失 */
  const timetableOn = useSettings((state) => state.timetableEnabled);

  const segments = useMemo(
    () => SEGMENTS.filter((segment) => segment.key !== 'timetable' || timetableOn),
    [timetableOn],
  );

  const [mode, setMode] = useState<CalendarMode>('month');
  /** 月视图 = 正在看的月份；周视图 = 正在看的周（任取周内一天） */
  const [cursor, setCursor] = useState<Date>(new Date());
  /** 月视图选中的那天 / 日视图正在看的那天 */
  const [selected, setSelected] = useState<Date>(new Date());
  /** 日视图拖块改时刻期间，也要锁住页面滚动 */
  const [timelineDragging, setTimelineDragging] = useState(false);

  const containerRef = useRef<View>(null);

  /*
    课表被关掉时，用户如果正站在「课」那一栏上，得把他接住 ——
    否则分段控件里没有「课」，页面却还停在课表上，看着像卡死了。
    退回周视图（离课表最近的"看时间"的视图），而不是月视图。
  */
  useEffect(() => {
    if (!timetableOn && mode === 'timetable') setMode('week');
  }, [mode, timetableOn]);

  /* ---------------- 数据：只读"当前看得见的那一段" ---------------- */

  /**
   * 日历刻意**不**从全局 store 拿任务列表。
   *
   * 放进 store 就意味着每次记录、每次改期都全量读一遍所有带时间的任务 ——
   * 个人日程攒几年就是几千条，而屏幕上永远只有一个月。
   *
   * 代价是页面要自己负责"底层数据变了我该重查"，
   * 所以依赖里带上了 store 的 dataVersion（每次 refresh 自增）。
   */
  const range = useMemo(() => calendarWindow(mode, cursor, selected), [mode, cursor, selected]);
  const rangeKey = useMemo(() => windowKey(range), [range]);

  const [scheduled, setScheduled] = useState<Task[]>([]);

  useEffect(() => {
    /**
     * 待办视图用的是 store 里的全量任务（`allTasks`），根本不看这个时间窗 ——
     * 没必要为了一个用不上的窗口去查库。这也是它唯一和别处不同的地方。
     */
    if (mode === 'todo') return;
    let alive = true;
    void loadScheduledBetween(range.from.toISOString(), range.to.toISOString()).then((rows) => {
      if (alive) setScheduled(rows);
    });
    return () => {
      alive = false;
    };
    // 依赖刻意用 rangeKey（字符串）而不是 range：Date 每次渲染都是新引用，
    // 直接依赖 range 会让这个 effect 每渲染一次就重查一次库。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadScheduledBetween, rangeKey, dataVersion]);

  const openTask = useCallback((task: Task) => router.push(`/task/${task.id}`), [router]);
  const toggleTaskDone = useAppStore((state) => state.toggleTaskDone);
  const toggleById = useCallback(
    (task: Task) => {
      void toggleTaskDone(task.id);
    },
    [toggleTaskDone],
  );

  /**
   * 长按拖拽结束后紧跟着的那次 click 必须吞掉（和收集箱同一个坑）：
   * web 上 RNGH 的 Pan 拖完松手，浏览器会在原坐标补发一次 click ——
   * 实测"长按一行拖去别的日期"会顺手跳进详情页、拖完落在勾选圈上还会误勾。
   * 用时间戳：拖拽一结束就记时刻，500ms 内的点击一律忽略。
   */
  const longPressAt = useRef(0);
  const guarded = useCallback(
    (action: (task: Task) => void) =>
      (task: Task) => {
        if (Date.now() - longPressAt.current < 500) return;
        action(task);
      },
    [],
  );

  const guardedOpen = useCallback((task: Task) => guarded(openTask)(task), [guarded, openTask]);
  const guardedToggle = useCallback(
    (task: Task) => guarded(toggleById)(task),
    [guarded, toggleById],
  );

  /* ---------------- 视图切换动画 ---------------- */

  const contentOpacity = useSharedValue(1);
  const contentShift = useSharedValue(0);
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentShift.value }],
  }));

  const applyMode = useCallback((next: CalendarMode, nextKey: string | null) => {
    setMode(next);
    if (nextKey) {
      const date = keyToDate(nextKey);
      setCursor(date);
      setSelected(date);
    } else {
      setCursor(new Date());
      setSelected(new Date());
    }
  }, []);

  /**
   * 切视图 / 跳到某一天，共用同一条"淡出 → 换内容 → 淡入上移归位"的动画。
   * 跨天拖拽落库后就是走这里跳到目标日 —— 视觉上是一次连续过渡，不是硬切。
   *
   * ⚠️ 目标日期必须传 **'yyyy-MM-dd' 字符串**而不是 Date：
   * withTiming 的完成回调是 worklet，闭包会被整个序列化并送到 UI 线程，
   * 而 Worklets 不支持 Date（"Cannot copy value of type Date"）。
   * 之前的闪退就是这里传了 Date —— 任何要进 worklet 闭包的值都必须是可 JSON 化的。
   */
  const transition = useCallback(
    (next: CalendarMode, nextKey: string | null) => {
      if (next === mode && (!nextKey || nextKey === dayKey(selected))) return;
      contentOpacity.value = withTiming(0, { duration: 90 }, (finished) => {
        if (!finished) return;
        contentShift.value = 10;
        runOnJS(applyMode)(next, nextKey);
        contentOpacity.value = withTiming(1, { duration: 170 });
        contentShift.value = withSpring(0, { damping: 18, stiffness: 220 });
      });
    },
    [applyMode, contentOpacity, contentShift, mode, selected],
  );

  const changeMode = useCallback((next: CalendarMode) => transition(next, null), [transition]);
  const focusDay = useCallback((date: Date) => transition('day', dayKey(date)), [transition]);

  /**
   * 点课程块 → 打开**这一块自己的面板**（改这一次 / 这一次不上 / 去改整学期）。
   *
   * 为什么不直接进课程详情：单次调课必须知道"是哪一次"，也就是哪一天的那一块。
   * 课程详情是"整门课"的视角、没有日期，在那儿做不了这件事 —— 所以课块先给自己
   * 开一层，面板里再给一个通向整门课的出口。
   */
  const openCourseSlot = useCallback((slot: CourseSlot) => {
    // 拖完课块松手时 web 会补发一次 click —— 跟任务共用同一个 500ms 窗口
    if (Date.now() - longPressAt.current < 500) return;
    setCourseSlot(slot);
  }, []);

  /* ---------------- 单次调课（只改这一次） ---------------- */

  /** 被点开的那一块。时间面板打开时它**不清空** —— 确认键要用它算落到哪一天 */
  const [courseSlot, setCourseSlot] = useState<CourseSlot | null>(null);
  const [slotTimeOpen, setSlotTimeOpen] = useState(false);

  /** 这一次不上 */
  const cancelCourseSlot = useCallback(async () => {
    if (!courseSlot) return;
    const target = courseSlot;
    setCourseSlot(null);
    await saveCourse(
      applyCourseChange(target.course, makeCourseChange(target, { canceled: true })),
    );
  }, [courseSlot, saveCourse]);

  /** 撤销这次调整（停课时的"恢复上课"走的是同一个动作 —— 停课的唯一出路就是撤销） */
  const restoreCourseSlot = useCallback(async () => {
    if (!courseSlot) return;
    const target = courseSlot;
    setCourseSlot(null);
    await saveCourse(dropCourseChange(target.course, changeAnchor(target)));
  }, [courseSlot, saveCourse]);

  /**
   * 选好新时间 → 落到**被点那一块所在那一周**里的那一天。
   *
   * 用户看着第 7 周的课表点开面板、说"改到周五"，指的就是第 7 周的周五；
   * 拿"今天所在那周"去换算会把它甩到别的周去。
   */
  const applySlotTime = useCallback(
    async (picked: CourseSession) => {
      const target = courseSlot;
      setSlotTimeOpen(false);
      if (!target) return;
      setCourseSlot(null);
      const weekStart = mondayOfWeek(target.date);
      const toDate = new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + ((picked.weekday + 6) % 7),
      );
      await saveCourse(
        applyCourseChange(
          target.course,
          makeCourseChange(target, {
            toDate,
            startPeriod: picked.startPeriod,
            endPeriod: picked.endPeriod,
          }),
        ),
      );
    },
    [courseSlot, saveCourse],
  );

  /** 点"没有上课时间"清单里的一门 → 进课程详情（在那儿补时间） */
  const openCourse = useCallback(
    (course: Course) => router.push(`/course/${course.id}`),
    [router],
  );
  const openImport = useCallback(() => router.push('/import-courses'), [router]);
  const openImportExams = useCallback(() => router.push('/import-exams'), [router]);
  const openAddCourse = useCallback(() => router.push('/add-course'), [router]);
  /** 课表的"底座"：开学日与作息表。放在课表页脚，不藏进设置页（见 timetable-view 注释） */
  const openTermSettings = useCallback(() => router.push('/term-settings'), [router]);

  /* ---------------- 跨天拖拽改期（月视图） ---------------- */

  const { countsByDay, tasksByDay } = useMemo(() => {
    const counts = new Map<string, number>();
    const tasks = new Map<string, Task[]>();
    for (const task of scheduled) {
      const anchor = taskAnchor(task);
      const date = toDate(anchor);
      if (!date) continue;
      const key = dayKey(date);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const bucket = tasks.get(key) ?? [];
      bucket.push(task);
      tasks.set(key, bucket);
    }
    for (const bucket of tasks.values()) {
      bucket.sort((a, b) => {
        const ta = taskAnchor(a) ?? '';
        const tb = taskAnchor(b) ?? '';
        return ta.localeCompare(tb);
      });
    }
    return { countsByDay: counts, tasksByDay: tasks };
  }, [scheduled]);

  /**
   * 考试按本地日分桶。月视图的圆点把它们也算进去（"这天有安排"就该点出来），
   * 日视图在时间轴上方单列一张卡 —— 考试不带完成态，混进任务行会被当成
   * "一条不能勾的怪任务"。
   */
  const examsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const event of events) {
      if (event.deletedAt) continue;
      const d = new Date(event.startAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }
    return map;
  }, [events]);

  /**
   * 纪念日落进日历的换算：每个纪念日算"离今天最近的那一次"落在哪天
   * （年度重复的滚到下一次周年，换算在 domain/nextMarkDate）。
   * 月历的圆点、点中那天日卡里的行，用的都是这一张表 ——
   * 两边永远是同一天，不会"格子上点出来了、卡片里却没说"。
   */
  const marksByDay = useMemo(() => {
    const map = new Map<string, MarkView[]>();
    for (const mark of marks) {
      const date = nextMarkDate(mark);
      if (!date) continue;
      const key = dayKey(date);
      const bucket = map.get(key) ?? [];
      bucket.push(describeMark(mark));
      map.set(key, bucket);
    }
    return map;
  }, [marks]);

  /** 底部那张"快到的日子"卡：挑法与原来首页那张同一份口径 */
  const upcomingMarks = useMemo(
    () => pickUpcoming(sortMarkViews(marks.map((mark) => describeMark(mark))), 3),
    [marks],
  );

  const monthCounts = useMemo(() => {
    const merged = new Map(countsByDay);
    for (const key of examsByDay.keys()) merged.set(key, (merged.get(key) ?? 0) + 1);
    // 纪念日也点出来：生日值得提前两天看见。点中那天，日卡里会说清这是什么
    for (const key of marksByDay.keys()) merged.set(key, (merged.get(key) ?? 0) + 1);
    return merged;
  }, [countsByDay, examsByDay, marksByDay]);

  const selectedExams = examsByDay.get(dayKey(selected)) ?? [];
  const selectedMarks = marksByDay.get(dayKey(selected)) ?? [];

  const handleDrop = useCallback(
    (task: Task, key: string) => {
      const targetDate = keyToDate(key);
      const anchor = taskAnchor(task);
      if (anchor && isSameDay(targetDate, new Date(anchor))) return; // 拖回原格 = 取消
      /**
       * 口径只有一份：`buildTimeOnDay` —— 已经有时间的换日期（时刻不动），
       * 还没有时间的（收集箱里那些）落到那天的 23:59 作为截止。
       * 以前这里直接调 `buildRescheduledTime`，它对没时间的任务返回 null，
       * 所以"从收集箱拖过来"会**静默无反应** —— 看起来像拖了没生效。
       */
      const time = buildTimeOnDay(task, targetDate);
      if (time) void scheduleTask(task.id, time);
    },
    [scheduleTask],
  );

  const { draggingTask, dropTargetKey, registerCell, gestureFor, ghostStyle, ghostVisible } =
    useCrossDayDrag({ onDrop: handleDrop });

  /**
   * 拖拽起止都记时刻：拖得再久，松手后那次 click 也落在 500ms 窗口内。
   * 周视图 / 日视图的拖块走 timelineDragging，同一条时间线。
   */
  const prevDragging = useRef(false);
  useEffect(() => {
    const dragging = draggingTask !== null || timelineDragging;
    if (prevDragging.current !== dragging) longPressAt.current = Date.now();
    prevDragging.current = dragging;
  }, [draggingTask, timelineDragging]);

  /**
   * 周视图拖任务时置 1：翻页手势（横划换周）看到它就不接管。
   * 用 shared value 而不是 JS state，是因为它要在 worklet 里被读 ——
   * 回 JS 查一次状态会让每一帧都跨线程通信。
   */
  const dragFlag = useSharedValue(0);

  /** 周视图落下：同时拿到"哪一天"和"几点几分" */
  const handlePlace = useCallback(
    async (task: Task, date: Date, minutesOfDay: number) => {
      const anchor = taskAnchor(task);
      const crossedDay = anchor ? !isSameDay(new Date(anchor), date) : false;
      const time = buildPlacedTime(task, date, minutesOfDay);
      if (!time) return;
      await scheduleTask(task.id, time);
      // 跨天之后切到那一天的日视图，用户可以接着把时刻微调到位
      if (crossedDay) focusDay(date);
    },
    [focusDay, scheduleTask],
  );

  /* ---------------- 横向翻页 ---------------- */

  const pagerX = useSharedValue(0);
  const pagerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pagerX.value }] }));

  const advance = useCallback(
    (dir: 1 | -1) => {
      // 待办看的是"当下手上欠着什么"，没有前后可分 —— 翻页对它没有意义
      if (mode === 'todo') return;
      if (mode === 'day') {
        setSelected((d) => addDays(d, dir));
      } else {
        setCursor((c) => (mode === 'month' ? addMonths(c, dir) : addDays(c, 7 * dir)));
      }
    },
    [mode],
  );
  /**
   * 翻一页：当前内容先朝"滑走方向"退出一点 → 换掉数据 → 新内容从对侧
   * 摆好再弹回原位。换页不闪白，视觉上是一次连续滑动。箭头按钮也走同一条路径。
   */
  const pageBy = useCallback(
    (dir: 1 | -1) => {
      const entryFrom: 1 | -1 = dir === 1 ? 1 : -1;
      pagerX.value = withTiming(-entryFrom * PAGE_OFFSET, { duration: 110 }, (finished) => {
        if (!finished) return;
        pagerX.value = entryFrom * PAGE_OFFSET;
        runOnJS(advance)(dir);
        pagerX.value = withSpring(0, { damping: 22, stiffness: 220 });
      });
    },
    [advance, pagerX],
  );

  const pagerGesture = useMemo(
    () =>
      Gesture.Pan()
        // 课表要横滑看 7 列，翻页手势必须先让开 —— 同一方向的两种手势抢起来，
        // 结果一定是"想滚表格却把周翻掉了"。
        // 待办也关掉：它没有"上一页/下一页"，横滑只会把内容无意义地推走再弹回。
        .enabled(mode !== 'timetable' && mode !== 'todo')
        .activeOffsetX([-16, 16])
        // 竖直方向留给滚动，一旦判定为竖划就放弃翻页
        .failOffsetY([-20, 20])
        .onUpdate((event) => {
          'worklet';
          if (dragFlag.value) return;
          const damped = event.translationX * 0.5;
          pagerX.value = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, damped));
        })
        .onEnd((event) => {
          'worklet';
          if (dragFlag.value) {
            pagerX.value = withSpring(0, { damping: 24, stiffness: 260 });
            return;
          }
          const passed =
            Math.abs(event.translationX) > PAN_THRESHOLD ||
            Math.abs(event.velocityX) > VELOCITY_THRESHOLD;
          if (!passed) {
            pagerX.value = withSpring(0, { damping: 24, stiffness: 260 });
            return;
          }
          // 向左滑 = 看下一个周期，新内容从右侧进来
          runOnJS(pageBy)(event.translationX < 0 ? 1 : -1);
        }),
    [dragFlag, mode, pageBy, pagerX],
  );

  /* ---------------- 派生数据 ---------------- */

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor, { weekStartsOn: 1 }), i)),
    [cursor],
  );

  const selectedTasks = tasksByDay.get(dayKey(selected)) ?? [];

  /**
   * 日/周视图里的"这段时间有课"背景带。
   *
   * 换算是 `coursesOnDate`（学期周次 + 作息表都在里面），日历不自己算时刻 ——
   * 否则同一节课在课表里是 10:00-11:40、在日历里变成别的，用户第一反应是
   * "数据串了"。课表关掉时**连背景带一起不算**，省掉一圈无意义的计算。
   */
  const courseSlotsForDay = useMemo(
    () => (timetableOn && term ? coursesOnDate(courses, selected, term) : []),
    [courses, selected, term, timetableOn],
  );

  const courseSlotsByDay = useMemo(() => {
    const map = new Map<string, CourseSlot[]>();
    if (!timetableOn || !term) return map;
    for (const day of weekDays) {
      const slots = coursesOnDate(courses, day, term);
      if (slots.length) map.set(dayKey(day), slots);
    }
    return map;
  }, [courses, term, timetableOn, weekDays]);

  /**
   * 月历整张网格上，每天有几节课。
   *
   * **和 `courseSlotsByDay` 不是一回事**：那个只覆盖当前这一周（周视图用），
   * 而月历要的是看得见的整张 6×7 格。只算一周的代价是"月历上只有一格那一周
   * 有空心点"，别的日子明明满课却画成实心 —— 看起来就是 bug。
   *
   * `coursesOnDate` 是纯内存查表（学期周次 + 作息表都在里面，不碰库），
   * 42 天 × 十几门课的开销远小于一次渲染，所以这儿值得多算一遍。
   */
  const courseCountByDay = useMemo(() => {
    const map = new Map<string, number>();
    if (!timetableOn || !term) return map;
    for (const day of monthGridDays(cursor)) {
      const count = coursesOnDate(courses, day, term).length;
      if (count) map.set(dayKey(day), count);
    }
    return map;
  }, [courses, cursor, term, timetableOn]);

  /**
   * 月历圆点的**形状**依据：那天各有多少课、多少场考试。
   *
   * `monthCounts` 只说"有几个点"，说不出这 3 个点里哪些是不用动手的课 ——
   * 一整天满课和一篇要交的论文在格子上长得一模一样，而用户扫月历要回答的
   * 恰恰是"哪天真的重"。所以这里按形状再分一次桶（形状口径与截断规则
   * 都在 `domain/calendar-shape.dayShapes`）。
   *
   * 课数取的是**整张月历网格**（`courseCountByDay`），考试是全量分桶 ——
   * 两边覆盖范围一致，否则会出现"这格有考试方块，旁边那格的课却不算"。
   */
  const dayMarks = useMemo(() => {
    const map = new Map<string, DayMarks>();
    for (const [key, count] of courseCountByDay) {
      map.set(key, { courses: count, exams: 0 });
    }
    for (const [key, list] of examsByDay) {
      const current = map.get(key) ?? { courses: 0, exams: 0 };
      map.set(key, { courses: current.courses, exams: list.length });
    }
    return map;
  }, [courseCountByDay, examsByDay]);

  /**
   * 当天的考试 → 时间轴上的实心块。
   *
   * 考试本来就有明确起止（"9:00–11:00 坐在考场里"），此前日视图只在轴外
   * 单列一行说"今天有考试"，时间轴上完全看不到它占着哪两节课。
   * 换算与课一样不在页面里做：`minutesOfDay` 只取当天的时分，
   * 跨天的（不会发生在考试上）按当天末尾截断。
   */
  const examSlotsForDay = useMemo<EventSlot[]>(() => {
    const dayStart = startOfDay(selected).getTime();
    const slots: EventSlot[] = [];
    for (const event of selectedExams) {
      const start = new Date(event.startAt);
      const end = event.endAt ? new Date(event.endAt) : null;
      // 没结束时刻的不画：一条没有长度的块在时间轴上什么也说明不了
      if (!end || end.getTime() <= start.getTime()) continue;
      slots.push({
        id: event.id,
        title: event.title,
        start: Math.round((start.getTime() - dayStart) / 60000),
        end: Math.round((end.getTime() - dayStart) / 60000),
        location: event.location,
      });
    }
    return slots.sort((a, b) => a.start - b.start);
  }, [selectedExams, selected]);

  /** 课表里长按拖课块：改的是被抓住的那一次安排（换星期/节次，跨度与周次不动） */
  const handleMoveSlot = useCallback(
    async (slot: CourseSlot, weekday: number, startPeriod: number) => {
      const next = moveSession(slot.course, sessionKey(slot.session), weekday, startPeriod);
      if (next) await saveCourse(next);
    },
    [saveCourse],
  );

  /** 日视图拖块改时刻：把分钟数写回实体（保持任务原本的时间属性） */
  const handleRetime = useCallback(
    async (task: Task, minutesOfDay: number) => {
      const time = buildRetimedTime(task, minutesOfDay);
      if (time) await scheduleTask(task.id, time);
    },
    [scheduleTask],
  );

  /** 日视图拽上下边改时段：始末一起写回（从此有了 endAt，块的高度就真实了） */
  const handleResize = useCallback(
    async (task: Task, startMinutes: number, endMinutes: number) => {
      const time = buildRetimedSpanTime(task, startMinutes, endMinutes);
      if (time) await scheduleTask(task.id, time);
    },
    [scheduleTask],
  );

  const busyDragging = draggingTask !== null || timelineDragging;

  const now = new Date();
  /** 课表视图里，光标那一周是第几周（没有学期或还没开学 → null） */
  const cursorWeek = mode === 'timetable' && term ? weekIndexOf(term, cursor) : null;
  const termStarted = cursorWeek != null && cursorWeek >= 1 && cursorWeek <= (term?.totalWeeks ?? 0);

  const headerLabel =
    mode === 'month'
      ? format(cursor, 'yyyy年M月')
      : mode === 'todo'
        ? // 待办不按日期看，所以这儿不放"月份"那种翻页标题，改成一句它自己的定位
          `手上欠着的 · ${groupTodos(allTasks).reduce((sum, g) => (g.bucket === 'done' ? sum : sum + g.tasks.length), 0)} 件`
        : mode === 'timetable'
          ? `${
              termStarted ? `第 ${cursorWeek} 周 · ` : term ? `${term.label} · ` : ''
            }${format(weekDays[0], 'M月d日')} - ${format(weekDays[6], 'M月d日')}`
          : mode === 'week'
            ? `${format(weekDays[0], 'M月d日')} - ${format(weekDays[6], 'M月d日')}`
            : `${format(selected, 'M月d日')} ${format(selected, 'EEEE')}${
                isSameDay(selected, now) ? ' · 今天' : ''
              }`;

  /*
    图例只留"看不出来的手势"。翻页、切视图、点课程块进详情都有可见的按钮或箭头
    —— 那些不用教（2026-10-07 从三句长说明压到一句十来字）。
    参考滴答清单：它的列表拖拽同样不做文字说明，靠手势本身和肌肉记忆。
  */
  const legend =
    mode === 'month'
      ? '长按一行拖到日期格：改期或安排到那天'
      : mode === 'week'
        ? '长按块横拖换天、纵拖换时刻'
        : mode === 'timetable'
          ? '点课块：改这一次（调课 / 停课）· 长按拖：改整学期'
          : mode === 'todo'
            ? // 待办里没有任何手势要教：点行进详情、点圈勾完成，都是看得见的
              ''
            : '长按块拖动改时刻 · 拽上下边改时长';

  /**
   * 月历圆点的三种形状，只有**月视图且这张月历上真出现过课或考试**时才解释。
   *
   * 为什么不常驻：绝大多数人不看说明，一句常驻的形状对照表只会把图例区撑成两行。
   * 而"格子上出现了空心点"这件事本身会让人愣一下 —— 那时候说明才有人读。
   * 课表关掉时「空心点＝课」这句也就没意义了（那天根本不会有空心点）。
   */
  const shapeLegend =
    timetableOn && (courseCountByDay.size || examsByDay.size)
      ? '圆点：实心＝任务 · 空心＝课 · 方块＝考试'
      : null;

  /**
   * 灰掉的是"已经结束"的两类：做完的、以及已经过去的时间段（上周的会）。
   * 判断复用 domain 的同一份口径，不在这里另写一遍 —— 两边一旦不一致，
   * 就会出现"图例说有灰的，屏幕上一个都没有"。
   */
  const hasMuted = scheduled.some((task) => isMuted(taskDisplayState(task)));

  return (
    <Screen
      title="日历"
      /*
        副标题随视图变：待办视图里"有时间的事才会出现在这里"恰好是**反的**
        —— 那一栏存在的意义就是"没时间的事也在"。副标题说错话比不写更糟。
      */
      subtitle={mode === 'todo' ? '跟时间无关，欠着你的都在这儿' : '有时间的事才会出现在这里'}
      scrollEnabled={!busyDragging}
      /*
        收集箱抽屉：贴在屏幕底部常驻，不随页面滚动。
        它是这个页面的第二个拖拽源头，落点就是上方那些日期格。
        为什么必须常驻：拖动期间页面滚动被锁死，源头一旦滚出屏幕就再也拖不到；
        而月历自身高度固定（6 行不跳），抽屉贴底不会把它挤变形。
        只在月视图出现 —— 周/日/课视图里没有"日期格"这个落点。
      */
      bottomBar={
        mode === 'month' && inbox.length ? (
          <View style={styles.drawer}>
            <View style={styles.drawerHead}>
              <ThemedText type="smallBold">收集箱 · {inbox.length} 件</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.drawerHint}>
                长按一行，拖到上面的日期格
              </ThemedText>
            </View>
            {inbox.slice(0, INBOX_DRAG_LIMIT).map((task) => (
              <DraggableTaskRow
                key={task.id}
                task={task}
                gestureFor={gestureFor}
                onOpen={guardedOpen}
                onComplete={guardedToggle}
              />
            ))}
            {inbox.length > INBOX_DRAG_LIMIT ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/inbox')}
                style={({ pressed }) => [styles.moreRow, { opacity: pressed ? 0.6 : 1 }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  还有 {inbox.length - INBOX_DRAG_LIMIT} 件 · 去收集箱
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }>
      <View ref={containerRef} style={styles.container} collapsable={false}>
        <View style={styles.toolbar}>
          <View style={styles.nav}>
            {/*
              待办视图没有"上一页/下一页"—— 它看的是当下手上欠着什么，
              翻到"上个月的待办"没有意义。所以那对箭头整个撤掉，
              标题退化成一句纯文字（不再是可点回今天的按钮）。
            */}
            {mode === 'todo' ? (
              <ThemedText type="smallBold">{headerLabel}</ThemedText>
            ) : (
              <>
                <NavButton label="‹" onPress={() => pageBy(-1)} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setCursor(new Date());
                    setSelected(new Date());
                  }}>
                  <ThemedText type="smallBold">{headerLabel}</ThemedText>
                </Pressable>
                <NavButton label="›" onPress={() => pageBy(1)} />
              </>
            )}
          </View>
          <Segmented value={mode} onChange={changeMode} segments={segments} />
        </View>

        <GestureDetector gesture={pagerGesture}>
          <Animated.View style={[styles.viewport, pagerStyle]}>
            <Animated.View style={[styles.viewportInner, contentStyle]}>
              {mode === 'month' ? (
                <>
                  <CalendarMonth
                    month={cursor}
                    selected={selected}
                    onSelectDay={setSelected}
                    countsByDay={monthCounts}
                    marksByDay={dayMarks}
                    registerCell={registerCell}
                    dropTargetKey={dropTargetKey}
                  />
                  <Card
                    title={`${isSameDay(selected, now) ? '今天' : format(selected, 'M月d日')} · ${selectedTasks.length + selectedExams.length} 件`}
                    hint={selectedTasks.length ? '长按任一行，拖到上面的日期格即可改期' : undefined}>
                    {/* 纪念日排在最前：它不是"一件事"，是这一天本身的底色 */}
                    {selectedMarks.map((view) => (
                      <Pressable
                        key={view.mark.id}
                        accessibilityRole="button"
                        onPress={() => router.push('/marks')}
                        style={styles.examRow}>
                        <Ionicons name="gift-outline" size={15} color={theme.textSecondary} />
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.examTitle}>
                          {view.mark.title}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {markLine(view)}
                        </ThemedText>
                      </Pressable>
                    ))}
                    {selectedExams.map((event) => (
                      <View key={event.id} style={styles.examRow}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.examTitle}>
                          {event.title}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {describeEvent(event)}
                        </ThemedText>
                      </View>
                    ))}
                    {selectedTasks.length ? (
                      selectedTasks.map((task) => (
                        <DraggableTaskRow
                          key={task.id}
                          task={task}
                          gestureFor={gestureFor}
                          onOpen={guardedOpen}
                          onComplete={guardedToggle}
                        />
                      ))
                    ) : selectedExams.length || selectedMarks.length ? null : (
                      <ThemedText type="small" themeColor="textSecondary">
                        这一天没有安排
                      </ThemedText>
                    )}
                  </Card>

                  {/*
                    纪念日：它的家本来就该是日历 —— 它是"一个日子"，不是"一件事"。
                    两层呈现：上面月历把"那一次"点出来、点中那天日卡里说清；
                    这张卡只回答一个问题：最近有什么日子快到了。
                  */}
                  <Card
                    title="纪念日"
                    hint={upcomingMarks.length ? undefined : '记一个还剩几天的日子'}
                    right={
                      <Pressable onPress={() => router.push('/marks')}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {marks.length ? '全部' : '去添加'}
                        </ThemedText>
                      </Pressable>
                    }>
                    {upcomingMarks.length ? (
                      upcomingMarks.map((view) => (
                        <Pressable
                          key={view.mark.id}
                          accessibilityRole="button"
                          onPress={() => router.push('/marks')}
                          style={styles.markRow}>
                          <View style={styles.markNumberBlock}>
                            <ThemedText type="smallBold" style={styles.markNumber}>
                              {view.headline}
                            </ThemedText>
                            <ThemedText
                              type="small"
                              themeColor="textSecondary"
                              style={styles.markCaption}>
                              {view.caption}
                            </ThemedText>
                          </View>
                          <ThemedText type="small" numberOfLines={1} style={styles.markTitle}>
                            {view.mark.title}
                          </ThemedText>
                        </Pressable>
                      ))
                    ) : (
                      <ThemedText type="small" themeColor="textSecondary">
                        还没有纪念日。生日、考试、在一起多久，都可以记一个。
                      </ThemedText>
                    )}
                  </Card>
                  {/*
                    收集箱抽屉已移到屏幕底部常驻（见页面外层 bottomBar）——
                    它以前待在滚动流的最末尾，手机上一滚就跑到屏幕外，
                    而拖动期间滚动是锁死的：源头看不见 = 拖不到。
                    现在它是滚动区的兄弟节点，月历永远在它上方同屏可见。
                  */}
                </>
              ) : null}

              {mode === 'week' ? (
                <CalendarWeek
                  days={weekDays}
                  tasksByDay={tasksByDay}
                  courseSlotsByDay={courseSlotsByDay}
                  onSelectTask={guardedOpen}
                  onPlace={handlePlace}
                  onOpenDay={focusDay}
                  onDraggingChange={setTimelineDragging}
                  dragFlag={dragFlag}
                />
              ) : null}

              {mode === 'day' ? (
                <>
                  {selectedExams.length ? (
                    <Card title={`考试 · ${selectedExams.length} 场`} hint="考试不带完成态，到点就是它">
                      {selectedExams.map((event) => (
                        <View key={event.id} style={styles.examRow}>
                          <ThemedText type="smallBold" numberOfLines={1} style={styles.examTitle}>
                            {event.title}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {describeEvent(event)}
                          </ThemedText>
                        </View>
                      ))}
                    </Card>
                  ) : null}
                  <CalendarDay
                    date={selected}
                    tasks={selectedTasks}
                    courseSlots={courseSlotsForDay}
                    examSlots={examSlotsForDay}
                    onSelectTask={guardedOpen}
                    onCompleteTask={guardedToggle}
                    onRetime={handleRetime}
                    onResize={handleResize}
                    onDraggingChange={setTimelineDragging}
                  />
                </>
              ) : null}

              {mode === 'todo' ? (
                <TodoView
                  tasks={allTasks}
                  onOpen={openTask}
                  onComplete={toggleById}
                  onCapture={() => router.push('/capture')}
                />
              ) : null}

              {mode === 'timetable' ? (
                <TimetableView
                  courses={courses}
                  term={term}
                  cursor={cursor}
                  onSelectSlot={openCourseSlot}
                  onSelectCourse={openCourse}
                  onImport={openImport}
                  onImportExams={openImportExams}
                  onAddCourse={openAddCourse}
                  onOpenTerm={openTermSettings}
                  onMoveSlot={handleMoveSlot}
                  onDraggingChange={setTimelineDragging}
                />
              ) : null}
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        {/*
          图例区。待办视图整个不渲染它 —— 那一栏的 legend 是空串，
          而这段逻辑还会因为"今天没有已排的事"补一句"这个范围内还没有安排"，
          在待办里就是错的话（待办的存在意义正是"没时间的也在"）。
        */}
        {mode === 'todo' ? null : (
          <View style={[styles.legend, { borderColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
              {mode === 'timetable'
                ? legend
                : scheduled.length
                  ? hasMuted
                    ? `${legend}。灰掉的是已完成的、或已经过去的事`
                    : legend
                  : '这个范围内还没有安排 —— 换个月份看看，或者记一条带时间的事，它会自动出现在这里并按时提醒你'}
            </ThemedText>
            {mode === 'month' && shapeLegend ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
                {shapeLegend}
              </ThemedText>
            ) : null}
          </View>
        )}

        {/* 跟手的浮动块：拖拽期间显示任务标题，位置由 UI 线程直接驱动 */}
        {ghostVisible && draggingTask ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.ghost, { backgroundColor: theme.text }, ghostStyle]}>
            <ThemedText type="small" numberOfLines={1} style={{ color: theme.background }}>
              {draggingTask.title}
            </ThemedText>
          </Animated.View>
        ) : null}

        {/* 课块的面板：时间选择器打开时先收起它，避免两层弹层叠在一起 */}
        <CourseSlotSheet
          visible={!!courseSlot && !slotTimeOpen}
          slot={courseSlot}
          periods={term?.periods ?? []}
          onChangeTime={() => setSlotTimeOpen(true)}
          onCancel={() => void cancelCourseSlot()}
          onRestore={() => void restoreCourseSlot()}
          onOpenCourse={() => {
            if (!courseSlot) return;
            const courseId = courseSlot.course.id;
            setCourseSlot(null);
            router.push(`/course/${courseId}`);
          }}
          onClose={() => setCourseSlot(null)}
        />

        <CourseSessionSheet
          visible={slotTimeOpen}
          totalWeeks={term?.totalWeeks ?? 18}
          periodCount={term?.periods.length}
          /* 预填当前那一次的时间：调过来的块填的是"它现在在哪儿"，停课的那一格
             填的是它原本的安排 —— 两种情况下用户看到的都是屏幕上这一块的时间 */
          initial={courseSlot?.session ?? null}
          scope="once"
          onSubmit={(picked) => void applySlotTime(picked)}
          onClose={() => setSlotTimeOpen(false)}
        />
      </View>
    </Screen>
  );
}

interface DraggableTaskRowProps {
  task: Task;
  gestureFor: (task: Task) => ReturnType<typeof Gesture.Pan>;
  onOpen: (task: Task) => void;
  onComplete: (task: Task) => void;
}

/**
 * 可拖拽的月视图行。
 *
 * 单独抽成 memo 组件，是为了让手势对象在拖拽过程中保持稳定 ——
 * 拖到一半重建手势会被系统打断（这是手写手势时最容易踩的坑）。
 */
const DraggableTaskRow = memo(function DraggableTaskRow({
  task,
  gestureFor,
  onOpen,
  onComplete,
}: DraggableTaskRowProps) {
  // 手势对象必须长期稳定 —— 拖到一半重建会被系统打断，所以无条件建好再用
  const gesture = useMemo(() => gestureFor(task), [gestureFor, task]);
  const done = task.status === TaskStatus.Done;

  const row = (
    <View style={styles.dragRow}>
      <TaskRow
        task={task}
        onComplete={onComplete}
        onPress={onOpen}
        // 没有抓手 = 拖不动，视觉上先说清楚，不靠"拖了没反应"去教
        trailing={done ? undefined : <DragGrip />}
      />
    </View>
  );

  // 已完成的不给拖：那天已经过去了，挪它没有意义。要改就进详情页
  if (done) return row;
  return <GestureDetector gesture={gesture}>{row}</GestureDetector>;
});

function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.navButton, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const SEGMENTS: Array<{ key: CalendarMode; label: string }> = [
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
  { key: 'day', label: '日' },
  { key: 'timetable', label: '课' },
  { key: 'todo', label: '待办' },
];

/** 分段控件：高亮块跟着选中项平移，而不是硬切换 */
function Segmented({
  value,
  onChange,
  segments = SEGMENTS,
  style,
}: {
  value: CalendarMode;
  onChange: (mode: CalendarMode) => void;
  /** 可选项；课表被关掉时调用方会少传一项（高亮块宽度跟着重算） */
  segments?: ReadonlyArray<{ key: CalendarMode; label: string }>;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const slide = useSharedValue(0);
  const index = Math.max(0, segments.findIndex((s) => s.key === value));
  const segWidth = trackWidth ? (trackWidth - 4) / segments.length : 0;

  useEffect(() => {
    slide.value = withSpring(index * segWidth, { damping: 20, stiffness: 240 });
  }, [index, segWidth, slide]);

  const sliderStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.segmented, { backgroundColor: theme.backgroundSelected }, style]}>
      {segWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentSlider,
            { width: segWidth, backgroundColor: theme.background },
            sliderStyle,
          ]}
        />
      ) : null}
      {segments.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.key)}
            style={styles.segment}>
            <ThemedText
              type="small"
              themeColor={active ? 'text' : 'textSecondary'}
              style={active ? styles.segmentActive : undefined}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  /**
   * 工具栏：加了「待办」之后分段变五个，窄屏上一行放不下
   * （导航区 + 五个分段超过 439pt），所以允许换行 ——
   * 挤不下时分段整体落到第二行，而不是把标题压到看不清。
   * 分段自己不换行（它内部有绝对定位的高亮块，拆行会错位）。
   */
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  nav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  navButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: { flexDirection: 'row', borderRadius: Spacing.two, padding: 2 },
  segmentSlider: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 6,
  },
  segment: {
    // 加「待办」后从 16 收到 12：单字标签本来就有余量，收窄能多挤一个进来，
    // 尽量让五个分段留在同一行（换行是兜底，不是首选）
    paddingHorizontal: 12,
    paddingVertical: Spacing.one,
    borderRadius: 6,
    minWidth: 34,
    alignItems: 'center',
  },
  segmentActive: { fontWeight: '700' },
  viewport: { flex: 1 },
  viewportInner: { gap: Spacing.four },
  legend: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    // 形状说明是第二行，和手势那句之间留一口气；只有一行时 gap 不起作用
    gap: 2,
  },
  legendText: { fontSize: 12, lineHeight: 18, opacity: 0.75 },
  dragRow: { width: '100%' },
  /**
   * 贴底抽屉。刻意不画 Card 那种边框/底色 ——
   * 它是"屏幕的一部分"，不是浮在内容上的一张卡；再有边框会看着像挡住了日历。
   * 上方留一条细线把"屏幕下方这块是另一个区"讲清楚就够了。
   */
  drawer: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  drawerHint: { flex: 1, textAlign: 'right' },
  /** 「还有 N 件 · 去收集箱」—— 居中的一行轻提示，不是主操作 */
  moreRow: { paddingTop: Spacing.two, alignItems: 'center' },
  examRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  examTitle: { flex: 1 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  markNumberBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 3, minWidth: 62 },
  markNumber: { fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  markCaption: { fontSize: 11, lineHeight: 14 },
  markTitle: { flex: 1 },
  ghost: {
    position: 'fixed',
    left: 0,
    top: 0,
    width: 172,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    opacity: 0.92,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
});
