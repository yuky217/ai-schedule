import { addDays, addMonths, format, isSameDay, startOfWeek } from 'date-fns';
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

import { CalendarDay } from '@/components/calendar-day';
import { CalendarMonth } from '@/components/calendar-month';
import { CalendarWeek } from '@/components/calendar-week';
import { Card } from '@/components/card';
import { DragGrip } from '@/components/drag-grip';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { calendarWindow, windowKey } from '@/domain/calendar-window';
import { buildPlacedTime, buildRescheduledTime, buildRetimedTime } from '@/domain/schedule-presets';
import type { Task } from '@/domain/task';
import { useCrossDayDrag } from '@/hooks/use-cross-day-drag';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { toDate } from '@/utils/datetime';

/**
 * 日历：只呈现"有明确时间"的事。
 *
 * 三个视图共用一套数据与导航（切视图不重新查库、不重挂列表）：
 * - 月：看全局节奏（哪天忙），**长按任意一行**拖到日期格即改期
 * - 周：7 天列 × 小时轴的时间网格，**长按任务块横拖换天、纵拖换时刻**；
 *   跨天落下后自动切到那天的日视图，接着微调；点表头也能直接进某天
 * - 日：看当天时间轴，**长按任务块上下拖**即改时刻（吸 15 分钟刻度）
 *
 * 手势全部交给 react-native-gesture-handler，动画全部交给 react-native-reanimated：
 * - 手势在原生层识别（长按拾起 / 拖拽 / 翻页互不抢），单击仍然照常触发按钮；
 * - 跟手的浮块与页面位移由 shared value 驱动，跑在 UI 线程，JS 忙也不会掉帧。
 */

type CalendarMode = 'month' | 'week' | 'day';

/** 跟手位移上限（超过就不动，给用户"到头了"的手感） */
const PAN_LIMIT = 56;
/** 松手判定翻页的位移（px）/ 速度（px/s）阈值 */
const PAN_THRESHOLD = 56;
const VELOCITY_THRESHOLD = 350;
/** 翻页时新旧内容错位的距离 */
const PAGE_OFFSET = 44;

