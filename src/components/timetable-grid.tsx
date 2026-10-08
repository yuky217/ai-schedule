import * as Haptics from 'expo-haptics';
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
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import { layoutSlots, weekdayLabel, type CourseSlot } from '@/domain/course';
import { describeClock, periodById, type ClassPeriod } from '@/domain/timetable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { toDayKey } from '@/utils/datetime';

/**
 * 周网格：一列一天 × 一行一节的课表。
 *
 * 四条刻意的设计：
 *
 * 1. **课块绝对定位，不用 flex 行。** 一节课可能横跨 2-4 节（"第 3-4 节"），
 *    flex 行表达不了"跨行"，只能把这个块塞在起始那一行里，看起来就像只上 1 节。
 *    定位到 `(起始节 - 1) × 行高`、高度 = 跨节数 × 行高，"跨几节"是看得见的。
 *
 * 2. **同一列撞课的块并排（分道），不叠在一起。** 叠的话后画的会整个盖住先画的，
 *    用户看到的是"这节课凭空没了"。分道逻辑在 `domain/course.layoutSlots`（有测试）。
 *
 * 3. **列宽放不下就横向滚动，不硬挤。** 手机上 7 列各分到 ~40px，课名会碎成
 *    "软件/工程/导论"这种竖排。宁可横滑，也不把课名挤到读不出来。
 *    代价是拖拽：横滑和横拖是同一个方向，所以**拖拽期间把滚动关掉**
 *    （长按 220ms 拾起之后才进入拖拽，正常滚动完全不受影响）。
 *
 * 4. **长按拖课块 = 换星期/节次**（超级课程表 / WakeUp 的标配）。拖的是
 *    被抓住的那一次安排：跨度（跨几节）跟着走，周次和教室不动 ——
 *    拖拽表达的是"这节课换时间了"，不是"重排这门课"。
 */

/** 一行（= 一节）的高度 */
const ROW_HEIGHT = 54;
/** 每列最小宽度；屏幕放不下 7 列时改为横向滚动 */
const MIN_COLUMN_WIDTH = 68;
/** 左侧节次列的宽度 */
const PERIOD_COLUMN_WIDTH = 46;
/** 课块四周留的缝，让相邻两块不贴在一起 */
const BLOCK_GAP = 2;
/** 这节课最少显示几行高（这一周全没课时网格也别塌成一条线） */
const MIN_ROWS = 8;
/** 长按多久算"拾起"（跟日历的块同一档手感） */
const PICK_UP_DELAY = 220;

const clampInt = (value: number, min: number, max: number): number => {
  'worklet';
  return Math.max(min, Math.min(max, value));
};

export interface TimetableDay {
  date: Date;
  slots: CourseSlot[];
}

export interface TimetableGridProps {
  /** 7 天（周一打头），来自 `domain/course.weekGrid` */
  days: readonly TimetableDay[];
  periods: readonly ClassPeriod[];
  /**
   * 网格显示多少行（= 多少节）。
   * **由调用方按"整个学期的课"算好后传进来**，不是按当前这一周算的 ——
   * 否则从满课的周一翻到没课的周二，整张网格的高度会跳一下。
   */
  rows?: number;
  /** 高亮哪一列（通常是今天） */
  today?: Date | null;
  onSelectSlot: (slot: CourseSlot) => void;
  /** 长按拖课块换到别的星期/节次。缺省 = 不给拖 */
  onMoveSlot?: (slot: CourseSlot, weekday: number, startPeriod: number) => Promise<void> | void;
  /** 拖拽开始/结束：父层用它锁住整页滚动 */
  onDraggingChange?: (dragging: boolean) => void;
}

