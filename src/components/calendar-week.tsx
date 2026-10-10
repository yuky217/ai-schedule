import { format, isSameDay } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CourseSlot } from '@/domain/course';
import { layoutLanes, type LanePlacement } from '@/domain/lane-layout';
import { isMuted, taskDisplayState } from '@/domain/task-state';
import { taskAnchor, type Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';

/**
 * 周视图：一周 7 列 × 小时轴的时间网格。
 *
 * 为什么不继续用"每天一张卡片"的老写法：卡片只能表达"这天有这件事"，
 * 没法表达"几点"。而拖拽恰恰需要"落在哪一天 + 落在哪个时刻"两个坐标 ——
 * 这正是成熟日历（Google Calendar / Fantastical / Notion Calendar）都用
 * 时间网格做周视图的原因。列窄是真的，但周视图的职责本来就是"看节奏"，
 * 想看清某天的事，点一下表头就进日视图。
 *
 * **同一时刻的多件事并排**（分道算法在 `domain/lane-layout`）：
 * 列里直接铺满会互相盖住，看起来像"另一件凭空没了"；
 * **课是背景带**（虚线、压在最底下、不可点），只说"这段有课"，不占日程。
 *
 * 手势（全部交给 react-native-gesture-handler，浮块跑 UI 线程）：
 * - **长按 220ms 拾起**：单击仍然是"打开详情"，不会误触发拖拽；
 * - 横向拖 = 换天，纵向拖 = 换时刻，两者在**同一次手势**里同时生效，
 *   吸到 15 分钟刻度；左侧刻度栏跟随手指显示目标时刻，目标列高亮；
 * - 松手落库；如果跨到了另一天，调用方会切到那天的日视图（继续微调）。
 */

const START_HOUR = 5;
const END_HOUR = 24;
const HOUR_HEIGHT = 52;
const GUTTER_WIDTH = 36;
/** 少于这个宽度就不再画时刻文字，避免糊成一团 */
const TIME_LABEL_MIN_WIDTH = 52;
const SNAP_MINUTES = 15;
const LAST_SLOT_MINUTES = 23 * 60 + 45;
const PICK_UP_DELAY = 220;
const COLUMNS = 7;

const clampMinutes = (minutes: number): number => {
  'worklet';
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(LAST_SLOT_MINUTES, snapped));
};

const clampColumn = (index: number): number => {
  'worklet';
  return Math.max(0, Math.min(COLUMNS - 1, index));
};

const topForMinutes = (minutes: number): number =>
  ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

const minutesOfDay = (iso: string): number => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

const formatMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');

/** 没有结束时长的任务块按半小时画 */
const DEFAULT_BLOCK_MINUTES = 30;

/** 一天的任务换算成"当天第几分钟"的区间（没有开始时刻的不上时间轴） */
interface PlacedTask {
  task: Task;
  start: number;
  end: number;
}

/**
 * 把一列里的任务分道。
 * 纯计算，直接调 —— 它跑在 `days.map` 里面，用不了 hook（循环里不能有 hook）。
 */
function placedOf(tasks: readonly Task[]): Array<LanePlacement<PlacedTask>> {
  const spans: PlacedTask[] = [];
  for (const task of tasks) {
    const anchor = taskAnchor(task);
    if (!anchor) continue;
    const start = minutesOfDay(anchor);
    const end = task.time.endAt ? minutesOfDay(task.time.endAt) : start + DEFAULT_BLOCK_MINUTES;
    spans.push({ task, start, end: Math.max(start + DEFAULT_BLOCK_MINUTES, end) });
  }
  return layoutLanes(spans, (a, b) => a.start - b.start || a.end - b.end);
}