const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');
const keyToDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export default function CalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const loadScheduledBetween = useAppStore((state) => state.loadScheduledBetween);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const completeTask = useAppStore((state) => state.completeTask);
  const scheduleTask = useAppStore((state) => state.scheduleTask);

  const [mode, setMode] = useState<CalendarMode>('month');
  /** 月视图 = 正在看的月份；周视图 = 正在看的周（任取周内一天） */
  const [cursor, setCursor] = useState<Date>(new Date());
  /** 月视图选中的那天 / 日视图正在看的那天 */
  const [selected, setSelected] = useState<Date>(new Date());
  /** 日视图拖块改时刻期间，也要锁住页面滚动 */
  const [timelineDragging, setTimelineDragging] = useState(false);

  const containerRef = useRef<View>(null);

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
  const completeById = useCallback(
    (task: Task) => {
      void completeTask(task.id);
    },
    [completeTask],
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

  /* ---------------- 跨天拖拽改期（月视图） ---------------- */

  const { countsByDay, tasksByDay } = useMemo(() => {
    const counts = new Map<string, number>();
    const tasks = new Map<string, Task[]>();
    for (const task of scheduled) {
      const anchor = task.time.startAt ?? task.time.dueAt;
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
        const ta = a.time.startAt ?? a.time.dueAt ?? '';
        const tb = b.time.startAt ?? b.time.dueAt ?? '';
        return ta.localeCompare(tb);
      });
    }
    return { countsByDay: counts, tasksByDay: tasks };
  }, [scheduled]);

  const handleDrop = useCallback(
    (task: Task, key: string) => {
      const targetDate = keyToDate(key);
      const anchor = task.time.startAt ?? task.time.dueAt;
      if (anchor && isSameDay(targetDate, new Date(anchor))) return; // 拖回原格 = 取消
      const time = buildRescheduledTime(task, targetDate);
      if (time) void scheduleTask(task.id, time);
    },
    [scheduleTask],
  );

  const { draggingTask, dropTargetKey, registerCell, gestureFor, ghostStyle, ghostVisible } =
    useCrossDayDrag({ containerRef, onDrop: handleDrop });

  /**
   * 周视图拖任务时置 1：翻页手势（横划换周）看到它就不接管。
   * 用 shared value 而不是 JS state，是因为它要在 worklet 里被读 ——
   * 回 JS 查一次状态会让每一帧都跨线程通信。
   */
  const dragFlag = useSharedValue(0);

  /** 周视图落下：同时拿到"哪一天"和"几点几分" */
  const handlePlace = useCallback(
    async (task: Task, date: Date, minutesOfDay: number) => {
      const anchor = task.time.startAt ?? task.time.dueAt;
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
    [dragFlag, pageBy, pagerX],
  );

  /* ---------------- 派生数据 ---------------- */

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor, { weekStartsOn: 1 }), i)),
    [cursor],
  );

  const selectedTasks = tasksByDay.get(dayKey(selected)) ?? [];

  /** 日视图拖块改时刻：把分钟数写回实体（保持任务原本的时间属性） */
  const handleRetime = useCallback(
    async (task: Task, minutesOfDay: number) => {
      const time = buildRetimedTime(task, minutesOfDay);
      if (time) await scheduleTask(task.id, time);
    },
    [scheduleTask],
  );

  const busyDragging = draggingTask !== null || timelineDragging;

  const now = new Date();
  const headerLabel =
    mode === 'month'
      ? format(cursor, 'yyyy年M月')
      : mode === 'week'
        ? `${format(weekDays[0], 'M月d日')} - ${format(weekDays[6], 'M月d日')}`
        : `${format(selected, 'M月d日')} ${format(selected, 'EEEE')}${
            isSameDay(selected, now) ? ' · 今天' : ''
          }`;

  const legend =
    mode === 'month'
      ? '长按任意一行拖到日期格上可改期；左右滑切换月份'
      : mode === 'week'
        ? '长按任务块左右拖换天、上下拖换时刻；松手跨天会自动进那天的日视图；点表头也能进某天'
        : '长按任务块上下拖可改时刻；点块进详情；左右滑切换日期';

  return (
    <Screen title="日历" subtitle="有时间的事才会出现在这里" scrollEnabled={!busyDragging}>
      <View ref={containerRef} style={styles.container} collapsable={false}>
        <View style={styles.toolbar}>
          <View style={styles.nav}>
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
          </View>
          <Segmented value={mode} onChange={changeMode} />
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
                    countsByDay={countsByDay}
                    registerCell={registerCell}
                    dropTargetKey={dropTargetKey}
                  />
                  <Card
                    title={`${isSameDay(selected, now) ? '今天' : format(selected, 'M月d日')} · ${selectedTasks.length} 件`}
                    hint={selectedTasks.length ? '长按任一行，拖到上面的日期格即可改期' : undefined}>
                    {selectedTasks.length ? (
                      selectedTasks.map((task) => (
                        <DraggableTaskRow
                          key={task.id}
                          task={task}
                          gestureFor={gestureFor}
                          onOpen={openTask}
                          onComplete={completeById}
                        />
                      ))
                    ) : (
                      <ThemedText type="small" themeColor="textSecondary">
                        这一天没有安排
                      </ThemedText>
                    )}
                  </Card>
                </>
              ) : null}

              {mode === 'week' ? (
                <CalendarWeek
                  days={weekDays}
                  tasksByDay={tasksByDay}
                  onSelectTask={openTask}
                  onPlace={handlePlace}
                  onOpenDay={focusDay}
                  onDraggingChange={setTimelineDragging}
                  dragFlag={dragFlag}
                />
              ) : null}

              {mode === 'day' ? (
                <CalendarDay
                  date={selected}
                  tasks={selectedTasks}
                  onSelectTask={openTask}
                  onCompleteTask={completeById}
                  onRetime={handleRetime}
                  onDraggingChange={setTimelineDragging}
                />
              ) : null}
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        <View style={[styles.legend, { borderColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.legendText}>
            {scheduled.length
              ? legend
              : '这个范围内还没有安排 —— 换个月份看看，或者记一条带时间的事，它会自动出现在这里并按时提醒你'}
          </ThemedText>
        </View>

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
  const gesture = useMemo(() => gestureFor(task), [gestureFor, task]);
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.dragRow}>
        <TaskRow
          task={task}
          onComplete={onComplete}
          onPress={onOpen}
          trailing={<DragGrip />}
        />
      </View>
    </GestureDetector>
  );
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
];

/** 分段控件：高亮块跟着选中项平移，而不是硬切换 */
function Segmented({
  value,
  onChange,
  style,
}: {
  value: CalendarMode;
  onChange: (mode: CalendarMode) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const slide = useSharedValue(0);
  const index = Math.max(0, SEGMENTS.findIndex((s) => s.key === value));
  const segWidth = trackWidth ? (trackWidth - 4) / SEGMENTS.length : 0;

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
      {SEGMENTS.map((opt) => {
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 6,
    minWidth: 34,
    alignItems: 'center',
  },
  segmentActive: { fontWeight: '700' },
  viewport: { flex: 1 },
  viewportInner: { gap: Spacing.four },
  legend: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
  legendText: { fontSize: 12, lineHeight: 18, opacity: 0.75 },
  dragRow: { width: '100%' },
  ghost: {
    position: 'absolute',
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
