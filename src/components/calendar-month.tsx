import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dayShapes, type DayDot, type DayMarks } from '@/domain/calendar-shape';
import { MONTH_GRID_ROWS } from '@/domain/calendar-window';
import { useTheme } from '@/hooks/use-theme';

/**
 * 月视图网格：周一开头，固定 MONTH_GRID_ROWS 行保证月与月之间高度稳定。
 *
 * 网格只负责"哪天有几件事"（圆点），具体任务列表由页面层展示。
 * 拖拽改期时，页面层通过 registerCell 拿到每个日期格的 View 引用做命中检测，
 * dropTargetKey 对应的格子会高亮 —— 网格本身不关心拖拽逻辑。
 *
 * 行数从 domain 拿而不是本地写死：日历的数据窗口是按"整张网格"算范围的
 * （见 domain/calendar-window.ts），两边行数一旦不一致，最后一行就会静默没有数据。
 */

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEK_ROWS = MONTH_GRID_ROWS;

/**
 * 一格上到底有哪几种东西、谁该给谁让位、深浅怎么分 —— 全在
 * `domain/calendar-shape.dayShapes` 里定死，这个组件只负责画。
 */

export interface CalendarMonthProps {
  /** 任意一个落在目标月份的日期 */
  month: Date;
  selected: Date;
  onSelectDay: (date: Date) => void;
  /** key = yyyy-MM-dd，value = 该日任务数 */
  countsByDay: Map<string, number>;
  /**
   * key = yyyy-MM-dd，value = 那天的课与考试数（可选）。
   * 不传就退回"全是实心点"的老行为 —— 月历本身不该被这两个数绑架。
   */
  marksByDay?: Map<string, DayMarks>;
  /** 把日期格注册给拖拽层（命中检测用） */
  registerCell?: (key: string) => (view: View | null) => void;
  /** 当前拖拽悬停的日期格 key，该格高亮 */
  dropTargetKey?: string | null;
}

const dayKey = (d: Date): string => format(d, 'yyyy-MM-dd');

export function CalendarMonth({
  month,
  selected,
  onSelectDay,
  countsByDay,
  marksByDay,
  registerCell,
  dropTargetKey,
}: CalendarMonthProps) {
  const theme = useTheme();

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    return Array.from({ length: WEEK_ROWS * 7 }, (_, i) => addDays(first, i));
  }, [month]);

  return (
    <View style={[styles.grid, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.weekHeader}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={styles.cell}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekday}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      {Array.from({ length: WEEK_ROWS }, (_, row) => (
        <View key={row} style={styles.weekRow}>
          {days.slice(row * 7, row * 7 + 7).map((day) => {
            const key = dayKey(day);
            const count = countsByDay.get(key) ?? 0;
            const dots = dayShapes(count, marksByDay?.get(key));
            const selectedDay = isSameDay(day, selected);
            const today = isSameDay(day, new Date());
            const outside = !isSameMonth(day, month);
            const dropTarget = dropTargetKey === key;

            return (
              <Pressable
                key={key}
                ref={registerCell ? registerCell(key) : undefined}
                // Android 会折叠没有交互属性的中间视图，导致 measureInWindow 量不到
                collapsable={false}
                style={[
                  styles.cell,
                  dropTarget && {
                    backgroundColor: theme.backgroundSelected,
                    borderRadius: Spacing.two,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={format(day, 'M月d日')}
                onPress={() => onSelectDay(day)}>
                <View
                style={[
                  styles.dayCircle,
                  { backgroundColor: selectedDay ? theme.text : 'transparent' },
                  // 今天永远有标记：没选中 = 空心圆环；选中了 = 实心 + 灰阶外圈，
                  // 这样两种状态都认得出"今天"（之前今天被选中时圆环会消失）。
                  today && !selectedDay && { borderColor: theme.text, borderWidth: 2 },
                  today && selectedDay && { borderColor: theme.textSecondary, borderWidth: 2 },
                  dropTarget && { borderColor: theme.text, borderWidth: 2 },
                ]}>
                <ThemedText
                  type={today ? 'smallBold' : 'small'}
                  themeColor={selectedDay ? 'background' : outside ? 'textSecondary' : 'text'}
                  style={[styles.dayText, outside && styles.outside]}>
                  {day.getDate()}
                </ThemedText>
                </View>
                <View style={styles.dots}>
                  {dots.map((dot, i) => {
                    /*
                      未完成的任务点画**正文色（深）**，其余的浅 —— 月历上
                      "这天还欠着事"是唯一能提前看见的信息，过期与否在形状上
                      根本看不出来。深浅只挂在任务上（课/考试没有完成态）。

                      选中那天整格统一退回底色：日期圈本身已是实心深色，
                      深点压上去看不见。这天已经被高亮、清单也摊在下面，
                      让深浅让位给"今天/选中"是划算的。
                    */
                    const tint = selectedDay
                      ? theme.background
                      : dot.kind === 'task' && dot.open
                        ? theme.text
                        : theme.textSecondary;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.dot,
                          // 课：空心（背景，不用你动手）· 考试：方块（硬边界）· 任务：实心点
                          dot.kind === 'course'
                            ? [styles.dotHollow, { borderColor: tint }]
                            : dot.kind === 'exam'
                              ? [styles.dotSquare, { backgroundColor: tint }]
                              : { backgroundColor: tint, borderRadius: 2 },
                          { opacity: outside ? 0.4 : 1 },
                        ]}
                      />
                    );
                  })}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
  },
  weekHeader: { flexDirection: 'row' },
  weekRow: { flexDirection: 'row' },
  /**
   * 月格放大（2026-10-10 "范围放大"= 页面占比）：日期圈 30 → 36、数字 14 → 16。
   * 七列在 390pt 屏上每列仍有 ~48pt，36pt 的圈放得下且四周留得住空隙；
   * 六行整体变高，月历就把屏幕占满了 —— 放大的是渲染占比，取数范围没动。
   */
  cell: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one, gap: Spacing.half },
  weekday: { fontSize: 12, lineHeight: 16 },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 16, lineHeight: 20 },
  outside: { opacity: 0.4 },
  dots: { flexDirection: 'row', gap: 3, minHeight: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  /**
   * 课的空心点。边框宽度必须写在样式里（颜色由调用方按选中态给）：
   * 只给 borderColor 不给 borderWidth，Web 上就是一个没边、没底色的空气泡。
   */
  dotHollow: {
    width: 4,
    height: 4,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'transparent',
  },
  /** 考试的方块：和圆点同样是 4pt，靠直角而不是靠大小区分 */
  dotSquare: { width: 4, height: 4, borderRadius: 0 },
});
