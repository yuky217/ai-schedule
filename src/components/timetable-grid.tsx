import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
 * 三条刻意的设计：
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
}

export function TimetableGrid({ days, periods, rows, today, onSelectSlot }: TimetableGridProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [available, setAvailable] = useState(0);

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

  const todayKey = today ? toDayKey(today) : null;

  const header = (
    <View style={styles.headerRow}>
      <View style={{ width: PERIOD_COLUMN_WIDTH }} />
      {days.map((day) => {
        const isToday = todayKey != null && toDayKey(day.date) === todayKey;
        return (
          <View key={toDayKey(day.date)} style={[styles.dayHeader, { width: columnWidth }]}>
            <ThemedText
              type={isToday ? 'smallBold' : 'small'}
              themeColor={isToday ? 'text' : 'textSecondary'}
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
          return (
            <View
              key={index}
              style={[styles.periodCell, { height: ROW_HEIGHT, borderColor: theme.backgroundSelected }]}>
              <ThemedText style={[styles.periodIndex, { color: theme.textSecondary }]}>
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

      {days.map((day) => (
        <DayColumn
          key={toDayKey(day.date)}
          day={day}
          rowCount={rowCount}
          columnWidth={columnWidth}
          borderColor={theme.backgroundSelected}
          columnBackground={
            todayKey != null && toDayKey(day.date) === todayKey ? theme.backgroundElement : undefined
          }
          dark={dark}
          onSelectSlot={onSelectSlot}
        />
      ))}
    </View>
  );

  return (
    <View style={styles.root} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        scrollEnabled={needsScroll}
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
  rowCount: number;
  columnWidth: number;
  borderColor: string;
  columnBackground?: string;
  dark: boolean;
  onSelectSlot: (slot: CourseSlot) => void;
}

function DayColumn({
  day,
  rowCount,
  columnWidth,
  borderColor,
  columnBackground,
  dark,
  onSelectSlot,
}: DayColumnProps) {
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

      {layouts.map(({ slot, lane, lanes }) => {
        const color = courseColor(slot.course.colorIndex, dark);
        const span = slot.session.endPeriod - slot.session.startPeriod + 1;
        const place = slot.session.location ?? slot.course.location;
        return (
          <View
            key={`${slot.course.id}-${slot.session.startPeriod}-${slot.session.endPeriod}-${lane}`}
            style={[
              styles.blockBox,
              {
                top: (slot.session.startPeriod - 1) * ROW_HEIGHT,
                height: span * ROW_HEIGHT,
                left: `${(lane / lanes) * 100}%`,
                width: `${100 / lanes}%`,
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${slot.course.title}，${place ?? '地点待定'}`}
              onPress={() => onSelectSlot(slot)}
              style={({ pressed }) => [
                styles.block,
                {
                  backgroundColor: color.background,
                  borderColor: color.border,
                  opacity: pressed ? 0.72 : 1,
                },
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
          </View>
        );
      })}
    </View>
  );
}

const HAIRLINE = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  root: { width: '100%' },
  scrollContent: { flexGrow: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: Spacing.one },
  dayHeader: { alignItems: 'center', gap: 1 },
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
  blockTitle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  blockMeta: { fontSize: 9, lineHeight: 12, marginTop: 1, opacity: 0.85 },
});
