import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { isSameDay, format } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CourseSlot } from '@/domain/course';
import { layoutLanes } from '@/domain/lane-layout';
import { isMuted, taskDisplayState } from '@/domain/task-state';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { describeDue, formatTime } from '@/utils/datetime';

/**
 * 日视图：纵向小时刻度 + 任务块。
 *
 * 只画 5:00 - 24:00 —— 凌晨的任务极少，全画出来只会让白天被压扁成一条缝。
 * 落在刻度外的任务会钳到顶/底并保持可点，不会凭空消失。
 *
 * 重叠处理：同一时段的任务按"簇"分道（2 件就各占一半宽），算法在
 * `domain/lane-layout`（课表、周视图共用同一份）。不做更聪明的时间轴排布 ——
 * 个人日程里一天同刻超过 3 件本来就不正常，与其写复杂算法，不如让用户一眼看全。
 *
 * **课是背景，不是日程**：有课的那段画一条虚线的带子，压在最底下、点不动、
 * 也不参与分道 —— "这段时间有课"要看得见，但课不该跟任务抢位置，
 * 更不该被当成一件"要完成的事"。
 *
 * 改时刻：**长按块拾起**（有触感反馈）→ 上下拖 → 吸到 15 分钟刻度 →
 * 松手落库。之前这里长按是"勾选完成"，跟"想拖动"是同一个手势，必然误触；
 * 现在长按只做拾起，完成只能点块上的圆圈。
 *
 * 完成态：已经做完的事**照样画出来**（灰掉、划掉、不给拖）——
 * 日历回答的是"这段时间发生过什么"，不是"还剩什么没做"。
 * 过了时间的固定型（上周的会）同样弱化，但它不会自动变成完成。
 */

const START_HOUR = 5;
const END_HOUR = 24;
const HOUR_HEIGHT = 56;
const MIN_BLOCK_HEIGHT = 46;
/** 没给结束时长的任务块按半小时画 */
const DEFAULT_BLOCK_MINUTES = 30;
const GUTTER_WIDTH = 52;
/** 拖动吸附粒度（分钟） */
const SNAP_MINUTES = 15;
/** 最晚只能拖到 23:45 —— 再往下就没有下一个刻度了，不用挤出个 23:59 这种怪时间 */
const LAST_SLOT_MINUTES = 23 * 60 + 45;
/** 长按多久进入拾起状态 */
const PICK_UP_DELAY = 200;

export interface CalendarDayProps {
  date: Date;
  /** 当天全部任务（有 time 的） */
  tasks: Task[];
  /** 当天的课（背景带）：只说"这段时间有课"，不占日程、不可点 */
  courseSlots?: readonly CourseSlot[];
  onSelectTask: (task: Task) => void;
  onCompleteTask?: (task: Task) => void;
  /** 拖动改时刻（当天第几分钟）。返回 Promise 时会被 await，等数据落库后再收尾 */
  onRetime?: (task: Task, minutesOfDay: number) => Promise<void> | void;
  /** 拽上下边改时段（始末两个刻度）。返回 Promise 时会被 await */
  onResize?: (task: Task, startMinutes: number, endMinutes: number) => Promise<void> | void;
  /** 拖拽开始 / 结束：父层用它临时关掉页面滚动 */
  onDraggingChange?: (dragging: boolean) => void;
}

const minutesOfDay = (iso: string): number => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

const topForMinutes = (minutes: number): number =>
  ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

const snap = (minutes: number): number => {
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(LAST_SLOT_MINUTES, snapped));
};

const formatMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

interface Block {
  task: Task;
  top: number;
  height: number;
  column: number;
  columns: number;
  /** 块的始末（当天分钟数）—— 边缘拖拽要在这两个数上做文章 */
  start: number;
  end: number;
}

/** 块的结束分钟：有 endAt 用 endAt（跨天结束画到当天末尾），没有按半小时 */
const endMinutesOf = (task: Task, start: number): number => {
  if (task.time.endAt) {
    const d = new Date(task.time.endAt);
    if (!Number.isNaN(d.getTime())) {
      if (!isSameDay(d, new Date(task.time.startAt!))) return END_HOUR * 60;
      return Math.max(start + SNAP_MINUTES, d.getHours() * 60 + d.getMinutes());
    }
  }
  return start + DEFAULT_BLOCK_MINUTES;
};