export interface CalendarWeekProps {
  /** 一周 7 天，周一起 */
  days: Date[];
  tasksByDay: Map<string, Task[]>;
  /** 每天要上的课（背景带）：只说"这段有课"，不占日程、不可点 */
  courseSlotsByDay?: Map<string, CourseSlot[]>;
  onSelectTask: (task: Task) => void;
  /** 拖动落库：目标日期 + 当天第几分钟 */
  onPlace?: (task: Task, date: Date, minutesOfDay: number) => Promise<void> | void;
  /**
   * 在某一列的**空白处**长按拖出一个时段 → 在那天的那个时段新建日程（2026-10-10）。
   *
   * 与日视图同一个出口，只是多带一个"哪一天"（在这里，**列就是天**）。
   * 只认竖直拖：横向留给翻页 —— 想在别的日子建，就去那一列上拖。
   * 落点在那一**列**（不是"起点列 + 横移量"）：列窄，横着挪列的手感远不如直接去目标列。
   */
  onCreateSpan?: (date: Date, startMinutes: number, endMinutes: number) => void;
  /** 点某天表头 = 切到那天的日视图 */
  onOpenDay?: (date: Date) => void;
  /** 拖拽开始 / 结束：父层用它临时锁住页面滚动 */
  onDraggingChange?: (dragging: boolean) => void;
  /** 父层的翻页手势用它判断"正在拖任务，别接管" */
  dragFlag?: SharedValue<number>;
}

