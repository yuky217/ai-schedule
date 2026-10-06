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
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { formatTime } from '@/utils/datetime';

/**
 * 日视图：纵向小时刻度 + 任务块。
 *
 * 只画 5:00 - 24:00 —— 凌晨的任务极少，全画出来只会让白天被压扁成一条缝。
 * 落在刻度外的任务会钳到顶/底并保持可点，不会凭空消失。
 *
 * 重叠处理：同一时段的任务按"簇"平均分列（2 件就各占一半宽），
 * 不做更聪明的时间轴排布 —— 个人日程里一天同刻超过 3 件本来就不正常，
 * 与其写复杂算法，不如让用户一眼看全。
 *
 * 改时刻：**长按块拾起**（有触感反馈）→ 上下拖 → 吸到 15 分钟刻度 →
 * 松手落库。之前这里长按是"勾选完成"，跟"想拖动"是同一个手势，必然误触；
 * 现在长按只做拾起，完成只能点块上的圆圈。
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
  onSelectTask: (task: Task) => void;
  onCompleteTask?: (task: Task) => void;
  /** 拖动改时刻（当天第几分钟）。返回 Promise 时会被 await，等数据落库后再收尾 */
  onRetime?: (task: Task, minutesOfDay: number) => Promise<void> | void;
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
}

export function CalendarDay({
  date,
  tasks,
  onSelectTask,
  onCompleteTask,
  onRetime,
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
    const result: Block[] = [];
    let cluster: Task[] = [];
    let clusterEnd = -1;

    const flush = () => {
      cluster.forEach((task, index) => {
        const start = minutesOfDay(task.time.startAt!);
        result.push({
          task,
          top: Math.max(0, topForMinutes(start)),
          height: Math.max(MIN_BLOCK_HEIGHT, (DEFAULT_BLOCK_MINUTES / 60) * HOUR_HEIGHT),
          column: index,
          columns: cluster.length,
        });
      });
      cluster = [];
      clusterEnd = -1;
    };

    for (const task of timed) {
      const start = minutesOfDay(task.time.startAt!);
      if (cluster.length && start >= clusterEnd) flush();
      cluster.push(task);
      clusterEnd = Math.max(clusterEnd, start + DEFAULT_BLOCK_MINUTES);
    }
    flush();
    return result;
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
            {deadlines.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => onSelectTask(task)}
                style={[styles.deadline, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="alarm-outline" size={12} color={theme.textSecondary} />
                <ThemedText type="small" numberOfLines={1} style={styles.deadlineText}>
                  {task.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatTime(task.time.dueAt)}
                </ThemedText>
              </Pressable>
            ))}
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

          {/* 任务块 */}
          <View style={[styles.blocks, { left: GUTTER_WIDTH, right: Spacing.two }]}>
            {blocks.map((block) => (
              <TimedBlock
                key={block.task.id}
                {...block}
                onSelect={onSelectTask}
                onComplete={onCompleteTask}
                onRetime={onRetime}
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

      {!timed.length && !deadlines.length ? (
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
  onDraggingChange: (dragging: boolean) => void;
}

function TimedBlock({
  task,
  top,
  height,
  column,
  columns,
  onSelect,
  onComplete,
  onRetime,
  onDraggingChange,
}: TimedBlockProps) {
  const theme = useTheme();
  const baseMinutes = minutesOfDay(task.time.startAt!);

  /** 拖动位移（UI 线程） */
  const dragY = useSharedValue(0);
  /** 原始分钟数也放进 shared value：worklet 里读不到 JS 的变量 */
  const origin = useSharedValue(baseMinutes);
  const lastSnap = useSharedValue(baseMinutes);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pickedUp, setPickedUp] = useState(false);
  const [target, setTarget] = useState<number | null>(null);

  /**
   * 数据落库后回到零位移。
   * 拖拽中对块施加的 translateY 与"落库后 top 的变化量"是同一个值，
   * 所以把位移归零、top 变成新位置，两件事互相抵消 —— 视觉上纹丝不动。
   */
  useEffect(() => {
    origin.value = baseMinutes;
    dragY.value = 0;
    lastSnap.value = baseMinutes;
  }, [baseMinutes, dragY, lastSnap, origin]);

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

  const cancel = useCallback(() => {
    setPickedUp(false);
    setTarget(null);
    onDraggingChange(false);
  }, [onDraggingChange]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
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
    [cancel, commit, dragY, lastSnap, origin, pickUp, updateTarget],
  );

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const isDeadline = task.time.attribute === 'deadline';
  const widthPct = 100 / columns;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.block,
          blockStyle,
          {
            top,
            height,
            left: `${column * widthPct}%`,
            width: `${widthPct}%`,
            zIndex: pickedUp ? 10 : 1,
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
              { backgroundColor: isDeadline ? theme.textSecondary : theme.text },
            ]}
          />
          <View style={styles.blockBody}>
            <ThemedText type="small" numberOfLines={2}>
              {task.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.blockTime}>
              {formatMinutes(baseMinutes)}
            </ThemedText>
          </View>
          {onComplete ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="标记为完成"
              onPress={() => onComplete(task)}
              style={[styles.blockCheck, { borderColor: theme.textSecondary }]}>
              <Ionicons name="checkmark" size={13} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </Pressable>

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
  block: { position: 'absolute' },
  blockInner: { flex: 1, flexDirection: 'row', borderRadius: Spacing.two, overflow: 'hidden' },
  blockBar: { width: 3 },
  lifted: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },  blockBody: { flex: 1, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  blockTime: { fontSize: 11, lineHeight: 15 },
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
    top: 0,
    width: GUTTER_WIDTH - 12,
    borderRadius: Spacing.one,
    paddingVertical: 1,
    alignItems: 'center',
  },
  targetText: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
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