export function CalendarDay({
  date,
  tasks,
  courseSlots,
  onSelectTask,
  onCompleteTask,
  onRetime,
  onResize,
  onDraggingChange,
}: CalendarDayProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [dragging, setDragging] = useState(false);

  const setDraggingState = useCallback(
    (next: boolean) => {
      setDragging(next);
      onDraggingChange?.(next);
    },
    [onDraggingChange],
  );

  /** 有具体开始时刻的（画在时间轴上） */
  const timed = useMemo(
    () =>
      tasks
        .filter((t) => t.time.startAt && isSameDay(new Date(t.time.startAt), date))
        .sort((a, b) => (a.time.startAt ?? '').localeCompare(b.time.startAt ?? '')),
    [tasks, date],
  );

  /** 只有截止、没有开始时刻的（放在顶部"截止"区） */
  const deadlines = useMemo(() => tasks.filter((t) => !t.time.startAt && t.time.dueAt), [tasks]);

  const blocks = useMemo<Block[]>(() => {
    const spans = timed.map((task) => {
      const start = minutesOfDay(task.time.startAt!);
      return { task, start, end: endMinutesOf(task, start) };
    });
    // 分道算法与课表 / 周视图共用一份：同刻多件事必须并排，不能互相盖住
    return layoutLanes(spans, (a, b) => a.start - b.start || a.end - b.end).map(
      ({ item, lane, lanes }) => ({
        task: item.task,
        start: item.start,
        end: item.end,
        top: Math.max(0, topForMinutes(item.start)),
        height: Math.max(MIN_BLOCK_HEIGHT, ((item.end - item.start) / 60) * HOUR_HEIGHT),
        column: lane,
        columns: lanes,
      }),
    );
  }, [timed]);

  const now = new Date();
  const isToday = isSameDay(date, now);
  const nowTop = isToday ? topForMinutes(now.getHours() * 60 + now.getMinutes()) : null;
  const today = isToday ? now : null;

  /** 打开时滚到"现在"附近（非今天则滚到 8:00），避免一进来盯着空白 */
  useEffect(() => {
    const target = isToday ? Math.max(0, nowTop! - HOUR_HEIGHT) : topForMinutes(8 * 60);
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: target, animated: false }), 0);
    return () => clearTimeout(timer);
    // 只在切换日期时重新定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format(date, 'yyyy-MM-dd')]);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const timelineHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      {deadlines.length ? (
        <View style={[styles.deadlineBar, { borderBottomColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary">
            截止
          </ThemedText>
          <View style={styles.deadlineItems}>
            {deadlines.map((task) => {
              const state = taskDisplayState(task, now);
              const done = state === 'done';
              // 截止型过期 = 欠着，值得显眼一点；把"已过期 3 天"直接说出来
              const overdue = state === 'overdue';
              return (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  onPress={() => onSelectTask(task)}
                  style={[
                    styles.deadline,
                    { backgroundColor: theme.backgroundSelected, opacity: done ? 0.5 : 1 },
                  ]}>
                  <Ionicons
                    name={overdue ? 'alert-circle-outline' : 'alarm-outline'}
                    size={12}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    type="small"
                    numberOfLines={1}
                    style={[styles.deadlineText, done ? styles.struck : undefined]}>
                    {task.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {overdue ? describeDue(task.time.dueAt, now) : formatTime(task.time.dueAt)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        // 拖拽期间锁住滚动，否则手指竖直移动会被滚动抢走
        scrollEnabled={!dragging}
        style={styles.scroll}>
        <View style={{ height: timelineHeight }}>
          {/* 小时刻度线 */}
          {hours.map((hour, index) => (
            <View key={hour} style={[styles.hourRow, { top: index * HOUR_HEIGHT }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.hourLabel}>
                {String(hour).padStart(2, '0')}:00
              </ThemedText>
              <View style={[styles.hourLine, { backgroundColor: theme.backgroundSelected }]} />
            </View>
          ))}

          {/* 任务块（课是它下面的背景带，见上面的注释） */}
          <View style={[styles.blocks, { left: GUTTER_WIDTH, right: Spacing.two }]}>
            {courseSlots?.map((slot, index) => {
              const top = Math.max(0, topForMinutes(slot.start));
              const height = Math.max(26, ((slot.end - slot.start) / 60) * HOUR_HEIGHT);
              const place = slot.session.location ?? slot.course.location;
              return (
                <View
                  key={`course-${slot.course.id}-${index}`}
                  pointerEvents="none"
                  style={[
                    styles.courseBand,
                    {
                      top,
                      height,
                      borderColor: theme.textSecondary,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    style={styles.courseBandText}>
                    {slot.course.title}
                    {place && height > 40 ? ` · ${place}` : ''}
                  </ThemedText>
                </View>
              );
            })}
            {blocks.map((block) => (
              <TimedBlock
                key={block.task.id}
                {...block}
                onSelect={onSelectTask}
                onComplete={onCompleteTask}
                onRetime={onRetime}
                onResize={onResize}
                onDraggingChange={setDraggingState}
              />
            ))}
          </View>

          {/* 当前时间线 */}
          {nowTop !== null && nowTop >= 0 && nowTop <= timelineHeight ? (
            <View style={[styles.nowLine, { top: nowTop }]} pointerEvents="none">
              <View style={[styles.nowDot, { backgroundColor: theme.text }]} />
              <View style={[styles.nowBar, { backgroundColor: theme.text }]} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {!timed.length && !deadlines.length && !courseSlots?.length ? (
        <View style={styles.empty} pointerEvents="none">
          <ThemedText type="small" themeColor="textSecondary">
            {today ? '今天还没有安排' : '这一天没有安排'}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

interface TimedBlockProps extends Block {
  onSelect: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onRetime?: (task: Task, minutesOfDay: number) => Promise<void> | void;
  onResize?: (task: Task, startMinutes: number, endMinutes: number) => Promise<void> | void;
  onDraggingChange: (dragging: boolean) => void;
}

/** 边缘拖拽允许的最小时长（分钟）：再短就捏没了 */
const MIN_SPAN_MINUTES = 30;

function TimedBlock({
  task,
  top,
  height,
  start,
  end,
  column,
  columns,
  onSelect,
  onComplete,
  onRetime,
  onResize,
  onDraggingChange,
}: TimedBlockProps) {
  const theme = useTheme();

  /** 完成 / 已经过去 —— 决定这块是"灰掉"还是"正常" */
  const state = taskDisplayState(task);
  const done = state === 'done';
  const muted = isMuted(state);

  /** 拖动位移（UI 线程） */
  const dragY = useSharedValue(0);
  /** 原始分钟数也放进 shared value：worklet 里读不到 JS 的变量 */
  const origin = useSharedValue(start);
  const lastSnap = useSharedValue(start);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pickedUp, setPickedUp] = useState(false);
  const [target, setTarget] = useState<number | null>(null);

  /* ---------------- 边缘调整：拽上边改开始、拽下边改结束 ---------------- */

  const startOrigin = useSharedValue(start);
  const endOrigin = useSharedValue(end);
  const lastEdgeSnap = useSharedValue(0);
  /** 拖边过程中的上/下边缘位移（px），松手落库后归零 */
  const edgeTopPx = useSharedValue(0);
  const edgeBottomPx = useSharedValue(0);
  const [resizing, setResizing] = useState<'top' | 'bottom' | null>(null);
  const [edgeTarget, setEdgeTarget] = useState<number | null>(null);

  /**
   * 数据落库后回到零位移。拖边施加的位移与"落库后 top/height 的变化量"是同一个值，
   * 归零与属性更新互相抵消 —— 视觉上纹丝不动。
   */
  useEffect(() => {
    origin.value = start;
    endOrigin.value = end;
    dragY.value = 0;
    lastSnap.value = start;
    edgeTopPx.value = 0;
    edgeBottomPx.value = 0;
  }, [start, end, dragY, lastSnap, origin, endOrigin, edgeTopPx, edgeBottomPx]);

  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const pickUp = useCallback(() => {
    setPickedUp(true);
    onDraggingChange(true);
    setTarget(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [onDraggingChange]);

  const updateTarget = useCallback((minutes: number) => setTarget(minutes), []);
  const updateEdgeTarget = useCallback((minutes: number) => setEdgeTarget(minutes), []);
  const beginResize = useCallback(
    (edge: 'top' | 'bottom') => {
      setResizing(edge);
      onDraggingChange(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    },
    [onDraggingChange],
  );
  const finishResize = useCallback(() => {
    setResizing(null);
    setEdgeTarget(null);
    onDraggingChange(false);
  }, [onDraggingChange]);

  /** 边缘松手：把始末两个刻度写回去（px 先对齐刻度，落库后归零无跳变） */
  const commitResize = useCallback(() => {
    const nextStart = Math.round(
      startOrigin.value + (edgeTopPx.value / HOUR_HEIGHT) * 60,
    );
    const nextEnd = Math.round(endOrigin.value + (edgeBottomPx.value / HOUR_HEIGHT) * 60);
    const changed = nextStart !== startOrigin.value || nextEnd !== endOrigin.value;
    setResizing(null);
    setEdgeTarget(null);
    onDraggingChange(false);
    if (!changed || !onResize) {
      edgeTopPx.value = 0;
      edgeBottomPx.value = 0;
      return;
    }
    void Promise.resolve(onResize(task, nextStart, nextEnd)).finally(() => {
      // 写库失败也要让块弹回原样，不能停在半路
      if (safety.current) clearTimeout(safety.current);
      safety.current = setTimeout(() => {
        edgeTopPx.value = 0;
        edgeBottomPx.value = 0;
      }, 400);
    });
  }, [edgeBottomPx, edgeTopPx, endOrigin, onDraggingChange, onResize, startOrigin, task]);

  /** 点一下上边 = 开始提前一刻（拉长）；下边 = 结束推后一刻。缩小靠拖 */
  const nudgeEdge = useCallback(
    (edge: 'top' | 'bottom') => {
      if (!onResize || done) return;
      if (edge === 'top') {
        const next = Math.max(0, Math.min(endOrigin.value - MIN_SPAN_MINUTES, snap(startOrigin.value - SNAP_MINUTES)));
        if (next === startOrigin.value) return;
        edgeTopPx.value = ((next - startOrigin.value) / 60) * HOUR_HEIGHT;
      } else {
        const next = Math.min(LAST_SLOT_MINUTES, Math.max(startOrigin.value + MIN_SPAN_MINUTES, snap(endOrigin.value + SNAP_MINUTES)));
        if (next === endOrigin.value) return;
        edgeBottomPx.value = ((next - endOrigin.value) / 60) * HOUR_HEIGHT;
      }
      commitResize();
    },
    [commitResize, done, edgeBottomPx, edgeTopPx, endOrigin, onResize, startOrigin],
  );

  const cancel = useCallback(() => {
    setPickedUp(false);
    setTarget(null);
    onDraggingChange(false);
  }, [onDraggingChange]);

  /** 拖整块松手：只写开始时刻，时长由 buildPlacedTime 按原 endAt 平移保留 */
  const commit = useCallback(
    (minutes: number) => {
      const next = snap(minutes);
      const changed = next !== origin.value;
      // 先对到刻度上（纯赋值，不起动画，避免和数据落地时的归零打架）
      dragY.value = changed ? ((next - origin.value) / 60) * HOUR_HEIGHT : 0;
      setTarget(null);
      setPickedUp(false);
      onDraggingChange(false);
      if (!changed || !onRetime) {
        dragY.value = 0;
        return;
      }
      void Promise.resolve(onRetime(task, next)).finally(() => {
        // 正常情况数据已落、top 已更新，归零无跳变；
        // 万一写库失败，也让块回到原位，不要停在半路。
        if (safety.current) clearTimeout(safety.current);
        safety.current = setTimeout(() => {
          dragY.value = 0;
        }, 400);
      });
    },
    [dragY, onDraggingChange, onRetime, origin, task],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // 已完成的不给拖：那天已经过去了，挪它没有意义
        .enabled(!done)
        .activateAfterLongPress(PICK_UP_DELAY)
        // 横向留给页面翻页，这个手势只认竖直
        .failOffsetX([-16, 16])
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          runOnJS(pickUp)();
        })
        .onUpdate((event) => {
          'worklet';
          dragY.value = event.translationY;
          const minutes = snap(
            origin.value + (event.translationY / HOUR_HEIGHT) * 60,
          );
          if (minutes !== lastSnap.value) {
            lastSnap.value = minutes;
            runOnJS(updateTarget)(minutes);
          }
        })
        .onEnd((event) => {
          'worklet';
          runOnJS(commit)(origin.value + (event.translationY / HOUR_HEIGHT) * 60);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(cancel)();
        }),
    [cancel, commit, done, dragY, lastSnap, origin, pickUp, updateTarget],
  );

  /** 上边缘：按住即拖（不用长按 —— 边缘本身就是明确的"我要调时间"意图） */
  const topEdgeGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pan()
          .enabled(!done && !!onResize)
          .failOffsetX([-16, 16])
          .onStart(() => {
            'worklet';
            lastEdgeSnap.value = startOrigin.value;
            runOnJS(beginResize)('top');
          })
          .onUpdate((event) => {
            'worklet';
            const next = Math.max(
              0,
              Math.min(
                endOrigin.value - MIN_SPAN_MINUTES,
                snap(startOrigin.value + (event.translationY / HOUR_HEIGHT) * 60),
              ),
            );
            edgeTopPx.value = ((next - startOrigin.value) / 60) * HOUR_HEIGHT;
            if (next !== lastEdgeSnap.value) {
              lastEdgeSnap.value = next;
              runOnJS(updateEdgeTarget)(next);
            }
          })
          .onEnd(() => {
            'worklet';
            runOnJS(commitResize)();
          })
          .onFinalize(() => {
            'worklet';
            runOnJS(finishResize)();
          }),
        Gesture.Tap()
          .enabled(!done && !!onResize)
          .onStart(() => {
            'worklet';
            runOnJS(nudgeEdge)('top');
          }),
      ),
    [
      beginResize,
      commitResize,
      done,
      edgeTopPx,
      endOrigin,
      finishResize,
      lastEdgeSnap,
      nudgeEdge,
      onResize,
      startOrigin,
      updateEdgeTarget,
    ],
  );

  const bottomEdgeGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pan()
          .enabled(!done && !!onResize)
          .failOffsetX([-16, 16])
          .onStart(() => {
            'worklet';
            lastEdgeSnap.value = endOrigin.value;
            runOnJS(beginResize)('bottom');
          })
          .onUpdate((event) => {
            'worklet';
            const next = Math.min(
              LAST_SLOT_MINUTES,
              Math.max(
                startOrigin.value + MIN_SPAN_MINUTES,
                snap(endOrigin.value + (event.translationY / HOUR_HEIGHT) * 60),
              ),
            );
            edgeBottomPx.value = ((next - endOrigin.value) / 60) * HOUR_HEIGHT;
            if (next !== lastEdgeSnap.value) {
              lastEdgeSnap.value = next;
              runOnJS(updateEdgeTarget)(next);
            }
          })
          .onEnd(() => {
            'worklet';
            runOnJS(commitResize)();
          })
          .onFinalize(() => {
            'worklet';
            runOnJS(finishResize)();
          }),
        Gesture.Tap()
          .enabled(!done && !!onResize)
          .onStart(() => {
            'worklet';
            runOnJS(nudgeEdge)('bottom');
          }),
      ),
    [
      beginResize,
      commitResize,
      done,
      edgeBottomPx,
      endOrigin,
      finishResize,
      lastEdgeSnap,
      nudgeEdge,
      onResize,
      startOrigin,
      updateEdgeTarget,
    ],
  );

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  /** 拖边时块的顶边/高度跟着边界走（落库后属性更新、位移归零，互相抵消） */
  const edgeStyle = useAnimatedStyle(() => ({
    top: top + edgeTopPx.value,
    height: height + edgeBottomPx.value - edgeTopPx.value,
  }));

  const isDeadline = task.time.attribute === 'deadline';
  const widthPct = 100 / columns;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.block,
          blockStyle,
          edgeStyle,
          {
            left: `${column * widthPct}%`,
            width: `${widthPct}%`,
            zIndex: pickedUp || resizing ? 10 : 1,
            // 完成的和已经过去的都退到背景里，让"还没做的"自己跳出来
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
            },
            pickedUp ? styles.lifted : null,
          ]}>
          <View
            style={[
              styles.blockBar,
              { backgroundColor: done || isDeadline ? theme.textSecondary : theme.text },
            ]}
          />
          <View style={styles.blockBody}>
            <ThemedText type="small" numberOfLines={2} style={done ? styles.struck : undefined}>
              {task.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.blockTime}>
              {formatMinutes(start)}–{formatMinutes(end)}
            </ThemedText>
          </View>
          {/* 勾选圈是开关（2026-10-08）：没做的点一下完成，点错了再点一下就回来 ——
              误点完成就地可撤销，不必进详情页 */}
          {onComplete ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={done ? '标记为未完成' : '标记为完成'}
              onPress={() => onComplete(task)}
              style={[
                styles.blockCheck,
                {
                  borderColor: done ? theme.textSecondary : theme.textSecondary,
                  backgroundColor: done ? theme.textSecondary : 'transparent',
                },
              ]}>
              {done ? <Ionicons name="checkmark" size={13} color={theme.backgroundElement} /> : null}
            </Pressable>
          ) : null}
        </Pressable>

        {/* 上下边缘：拽 = 改始末（跟手），点一下 = 拉长一刻钟 */}
        <GestureDetector gesture={topEdgeGesture}>
          <Animated.View
            accessibilityRole="adjustable"
            accessibilityLabel="调整开始时间"
            style={[styles.edgeHandle, styles.edgeTop]}
          />
        </GestureDetector>
        <GestureDetector gesture={bottomEdgeGesture}>
          <Animated.View
            accessibilityRole="adjustable"
            accessibilityLabel="调整结束时间"
            style={[styles.edgeHandle, styles.edgeBottom]}
          />
        </GestureDetector>

        {/* 拖拽时在左侧刻度栏显示目标时刻 */}
        {target !== null ? (
          <View
            pointerEvents="none"
            style={[styles.targetBadge, { backgroundColor: theme.text }]}>
            <ThemedText type="small" style={[styles.targetText, { color: theme.background }]}>
              {formatMinutes(target)}
            </ThemedText>
          </View>
        ) : null}
        {edgeTarget !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.targetBadge,
              resizing === 'bottom' ? styles.targetBottom : styles.targetTop,
              { backgroundColor: theme.text },
            ]}>
            <ThemedText type="small" style={[styles.targetText, { color: theme.background }]}>
              {formatMinutes(edgeTarget)}
            </ThemedText>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Spacing.three, overflow: 'hidden' },
  deadlineBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deadlineItems: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    maxWidth: '100%',
  },
  deadlineText: { flexShrink: 1 },
  scroll: { maxHeight: 420 },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  hourLabel: { width: GUTTER_WIDTH, textAlign: 'center', fontSize: 11 },
  hourLine: { flex: 1, height: StyleSheet.hairlineWidth },
  blocks: { position: 'absolute', top: 0, bottom: 0 },
  /**
   * 课的背景带：虚线、透明底、不显眼 —— 一眼就知道"这段被占着"，
   * 但绝不会被误认成一件待办（实心块 = 任务，这是全 App 的约定）。
   */
  courseBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Spacing.two,
    opacity: 0.55,
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  courseBandText: { fontSize: 11, lineHeight: 15 },
  block: { position: 'absolute' },
  blockInner: { flex: 1, flexDirection: 'row', borderRadius: Spacing.two, overflow: 'hidden' },
  blockBar: { width: 3 },
  lifted: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  blockBody: { flex: 1, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  blockTime: { fontSize: 11, lineHeight: 15 },
  struck: { textDecorationLine: 'line-through' },
  blockCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginRight: Spacing.one,
  },
  targetBadge: {
    position: 'absolute',
    left: -(GUTTER_WIDTH - 6),
    width: GUTTER_WIDTH - 12,
    borderRadius: Spacing.one,
    paddingVertical: 1,
    alignItems: 'center',
  },
  targetTop: { top: 0 },
  targetBottom: { bottom: 0 },
  targetText: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  // 上下边缘的"把手"：不显形，但按住就能拽（视觉提示交给拖起来的那一刻）
  edgeHandle: { position: 'absolute', left: 0, right: 0, height: 12, zIndex: 20 },
  edgeTop: { top: -6 },
  edgeBottom: { bottom: -6 },
  nowLine: {
    position: 'absolute',
    left: GUTTER_WIDTH - 4,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: { width: 6, height: 6, borderRadius: 3 },
  nowBar: { flex: 1, height: 1 },
  empty: { paddingBottom: Spacing.three, alignItems: 'center' },
});
