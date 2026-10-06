import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { GanttItem, GanttRow } from '@/domain/gantt';
import { canReschedule, describeDayShift, ganttTicks, layoutGantt } from '@/domain/gantt';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/state/settings-store';
import { formatMonthDay } from '@/utils/datetime';

/**
 * 甘特图（主文档 5.3：**甘特图只是视图**）。
 *
 * 布局全部来自 domain/gantt.ts 的纯函数，这里只负责"把比例乘成像素"：
 * - 左侧固定一列名称，右侧是横向可滚动的时间轴 —— 桌面甘特图的经典结构，
 *   跨度一长就靠横滚消化，而不是把条子压成一条线；
 * - 容器条是实心（它是一段周期），任务条是空心（它是一个点或一小段）；
 * - 只有单一时间点的任务画成小圆点，避免"一天 = 一根短线"看起来像跨度；
 * - 今天永远有一条参照线 —— 甘特图没这条线就只剩装饰。
 *
 * 【拖拽改期】
 * 长按任务条 200ms 拾起后横向拖动，松手即改期（整天平移，保留原本的时分）。
 * 手势走 react-native-gesture-handler + reanimated，与日历、收集箱排序同一套思路：
 * `activateAfterLongPress` 让单击照常进详情，长按才进入拖拽，两者不打架。
 *
 * 三个刻意的取舍：
 * 1. **只有任务条能拖**，容器条是框架 —— 理由见 domain/gantt.ts 的 canReschedule。
 * 2. **拖拽中冻住轴、只在松手后写库**：若拖到一半就改数据，轴的范围会跟着变，
 *    整张图会在手指底下重排。所以拖动期间只动位移，落下才提交。
 * 3. **预览文案按"跨过一天"才回一次 JS**，不是每帧 —— 跟手由 UI 线程负责，
 *    JS 只负责把"往后 3 天"这几个字刷新出来。
 */

const LABEL_WIDTH = 88;
const ROW_HEIGHT = 30;
const ROW_GAP = 4;
const AXIS_HEIGHT = 22;
/** 每自然日至少占这么多像素，不够就横向滚动 */
const MIN_DAY_WIDTH = 13;
/** 点标记的直径 */
const POINT_SIZE = 9;
/** 条子高度 */
const BAR_HEIGHT = ROW_HEIGHT - 9;
/** 长按多久才进入拖拽 */
const LONG_PRESS_MS = 200;

export interface GanttChartProps {
  items: GanttItem[];
  onSelect?: (item: GanttItem) => void;
  /** 任务条被拖动落下时触发。days 为整天数，正数往后。 */
  onReschedule?: (item: GanttItem, days: number) => void;
  /** 拖拽开始/结束的通知，供外层锁住页面滚动 */
  onDragStateChange?: (dragging: boolean) => void;
  emptyHint?: string;
}