export function CalendarWeek({
  days,
  tasksByDay,
  courseSlotsByDay,
  onSelectTask,
  onPlace,
  onOpenDay,
  onDraggingChange,
  dragFlag,
  onCreateSpan,
}: CalendarWeekProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [dragging, setDragging] = useState(false);
  const [colWidth, setColWidth] = useState(0);
  /** 拖拽中的落点提示：哪一列 + 哪个时刻 */
  const [hover, setHover] = useState<{ column: number; minutes: number } | null>(null);

  const colWidthSV = useSharedValue(0);

  const setDraggingState = useCallback(
    (next: boolean) => {
      setDragging(next);
      onDraggingChange?.(next);
    },
    [onDraggingChange],
  );

  /* ---------------- 空白处拖出一个时段 → 新建日程（2026-10-10） ---------------- */

  /*
   * 锚点 / 限流 / 松手补半小时这一套与日视图完全同构（那边有完整注释，
   * 包括"为什么必须长按"和"为什么原地松手也给半小时"）。这里只多记一个 column ——
   * 周视图的「哪一列」就是「哪一天」。
   */
  const draftAnchor = useSharedValue(0);
  const draftLo = useSharedValue(0);
  const draftHi = useSharedValue(0);
  const draftKey = useSharedValue(-1);
  const [draft, setDraft] = useState<{ column: number; start: number; end: number } | null>(null);

  const beginDraft = useCallback(
    (column: number, minutes: number) => {
      setDraft({ column, start: minutes, end: minutes });
      setDraggingState(true);
      // 拿起来了就不许翻页：用户已经在"创建"这件事里，页面不该在他手底下换走
      if (dragFlag) dragFlag.value = 1;
    },
    [dragFlag, setDraggingState],
  );

  const updateDraft = useCallback(
    (column: number, lo: number, hi: number) => setDraft({ column, start: lo, end: hi }),
    [],
  );

  const commitDraft = useCallback(
    (column: number, lo: number, hi: number) => {
      setDraft(null);
      onCreateSpan?.(days[column], lo, hi > lo ? hi : lo + DEFAULT_BLOCK_MINUTES);
    },
    [days, onCreateSpan],
  );

  const endDraft = useCallback(() => {
    setDraft(null);
    setDraggingState(false);
    if (dragFlag) dragFlag.value = 0;
  }, [dragFlag, setDraggingState]);

  /** 每列一个手势：列索引是常量，7 个一起建出来，别在 render 里现造 */
  const createGestures = useMemo(
    () =>
      Array.from({ length: COLUMNS }, (_, column) =>
        Gesture.Pan()
          .activateAfterLongPress(PICK_UP_DELAY)
          // 横向留给翻页，这个手势只认竖直（想在别的日子建，去那一列上拖）
          .failOffsetX([-16, 16])
          .shouldCancelWhenOutside(false)
          .onStart((event) => {
            'worklet';
            const at = clampMinutes(START_HOUR * 60 + (event.y / HOUR_HEIGHT) * 60);
            draftAnchor.value = at;
            draftLo.value = at;
            draftHi.value = at;
            draftKey.value = -1;
            runOnJS(beginDraft)(column, at);
          })
          .onUpdate((event) => {
            'worklet';
            const at = clampMinutes(START_HOUR * 60 + (event.y / HOUR_HEIGHT) * 60);
            const lo = Math.min(draftAnchor.value, at);
            const hi = Math.max(draftAnchor.value, at);
            draftLo.value = lo;
            draftHi.value = hi;
            const key = lo * 2000 + hi;
            if (key !== draftKey.value) {
              draftKey.value = key;
              runOnJS(updateDraft)(column, lo, hi);
            }
          })
          .onEnd((event) => {
            'worklet';
            const at = clampMinutes(START_HOUR * 60 + (event.y / HOUR_HEIGHT) * 60);
            runOnJS(commitDraft)(
              column,
              Math.min(draftAnchor.value, at),
              Math.max(draftAnchor.value, at),
            );
          })
          .onFinalize(() => {
            'worklet';
            runOnJS(endDraft)();
          }),
      ),
    [beginDraft, commitDraft, draftAnchor, draftHi, draftKey, draftLo, endDraft, updateDraft],
  );

  const draftStyle = useAnimatedStyle(() => {
    const top = ((draftLo.value - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height = ((draftHi.value - draftLo.value) / 60) * HOUR_HEIGHT;
    return { top: Math.max(0, top), height: Math.max(3, height) };
  });

  // 一进周视图先滚到 8:00 附近，别让用户盯着凌晨的空白
  useEffect(() => {
    const timer = setTimeout(
      () => scrollRef.current?.scrollTo({ y: topForMinutes(8 * 60) - 20, animated: false }),
      0,
    );
    return () => clearTimeout(timer);
  }, []);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const timelineHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const now = new Date();

  const hoverColumnRect = useMemo(() => {
    if (!hover || !colWidth) return null;
    return { left: hover.column * colWidth, width: colWidth, top: topForMinutes(hover.minutes) };
  }, [colWidth, hover]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      {/* 表头：周一…周日 + 日期，点一下就进那天的日视图 */}
      <View style={styles.header}>
        <View style={{ width: GUTTER_WIDTH }} />
        {days.map((day, column) => {
          const key = dayKey(day);
          const count = tasksByDay.get(key)?.length ?? 0;
          const today = isSameDay(day, now);
          const hovered = hover?.column === column;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${format(day, 'M月d日')}，进入日视图`}
              onPress={() => onOpenDay?.(day)}
              style={[styles.headerCell, hovered && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.weekday}>
                {format(day, 'EEEEE')}
              </ThemedText>
              <View
                style={[
                  styles.dayBadge,
                  today && { backgroundColor: theme.text },
                ]}>
                <ThemedText
                  type="small"
                  style={[styles.dayText, today ? { color: theme.background } : { color: theme.text }]}>
                  {day.getDate()}
                </ThemedText>
              </View>
              <View style={styles.countDot}>
                {count ? (
                  <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        scrollEnabled={!dragging}
        style={styles.scroll}>
        <View style={styles.timeline} onLayout={(e) => {
          const width = e.nativeEvent.layout.width - GUTTER_WIDTH;
          const next = width / COLUMNS;
          setColWidth(next);
          colWidthSV.value = next;
        }}>
          <View style={{ height: timelineHeight, flexDirection: 'row' }}>
            {/* 左侧刻度 */}
            <View style={{ width: GUTTER_WIDTH }}>
              {hours.map((hour, index) => (
                <View key={hour} style={[styles.hourLabelRow, { top: index * HOUR_HEIGHT }]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hourLabel}>
                    {String(hour).padStart(2, '0')}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* 7 天列 */}
            <View style={styles.columns}>
              {days.map((day, column) => {
                const key = dayKey(day);
                const tasks = tasksByDay.get(key) ?? [];
                return (
                  <View key={key} style={styles.column}>
                    {/*
                      空白层：长按拖出一个时段 → 新建日程。
                      **先渲染 = 在本列最下面**，所以按在已有的块上仍然是"拖那一块"；
                      而列里的刻线全是 `pointerEvents="none"`，不会把它挡掉。
                    */}
                    {onCreateSpan ? (
                      <GestureDetector gesture={createGestures[column]}>
                        <View
                          accessibilityLabel={`长按并拖动，在${format(day, 'M月d日')}新建日程`}
                          style={styles.createLayer}
                        />
                      </GestureDetector>
                    ) : null}

                    {hours.map((hour, index) => (
                      <View
                        key={hour}
                        pointerEvents="none"
                        style={[
                          styles.hourLine,
                          { top: index * HOUR_HEIGHT, backgroundColor: theme.backgroundSelected },
                        ]}
                      />
                    ))}
                    {/* 课：背景带压在任务下面，只说明"这段有课" */}
                    {(courseSlotsByDay?.get(key) ?? []).map((slot, index) => (
                      <View
                        key={`course-${slot.course.id}-${index}`}
                        pointerEvents="none"
                        style={[
                          styles.courseBand,
                          {
                            top: Math.max(0, topForMinutes(slot.start)),
                            height: Math.max(20, ((slot.end - slot.start) / 60) * HOUR_HEIGHT),
                            borderColor: theme.textSecondary,
                          },
                        ]}
                      />
                    ))}

                    {placedOf(tasks).map(({ item, lane, lanes }) => {
                      const { task, start, end } = item;
                      const top = Math.max(0, topForMinutes(start));
                      const height = (Math.max(DEFAULT_BLOCK_MINUTES, end - start) / 60) * HOUR_HEIGHT;

                      return (
                        <WeekBlock
                          key={task.id}
                          task={task}
                          top={top}
                          height={height}
                          column={column}
                          lane={lane}
                          lanes={lanes}
                          colWidth={colWidth}
                          colWidthSV={colWidthSV}
                          startMinutes={start}
                          width={colWidth / lanes}
                          onSelect={onSelectTask}
                          onPlace={onPlace}
                          days={days}
                          onHover={setHover}
                          onDraggingChange={setDraggingState}
                          dragFlag={dragFlag}
                        />
                      );
                    })}

                    {/* 当前时间线：只在今天那一列画 */}
                    {isSameDay(day, now) &&
                    now.getHours() >= START_HOUR &&
                    now.getHours() < END_HOUR ? (
                      <View
                        pointerEvents="none"
                        style={[styles.nowLine, { top: topForMinutes(now.getHours() * 60 + now.getMinutes()) }]}>
                        <View style={[styles.nowBar, { backgroundColor: theme.text }]} />
                      </View>
                    ) : null}

                    {/* 拖动中还没落定的那一段：任务块的样子 + 半透明 */}
                    {draft && draft.column === column ? (
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.block, draftStyle, styles.draftBlock]}>
                        <View
                          style={[
                            styles.blockInner,
                            { backgroundColor: theme.backgroundSelected, borderLeftColor: theme.text },
                          ]}>
                          <ThemedText
                            type="small"
                            numberOfLines={1}
                            themeColor="textSecondary"
                            style={styles.blockTitle}>
                            {draft.end > draft.start
                              ? `${formatMinutes(draft.start)}–${formatMinutes(draft.end)}`
                              : formatMinutes(draft.start)}
                          </ThemedText>
                        </View>
                      </Animated.View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          {/* 拖拽落点：目标列高亮 + 目标时刻指示线（成熟日历都这么给反馈） */}
          {hoverColumnRect && hover ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  styles.hoverColumn,
                  {
                    left: GUTTER_WIDTH + hoverColumnRect.left,
                    width: hoverColumnRect.width,
                    backgroundColor: theme.backgroundSelected,
                  },
                ]}
              />
              <View style={[styles.hoverLine, { top: hoverColumnRect.top }]} pointerEvents="none">
                <View style={[styles.hoverGutter, { backgroundColor: theme.text }]}>
                  <ThemedText type="small" style={[styles.hoverTime, { color: theme.background }]}>
                    {formatMinutes(hover.minutes)}
                  </ThemedText>
                </View>
                <View style={[styles.hoverBar, { backgroundColor: theme.text }]} />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

interface WeekBlockProps {
  task: Task;
  top: number;
  height: number;
  column: number;
  /** 同刻并发时排第几条道（0 起）/ 共几条道 */
  lane: number;
  lanes: number;
  colWidth: number;
  colWidthSV: SharedValue<number>;
  startMinutes: number;
  width: number;
  days: Date[];
  onSelect: (task: Task) => void;
  onPlace?: (task: Task, date: Date, minutesOfDay: number) => Promise<void> | void;
  onHover: (hover: { column: number; minutes: number } | null) => void;
  onDraggingChange: (dragging: boolean) => void;
  dragFlag?: SharedValue<number>;
}

/**
 * 周视图里的一个任务块。
 *
 * 位置由"数据算出来的 top"决定，拖拽位移用 transform 叠加 ——
 * 松手落库后 top 已经是新值，把 transform 归零两次变化互相抵消，视觉上纹丝不动。
 */
function WeekBlock({
  task,
  top,
  height,
  column,
  lane,
  lanes,
  colWidth,
  colWidthSV,
  startMinutes,
  width,
  days,
  onSelect,
  onPlace,
  onHover,
  onDraggingChange,
  dragFlag,
}: WeekBlockProps) {
  const theme = useTheme();

  /** 完成 / 已经过去 —— 灰掉，并且不给拖 */
  const state = taskDisplayState(task);
  const done = state === 'done';
  const muted = isMuted(state);

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** worklet 里读不到 JS 变量，原始坐标也放进 shared value */
  const originMinutes = useSharedValue(startMinutes);
  const originColumn = useSharedValue(column);
  const lastMinutes = useSharedValue(startMinutes);
  const lastColumn = useSharedValue(column);

  const [pickedUp, setPickedUp] = useState(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    originMinutes.value = startMinutes;
    originColumn.value = column;
    lastMinutes.value = startMinutes;
    lastColumn.value = column;
    dragX.value = 0;
    dragY.value = 0;
  }, [column, dragX, dragY, lastColumn, lastMinutes, originColumn, originMinutes, startMinutes]);

  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
      if (dragFlag) dragFlag.value = 0;
    },
    [dragFlag],
  );

  const pickUp = useCallback(() => {
    setPickedUp(true);
    onDraggingChange(true);
    if (dragFlag) dragFlag.value = 1;
  }, [dragFlag, onDraggingChange]);

  const reportHover = useCallback(
    (next: { column: number; minutes: number }) => onHover(next),
    [onHover],
  );

  const commit = useCallback(
    (minutes: number, nextColumn: number) => {
      const changed = minutes !== originMinutes.value || nextColumn !== originColumn.value;
      // 先把块对齐到刻度/目标列，再落库，避免"松手先弹回原位再跳过去"
      dragY.value = ((minutes - originMinutes.value) / 60) * HOUR_HEIGHT;
      dragX.value = (nextColumn - originColumn.value) * colWidthSV.value;
      setPickedUp(false);
      onHover(null);
      onDraggingChange(false);
      if (dragFlag) dragFlag.value = 0;

      if (!changed || !onPlace) {
        dragX.value = 0;
        dragY.value = 0;
        return;
      }
      void Promise.resolve(onPlace(task, days[nextColumn], minutes)).finally(() => {
        // 正常情况数据已落、位置已更新，归零无跳变；写库失败也让块回到原位
        if (safety.current) clearTimeout(safety.current);
        safety.current = setTimeout(() => {
          dragX.value = 0;
          dragY.value = 0;
        }, 400);
      });
    },
    [colWidthSV, days, dragFlag, dragX, dragY, onDraggingChange, onHover, onPlace, originColumn, originMinutes, task],
  );

  const cancel = useCallback(() => {
    setPickedUp(false);
    onHover(null);
    onDraggingChange(false);
    if (dragFlag) dragFlag.value = 0;
  }, [dragFlag, onDraggingChange, onHover]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // 已完成的不给拖：那天已经过去了，挪它没有意义
        .enabled(!done)
        .activateAfterLongPress(PICK_UP_DELAY)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          runOnJS(pickUp)();
        })
        .onUpdate((event) => {
          'worklet';
          dragY.value = event.translationY;
          const step = colWidthSV.value > 0 ? colWidthSV.value : 44;
          const nextColumn = clampColumn(originColumn.value + Math.round(event.translationX / step));
          dragX.value = (nextColumn - originColumn.value) * step;
          const minutes = clampMinutes(originMinutes.value + (event.translationY / HOUR_HEIGHT) * 60);

          if (minutes !== lastMinutes.value || nextColumn !== lastColumn.value) {
            lastMinutes.value = minutes;
            lastColumn.value = nextColumn;
            runOnJS(reportHover)({ column: nextColumn, minutes });
          }
        })
        .onEnd((event) => {
          'worklet';
          const step = colWidthSV.value > 0 ? colWidthSV.value : 44;
          const nextColumn = clampColumn(originColumn.value + Math.round(event.translationX / step));
          const minutes = clampMinutes(originMinutes.value + (event.translationY / HOUR_HEIGHT) * 60);
          runOnJS(commit)(minutes, nextColumn);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(cancel)();
        }),
    [cancel, colWidthSV, commit, done, dragX, dragY, lastColumn, lastMinutes, originColumn, originMinutes, pickUp, reportHover],
  );

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  const isDeadline = task.time.attribute === 'deadline';
  const showTime = width >= TIME_LABEL_MIN_WIDTH;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.block,
          blockStyle,
          {
            top,
            height,
            left: `${(lane / lanes) * 100}%`,
            width: `${100 / lanes}%`,
            zIndex: pickedUp ? 12 : 1,
            opacity: muted ? (done ? 0.5 : 0.72) : 1,
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={task.title}
          onPress={() => onSelect(task)}
          style={[
            styles.blockInner,
            {
              backgroundColor: pickedUp ? theme.background : theme.backgroundSelected,
              borderLeftColor: done || isDeadline ? theme.textSecondary : theme.text,
            },
            pickedUp ? styles.lifted : null,
          ]}>
          <ThemedText
            type="small"
            style={[styles.blockTitle, done ? styles.struck : null]}
            numberOfLines={height > 46 ? 2 : 1}>
            {task.title}
          </ThemedText>
          {showTime ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.blockTime}>
              {formatMinutes(startMinutes)}
            </ThemedText>
          ) : null}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Spacing.three, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingRight: Spacing.half,
    paddingTop: Spacing.two,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  weekday: { fontSize: 10, lineHeight: 13 },
  dayBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  countDot: { height: 5, justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  scroll: { maxHeight: 460 },
  timeline: { position: 'relative' },
  hourLabelRow: { position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT },
  hourLabel: { fontSize: 10, lineHeight: 12, textAlign: 'right', paddingRight: 4 },
  columns: { flex: 1, flexDirection: 'row' },
  column: { flex: 1, position: 'relative' },
  /** 空白层：铺满本列，只挂长按拖动手势（不画任何东西） */
  createLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  /** 拖动中还没落定的那一段：整列宽 + 半透明 */
  draftBlock: { left: 0, right: 0, opacity: 0.6 },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  nowLine: { position: 'absolute', left: 0, right: 0 },
  nowBar: { height: 1.5 },
  /** 左右各让出一点，同刻并排的两块才不糊成一片 */
  block: { position: 'absolute', paddingLeft: 1, paddingRight: 2 },
  /** 课的背景带：虚线、不可点 —— 和"实心块 = 任务"区分开 */
  courseBand: {
    position: 'absolute',
    left: 1,
    right: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 4,
    opacity: 0.5,
  },
  blockInner: {
    flex: 1,
    borderRadius: 4,
    borderLeftWidth: 3,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  lifted: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  blockTitle: { fontSize: 10, lineHeight: 13 },
  struck: { textDecorationLine: 'line-through' },
  blockTime: { fontSize: 9, lineHeight: 12, marginTop: 'auto' },
  hoverColumn: { position: 'absolute', top: 0, bottom: 0, opacity: 0.5 },
  hoverLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  hoverGutter: {
    width: GUTTER_WIDTH - 4,
    borderRadius: 3,
    paddingVertical: 1,
    alignItems: 'center',
  },
  hoverTime: { fontSize: 10, lineHeight: 13, fontWeight: '600' },
  hoverBar: { flex: 1, height: 1.5 },
});