export function TimetableGrid({
  days,
  periods,
  rows,
  today,
  onSelectSlot,
  onMoveSlot,
  onDraggingChange,
}: TimetableGridProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 拖拽时的落点：哪一列、从第几行起、跨几行 */
  const [hover, setHover] = useState<{ column: number; row: number; span: number } | null>(null);

  const columnWidthSV = useSharedValue(MIN_COLUMN_WIDTH);

  const setDraggingState = useCallback(
    (next: boolean) => {
      setDragging(next);
      onDraggingChange?.(next);
    },
    [onDraggingChange],
  );

  const rowCount = useMemo(() => {
    if (rows && rows > 0) return rows;
    let max = 0;
    for (const day of days) for (const slot of day.slots) max = Math.max(max, slot.session.endPeriod);
    return Math.min(Math.max(MIN_ROWS, max), Math.max(1, periods.length));
  }, [days, periods.length, rows]);

  const columnWidth = available
    ? Math.max(MIN_COLUMN_WIDTH, Math.floor((available - PERIOD_COLUMN_WIDTH) / Math.max(1, days.length)))
    : MIN_COLUMN_WIDTH;
  const totalWidth = PERIOD_COLUMN_WIDTH + columnWidth * days.length;
  const needsScroll = available > 0 && totalWidth > available + 1;

  useEffect(() => {
    columnWidthSV.value = columnWidth;
  }, [columnWidth, columnWidthSV]);

  const todayKey = today ? toDayKey(today) : null;

  const header = (
    <View style={styles.headerRow}>
      <View style={{ width: PERIOD_COLUMN_WIDTH }} />
      {days.map((day, column) => {
        const isToday = todayKey != null && toDayKey(day.date) === todayKey;
        const hovered = hover?.column === column;
        return (
          <View
            key={toDayKey(day.date)}
            style={[
              styles.dayHeader,
              { width: columnWidth },
              hovered ? { backgroundColor: theme.backgroundSelected, borderRadius: Spacing.two } : null,
            ]}>
            <ThemedText
              type={isToday || hovered ? 'smallBold' : 'small'}
              themeColor={isToday || hovered ? 'text' : 'textSecondary'}
              style={styles.dayHeaderWeekday}>
              {weekdayLabel(day.date.getDay())}
            </ThemedText>
            <ThemedText
              style={[
                styles.dayHeaderDate,
                { color: isToday ? theme.text : theme.textSecondary },
                isToday ? styles.dayHeaderDateToday : null,
              ]}>
              {day.date.getMonth() + 1}/{day.date.getDate()}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );

  const body = (
    <View style={styles.bodyRow}>
      <View style={{ width: PERIOD_COLUMN_WIDTH }}>
        {Array.from({ length: rowCount }, (_, index) => {
          const period = periodById(periods, index + 1);
          // 拖拽时要落在哪几节：刻度栏跟着亮，用户才敢松手
          const inHover =
            hover != null && index >= hover.row && index < hover.row + hover.span;
          return (
            <View
              key={index}
              style={[
                styles.periodCell,
                { height: ROW_HEIGHT, borderColor: theme.backgroundSelected },
                inHover ? { backgroundColor: theme.backgroundSelected } : null,
              ]}>
              <ThemedText
                style={[styles.periodIndex, { color: inHover ? theme.text : theme.textSecondary }]}>
                {index + 1}
              </ThemedText>
              {period ? (
                <ThemedText style={[styles.periodClock, { color: theme.textSecondary }]}>
                  {describeClock(period.start)}
                </ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>

      {days.map((day, column) => (
        <DayColumn
          key={toDayKey(day.date)}
          day={day}
          days={days}
          column={column}
          rowCount={rowCount}
          columnWidth={columnWidth}
          columnWidthSV={columnWidthSV}
          borderColor={theme.backgroundSelected}
          columnBackground={
            todayKey != null && toDayKey(day.date) === todayKey ? theme.backgroundElement : undefined
          }
          hoveredRow={hover && hover.column === column ? hover : null}
          dark={dark}
          onSelectSlot={onSelectSlot}
          onMoveSlot={onMoveSlot}
          onHover={setHover}
          onDraggingChange={setDraggingState}
        />
      ))}
    </View>
  );

  return (
    <View style={styles.root} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        // 拖拽期间关掉滚动：横滑和横拖抢的是同一个方向
        scrollEnabled={needsScroll && !dragging}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <View style={{ width: totalWidth }}>
          {header}
          {body}
        </View>
      </ScrollView>
    </View>
  );
}

interface DayColumnProps {
  day: TimetableDay;
  days: readonly TimetableDay[];
  column: number;
  rowCount: number;
  columnWidth: number;
  columnWidthSV: SharedValue<number>;
  borderColor: string;
  columnBackground?: string;
  /** 拖拽正落在这列上时的行范围 */
  hoveredRow: { row: number; span: number } | null;
  dark: boolean;
  onSelectSlot: (slot: CourseSlot) => void;
  onMoveSlot?: (slot: CourseSlot, weekday: number, startPeriod: number) => Promise<void> | void;
  onHover: (hover: { column: number; row: number; span: number } | null) => void;
  onDraggingChange: (dragging: boolean) => void;
}

function DayColumn({
  day,
  days,
  column,
  rowCount,
  columnWidth,
  columnWidthSV,
  borderColor,
  columnBackground,
  hoveredRow,
  dark,
  onSelectSlot,
  onMoveSlot,
  onHover,
  onDraggingChange,
}: DayColumnProps) {
  const theme = useTheme();
  // 分道（撞课并排）是纯几何计算，与颜色无关，交给 domain 算
  const layouts = useMemo(() => layoutSlots(day.slots), [day.slots]);
  const height = rowCount * ROW_HEIGHT;

  return (
    <View style={[styles.dayColumn, { width: columnWidth, height, backgroundColor: columnBackground }]}>
      {Array.from({ length: rowCount }, (_, index) => (
        <View
          key={index}
          style={[styles.rowLine, { top: index * ROW_HEIGHT, height: ROW_HEIGHT, borderColor }]}
        />
      ))}

      {/* 落点提示：目标格整块亮一下 */}
      {hoveredRow ? (
        <View
          pointerEvents="none"
          style={[
            styles.dropTarget,
            {
              top: hoveredRow.row * ROW_HEIGHT,
              height: hoveredRow.span * ROW_HEIGHT,
              borderColor: theme.text,
            },
          ]}
        />
      ) : null}

      {layouts.map(({ slot, lane, lanes }) => {
        const color = courseColor(slot.course.colorIndex, dark);
        const span = slot.session.endPeriod - slot.session.startPeriod + 1;
        const place = slot.session.location ?? slot.course.location;
        return (
          <CourseBlock
            key={`${slot.course.id}-${slot.session.startPeriod}-${slot.session.endPeriod}-${lane}`}
            slot={slot}
            lane={lane}
            lanes={lanes}
            column={column}
            rowIndex={slot.session.startPeriod - 1}
            span={span}
            rowCount={rowCount}
            columnWidth={columnWidth}
            columnWidthSV={columnWidthSV}
            days={days}
            color={color}
            place={place}
            onSelect={onSelectSlot}
            onMove={onMoveSlot}
            onHover={onHover}
            onDraggingChange={onDraggingChange}
          />
        );
      })}
    </View>
  );
}

interface CourseBlockProps {
  slot: CourseSlot;
  lane: number;
  lanes: number;
  column: number;
  /** 起始行（0 起） */
  rowIndex: number;
  /** 跨几行 */
  span: number;
  rowCount: number;
  columnWidth: number;
  columnWidthSV: SharedValue<number>;
  days: readonly TimetableDay[];
  color: { background: string; border: string; text: string };
  place?: string | null;
  onSelect: (slot: CourseSlot) => void;
  onMove?: (slot: CourseSlot, weekday: number, startPeriod: number) => Promise<void> | void;
  onHover: (hover: { column: number; row: number; span: number } | null) => void;
  onDraggingChange: (dragging: boolean) => void;
}

/**
 * 课表里的一个课块。
 *
 * 位置由数据算出的 top/left 决定，拖拽位移用 transform 叠上去 ——
 * 松手落库后 top/left 已是新值，把 transform 归零两次变化互相抵消，
 * 视觉上纹丝不动（和日历的块同一套写法）。
 */
function CourseBlock({
  slot,
  lane,
  lanes,
  column,
  rowIndex,
  span,
  rowCount,
  columnWidth,
  columnWidthSV,
  days,
  color,
  place,
  onSelect,
  onMove,
  onHover,
  onDraggingChange,
}: CourseBlockProps) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** worklet 里读不到 JS 变量，原始坐标也放进 shared value */
  const originColumn = useSharedValue(column);
  const originRow = useSharedValue(rowIndex);
  const lastColumn = useSharedValue(column);
  const lastRow = useSharedValue(rowIndex);

  const [pickedUp, setPickedUp] = useState(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最下面能落的那一行：块本身跨几节，就得往上留出几行的余量 */
  const maxRow = Math.max(0, rowCount - span);
  const maxColumn = Math.max(0, days.length - 1);

  useEffect(() => {
    originColumn.value = column;
    originRow.value = rowIndex;
    lastColumn.value = column;
    lastRow.value = rowIndex;
    dragX.value = 0;
    dragY.value = 0;
  }, [column, dragX, dragY, lastColumn, lastRow, originColumn, originRow, rowIndex]);

  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const pickUp = useCallback(() => {
    setPickedUp(true);
    onDraggingChange(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [onDraggingChange]);

  const reportHover = useCallback(
    (next: { column: number; row: number }) => onHover({ ...next, span }),
    [onHover, span],
  );

  const commit = useCallback(
    (nextColumn: number, nextRow: number) => {
      const changed = nextColumn !== originColumn.value || nextRow !== originRow.value;
      // 先对齐到目标格，再落库 —— 避免"松手先弹回原位再跳过去"
      dragX.value = (nextColumn - originColumn.value) * columnWidthSV.value;
      dragY.value = (nextRow - originRow.value) * ROW_HEIGHT;
      setPickedUp(false);
      onHover(null);
      onDraggingChange(false);

      if (!changed || !onMove) {
        dragX.value = 0;
        dragY.value = 0;
        return;
      }
      const target = days[nextColumn];
      if (!target) {
        dragX.value = 0;
        dragY.value = 0;
        return;
      }
      void Promise.resolve(onMove(slot, target.date.getDay(), nextRow + 1)).finally(() => {
        // 正常情况数据已落、位置已更新，归零无跳变；写库失败也让块回到原位
        if (safety.current) clearTimeout(safety.current);
        safety.current = setTimeout(() => {
          dragX.value = 0;
          dragY.value = 0;
        }, 400);
      });
    },
    [
      columnWidthSV,
      days,
      dragX,
      dragY,
      onDraggingChange,
      onHover,
      onMove,
      originColumn,
      originRow,
      slot,
    ],
  );

  const cancel = useCallback(() => {
    setPickedUp(false);
    onHover(null);
    onDraggingChange(false);
  }, [onDraggingChange, onHover]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!onMove)
        // 长按拾起：单击照常进课程详情，短滑照常横向滚滚看后面几天
        .activateAfterLongPress(PICK_UP_DELAY)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          'worklet';
          runOnJS(pickUp)();
        })
        .onUpdate((event) => {
          'worklet';
          const step = columnWidthSV.value > 0 ? columnWidthSV.value : MIN_COLUMN_WIDTH;
          const nextColumn = clampInt(
            originColumn.value + Math.round(event.translationX / step),
            0,
            maxColumn,
          );
          const nextRow = clampInt(
            originRow.value + Math.round(event.translationY / ROW_HEIGHT),
            0,
            maxRow,
          );
          // 吸到整格：拖到一半也不会画在两格之间
          dragX.value = (nextColumn - originColumn.value) * step;
          dragY.value = (nextRow - originRow.value) * ROW_HEIGHT;
          if (nextColumn !== lastColumn.value || nextRow !== lastRow.value) {
            lastColumn.value = nextColumn;
            lastRow.value = nextRow;
            runOnJS(reportHover)({ column: nextColumn, row: nextRow });
          }
        })
        .onEnd(() => {
          'worklet';
          runOnJS(commit)(lastColumn.value, lastRow.value);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(cancel)();
        }),
    [
      cancel,
      columnWidthSV,
      commit,
      dragX,
      dragY,
      lastColumn,
      lastRow,
      maxColumn,
      maxRow,
      onMove,
      originColumn,
      originRow,
      pickUp,
      reportHover,
    ],
  );

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  const widthPct = 100 / lanes;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.blockBox,
          blockStyle,
          {
            top: rowIndex * ROW_HEIGHT,
            height: span * ROW_HEIGHT,
            left: `${(lane / lanes) * 100}%`,
            width: `${widthPct}%`,
            zIndex: pickedUp ? 12 : 1,
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${slot.course.title}，${place ?? '地点待定'}`}
          onPress={() => onSelect(slot)}
          style={({ pressed }) => [
            styles.block,
            {
              backgroundColor: color.background,
              borderColor: color.border,
              opacity: pressed ? 0.72 : 1,
            },
            pickedUp ? styles.lifted : null,
          ]}>
          <ThemedText
            numberOfLines={span >= 2 ? 3 : 2}
            style={[styles.blockTitle, { color: color.text }]}>
            {slot.course.title}
          </ThemedText>
          {place ? (
            <ThemedText numberOfLines={1} style={[styles.blockMeta, { color: color.text }]}>
              {place}
            </ThemedText>
          ) : null}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const HAIRLINE = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  root: { width: '100%' },
  scrollContent: { flexGrow: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: Spacing.one },
  dayHeader: { alignItems: 'center', gap: 1, paddingVertical: Spacing.half },
  dayHeaderWeekday: { fontSize: 12, lineHeight: 16 },
  dayHeaderDate: { fontSize: 10, lineHeight: 13 },
  dayHeaderDateToday: { fontWeight: '700' },
  bodyRow: { flexDirection: 'row' },
  periodCell: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: Spacing.half,
    borderBottomWidth: HAIRLINE,
    gap: 1,
  },
  periodIndex: { fontSize: 11, lineHeight: 14 },
  periodClock: { fontSize: 9, lineHeight: 11 },
  dayColumn: { position: 'relative' },
  rowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: HAIRLINE,
  },
  dropTarget: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 6,
    opacity: 0.6,
  },
  blockBox: {
    position: 'absolute',
    paddingRight: BLOCK_GAP,
    paddingBottom: BLOCK_GAP,
  },
  block: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 3,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  lifted: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  blockTitle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  blockMeta: { fontSize: 9, lineHeight: 12, marginTop: 1, opacity: 0.85 },
});