export function GanttChart({
  items,
  onSelect,
  onReschedule,
  onDragStateChange,
  emptyHint,
}: GanttChartProps) {
  const theme = useTheme();
  const settings = useSettings();
  const [availableWidth, setAvailableWidth] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ label: string; days: number } | null>(null);

  const layout = useMemo(() => layoutGantt(items), [items]);
  const ticks = useMemo(() => ganttTicks(layout), [layout]);

  const contentWidth = Math.max(availableWidth || 0, layout.days * MIN_DAY_WIDTH, 240);

  /** 一天的像素宽，供 worklet 里把位移换算成天数（放在 shared value 里才能被 UI 线程读到） */
  const dayPx = useSharedValue(1);
  useEffect(() => {
    dayPx.value = layout.days > 0 ? contentWidth / layout.days : 1;
  }, [contentWidth, dayPx, layout.days]);

  /** 当前正在拖的那条（worklet 只回传 boolean，具体是谁由这里记住） */
  const idRef = useRef<string | null>(null);

  const handleDraggingChange = useCallback(
    (dragging: boolean) => {
      setDraggingId(dragging ? idRef.current : null);
      if (!dragging) setPreview(null);
      onDragStateChange?.(dragging);
    },
    [onDragStateChange],
  );

  const handlePreview = useCallback((item: GanttItem, days: number) => {
    setPreview(days ? { label: item.label, days } : null);
  }, []);

  if (!items.length) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {emptyHint ?? '还没有带时间的东西，甘特图暂时是空的'}
        </ThemedText>
      </View>
    );
  }

  const dragging = draggingId !== null;
  const reschedulable = Boolean(onReschedule);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundElement }]}
      onLayout={(e) => setAvailableWidth(e.nativeEvent.layout.width - LABEL_WIDTH - Spacing.three * 2)}>
      <View style={styles.body}>
        {/* 左侧：固定的名称列 */}
        <View style={[styles.labelColumn, { width: LABEL_WIDTH }]}>
          <View style={{ height: AXIS_HEIGHT }} />
          {layout.rows.map((row) => (
            <Pressable
              key={row.item.id}
              accessibilityRole="button"
              accessibilityLabel={row.item.label}
              onPress={() => onSelect?.(row.item)}
              style={[styles.labelCell, { height: ROW_HEIGHT + ROW_GAP }]}>
              <ThemedText type="small" numberOfLines={1} style={styles.labelText}>
                {row.item.label}
              </ThemedText>
              {row.item.badge ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.labelBadge}>
                  {row.item.badge}
                </ThemedText>
              ) : null}
            </Pressable>
          ))}
        </View>

        {/* 右侧：横向滚动的时间轴。拖拽期间锁住横滚，否则手指一横就会被滚动抢走 */}
        <ScrollView
          horizontal
          scrollEnabled={!dragging}
          showsHorizontalScrollIndicator={false}
          style={styles.scroll}>
          <View style={{ width: contentWidth }}>
            {/* 刻度 */}
            <View style={[styles.axis, { height: AXIS_HEIGHT }]}>
              {ticks.map((tick) => (
                <View
                  key={tick.date.toISOString()}
                  style={[styles.tick, { left: `${tick.ratio * 100}%` }]}
                  pointerEvents="none">
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tickText}>
                    {tick.label}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={{ position: 'relative' }}>
              {/* 竖网格线 */}
              {ticks.map((tick) => (
                <View
                  key={tick.date.toISOString()}
                  pointerEvents="none"
                  style={[
                    styles.gridLine,
                    {
                      left: `${tick.ratio * 100}%`,
                      top: 0,
                      bottom: 0,
                      backgroundColor: theme.backgroundSelected,
                    },
                  ]}
                />
              ))}

              {layout.rows.map((row) => (
                <GanttBar
                  key={row.item.id}
                  row={row}
                  dayPx={dayPx}
                  draggable={reschedulable && canReschedule(row.item)}
                  dimmed={dragging && draggingId !== row.item.id}
                  haptics={settings.hapticsEnabled}
                  onSelect={onSelect}
                  onDelta={onReschedule}
                  onDraggingChange={handleDraggingChange}
                  onPreview={handlePreview}
                  onIdentify={(id) => {
                    idRef.current = id;
                  }}
                />
              ))}

              {/* 今天线 */}
              {layout.todayRatio !== null ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.todayLine,
                    { left: `${layout.todayRatio * 100}%`, backgroundColor: theme.text },
                  ]}
                />
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>

      {preview ? (
        <ThemedText type="smallBold" style={styles.preview}>
          {`「${preview.label}」${describeDayShift(preview.days)}`}
        </ThemedText>
      ) : null}

      <View style={styles.footnoteRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {`${formatMonthDay(layout.from)} - ${formatMonthDay(layout.to)} · 共 ${layout.days} 天`}
          {layout.todayRatio !== null ? ' · 竖线是今天' : ''}
        </ThemedText>
        {reschedulable ? (
          <View style={styles.hint}>
            <Ionicons name="move-outline" size={12} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
              长按条子可拖动改期
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 单行条子                                                            */
/* ------------------------------------------------------------------ */

interface GanttBarProps {
  row: GanttRow;
  dayPx: SharedValue<number>;
  draggable: boolean;
  dimmed: boolean;
  haptics: boolean;
  onSelect?: (item: GanttItem) => void;
  onDelta?: (item: GanttItem, days: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  onPreview: (item: GanttItem, days: number) => void;
  onIdentify: (id: string) => void;
}

/**
 * 一行条子。拆成独立组件是因为它要持有自己的 shared value 与手势 ——
 * hooks 不能写在循环里，而每一行都必须有独立的位移量。
 */
function GanttBar({
  row,
  dayPx,
  draggable,
  dimmed,
  haptics,
  onSelect,
  onDelta,
  onDraggingChange,
  onPreview,
  onIdentify,
}: GanttBarProps) {
  const theme = useTheme();
  const { item, point, left, width } = row;
  const isContainer = item.kind === 'container';
  const barBackground = isContainer ? theme.text : theme.backgroundSelected;
  const textColor = isContainer ? theme.background : theme.text;
  const baseOpacity = item.done ? 0.45 : 1;

  const dx = useSharedValue(0);
  const active = useSharedValue(0);
  /** 上一次回 JS 的天数，用来把"预览刷新"压到每天一次 */
  const lastDays = useSharedValue(0);

  /** 回调都放进 ref：手势对象要长期稳定，不能因为父组件重渲染而重建（重建会被系统打断） */
  const itemRef = useRef(item);
  itemRef.current = item;
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;
  const onIdentifyRef = useRef(onIdentify);
  onIdentifyRef.current = onIdentify;

  const begin = useCallback(
    (id: string) => {
      onIdentifyRef.current(id);
      onDraggingChangeRef.current(true);
      if (haptics) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    },
    [haptics],
  );

  const preview = useCallback((id: string, days: number) => {
    onPreviewRef.current(itemRef.current, days);
    onIdentifyRef.current(id);
  }, []);

  const commit = useCallback((id: string, days: number) => {
    onDraggingChangeRef.current(false);
    if (days) onDeltaRef.current?.(itemRef.current, days);
  }, []);

  /** 手势被系统打断（来电 / 切后台）时兜底复位，不留半拖状态 */
  const reset = useCallback(() => {
    onDraggingChangeRef.current(false);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(draggable)
        .activateAfterLongPress(LONG_PRESS_MS)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          active.value = 1;
          runOnJS(begin)(item.id);
        })
        .onUpdate((event) => {
          'worklet';
          dx.value = event.translationX;
          const step = dayPx.value > 0 ? dayPx.value : 1;
          const days = Math.round(dx.value / step);
          // 只在"跨过一天"时才回 JS 刷新预览文案，跟手本身不经过 JS
          if (days !== lastDays.value) {
            lastDays.value = days;
            runOnJS(preview)(item.id, days);
          }
        })
        .onEnd(() => {
          'worklet';
          const step = dayPx.value > 0 ? dayPx.value : 1;
          runOnJS(commit)(item.id, Math.round(dx.value / step));
        })
        .onFinalize(() => {
          'worklet';
          const wasActive = active.value;
          dx.value = 0;
          lastDays.value = 0;
          active.value = 0;
          if (wasActive) runOnJS(reset)();
        }),
    [active, begin, commit, dayPx, draggable, dx, item.id, lastDays, preview, reset],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }],
    opacity: active.value ? 1 : baseOpacity * (dimmed ? 0.35 : 1),
    borderColor: active.value ? theme.text : 'transparent',
    zIndex: active.value ? 20 : 0,
  }));

  /**
   * 条子的几何：外层负责"落在轴上哪个位置"，内层 Pressable 负责点击。
   *
   * 为什么把 Pressable 放进手势层里面：手势要有机会拿到触摸。
   * 反过来（点击区浮在手势层之上）长按会被点击区吃掉，条子根本拖不动。
   * 长按 200ms 才会被 Pan 接管，所以单击照常进详情。
   */
  const geometry = {
    left: `${left * 100}%` as const,
    width: point ? POINT_SIZE : (`${width * 100}%` as const),
    height: point ? POINT_SIZE : BAR_HEIGHT,
    marginLeft: point ? -POINT_SIZE / 2 : 0,
    top: point ? (ROW_HEIGHT + ROW_GAP - POINT_SIZE) / 2 : (ROW_HEIGHT + ROW_GAP - BAR_HEIGHT) / 2,
  };

  const bar = (
    <Animated.View style={[styles.slot, geometry, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityHint={draggable ? '长按可拖动改期' : undefined}
        onPress={() => onSelect?.(item)}
        style={[
          styles.bar,
          {
            backgroundColor: barBackground,
            borderRadius: point ? POINT_SIZE / 2 : 4,
          },
        ]}>
        {point ? null : (
          <ThemedText type="small" numberOfLines={1} style={[styles.barText, { color: textColor }]}>
            {`${formatMonthDay(row.start)} - ${formatMonthDay(row.end)}`}
          </ThemedText>
        )}
      </Pressable>
    </Animated.View>
  );

  return (
    <View style={{ height: ROW_HEIGHT + ROW_GAP, justifyContent: 'center' }}>
      {draggable ? <GestureDetector gesture={gesture}>{bar}</GestureDetector> : bar}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  body: { flexDirection: 'row' },
  labelColumn: { flexShrink: 0 },
  labelCell: { justifyContent: 'center', paddingRight: Spacing.two },
  labelText: { fontSize: 12, lineHeight: 15 },
  labelBadge: { fontSize: 10, lineHeight: 12 },
  scroll: { flex: 1 },
  axis: { position: 'relative' },
  tick: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  tickText: { fontSize: 10, lineHeight: 14 },
  gridLine: { position: 'absolute', width: StyleSheet.hairlineWidth, opacity: 0.7 },
  /** 条子的定位槽（绝对定位在行内），里面才是可点击的条子本体 */
  slot: { position: 'absolute' },
  bar: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  barText: { fontSize: 10, lineHeight: 14 },
  todayLine: { position: 'absolute', top: 0, bottom: 0, width: 1.5 },
  preview: { fontSize: 12, lineHeight: 16 },
  footnoteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  footnote: { fontSize: 11, lineHeight: 15, opacity: 0.75 },
  empty: { borderRadius: Spacing.three, padding: Spacing.four, alignItems: 'center' },
});
