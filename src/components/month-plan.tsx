import { Ionicons } from '@expo/vector-icons';
import { format, isSameDay } from 'date-fns';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CalendarShape } from '@/domain/calendar-shape';
import type { CourseSlot } from '@/domain/course';
import { describeEvent } from '@/domain/event';
import { markLine } from '@/domain/marks';
import type { MonthPlanDay } from '@/domain/month-plan';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';

/**
 * 月历下方那块「这个月每天都有什么」的清单（下拉展开）。
 *
 * ## 为什么它是一块"拉开的面板"而不是"格子里写字"
 *
 * 月历的格子只有 44pt 宽，塞得下任何一个标题就意味着它不再是一张
 * 能一眼扫完的网格。所以它保持只画圆点，名字在拉开的这一块里逐天列。
 *
 * ## 为什么展开是"跟手拉开"而不是"点一下弹出来"
 *
 * 用户要的就是"下拉能拉开"这个动作 —— 面板跟着手指长出来，才能让他
 * 相信这是从月历里**拉**出来的东西，而不是凭空弹出一层。
 * 高度由 shared value 驱动跑在 UI 线程，跟手不卡；松手才回 JS 决定全开还是弹回。
 *
 * ## 为什么面板高度是"内容全高"而不是固定一屏
 *
 * 它在页面滚动流里，往下滚就到底 —— 不必为了它再嵌一层滚动容器
 * （嵌套滚动是这项目踩过的坑：滚动锁、超时兜底、web 上还不一样）。
 *
 * ## 天里的顺序
 *
 * 纪念日 → 课 → 考试 → 任务，与月历圆点的顺序同源（越往后越要你动手）。
 * 行首的小标记就是月历上的那个圆点：空心＝课 · 方块＝考试 · 实心＝任务 ——
 * 清单和格子说的是同一套形状语言，不用在两处记两套。
 */

/** 周日…周六（自算中文，不引 date-fns locale） */
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface MonthPlanProps {
  days: readonly MonthPlanDay[];
  /** 「10月」—— 只给月份，标题是「10月安排」 */
  monthLabel: string;
  /** 是否展开（决定箭头方向与是否接收点击） */
  open: boolean;
  /** 展开进度 0..1，由页面上的下拉手势驱动 */
  pull: SharedValue<number>;
  onToggle: () => void;
  /** 点日期头 / 课行 / 「还有 N 件」—— 去看那天的日视图 */
  onFocusDay: (date: Date) => void;
  onOpenTask: (task: Task) => void;
  onCompleteTask: (task: Task) => void;
}

export function MonthPlan({
  days,
  monthLabel,
  open,
  pull,
  onToggle,
  onFocusDay,
  onOpenTask,
  onCompleteTask,
}: MonthPlanProps) {
  const theme = useTheme();
  /** 内容自然高度（onLayout 量出来），容器高度 = 它 × pull */
  const panelHeight = useSharedValue(0);
  const has = days.length > 0;

  const clipStyle = useAnimatedStyle(() => ({
    height: Math.max(0, panelHeight.value * Math.min(1, Math.max(0, pull.value))),
  }));

  return (
    <View style={[styles.block, { backgroundColor: theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={has ? `${monthLabel}安排，${days.length} 天有安排` : `${monthLabel}没有安排`}
        onPress={has ? onToggle : undefined}
        style={({ pressed }) => [
          styles.handle,
          { opacity: pressed && has ? 0.6 : 1 },
        ]}>
        <ThemedText type="smallBold">{`${monthLabel}安排`}</ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.handleHint}
          numberOfLines={1}>
          {has ? `${days.length} 天有安排` : '这个月还没有安排'}
        </ThemedText>
        {has ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.textSecondary}
          />
        ) : null}
      </Pressable>

      {has ? (
        <Animated.View
          style={[styles.clip, clipStyle]}
          // 收起时内容还在树里（要量高度），但不能被点到、也不该被读屏念出来
          pointerEvents={open ? 'auto' : 'none'}>
          <View
            style={[styles.panel, { backgroundColor: theme.background }]}
            onLayout={(event) => {
              panelHeight.value = event.nativeEvent.layout.height;
            }}>
            {days.map((day, index) => (
              <DayGroup
                key={format(day.date, 'yyyy-MM-dd')}
                day={day}
                first={index === 0}
                onFocusDay={onFocusDay}
                onOpenTask={onOpenTask}
                onCompleteTask={onCompleteTask}
              />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

interface DayGroupProps {
  day: MonthPlanDay;
  first: boolean;
  onFocusDay: (date: Date) => void;
  onOpenTask: (task: Task) => void;
  onCompleteTask: (task: Task) => void;
}

function DayGroup({ day, first, onFocusDay, onOpenTask, onCompleteTask }: DayGroupProps) {
  const theme = useTheme();
  const today = isSameDay(day.date, new Date());

  return (
    <View
      style={[
        styles.group,
        !first && { borderTopColor: theme.backgroundSelected, borderTopWidth: StyleSheet.hairlineWidth },
      ]}>
      <ThemedText
        type="smallBold"
        themeColor={today ? 'text' : 'textSecondary'}
        style={styles.groupTitle}>
        {today
          ? `今天 · ${format(day.date, 'M月d日')}`
          : `${format(day.date, 'M月d日')} 周${WEEK_CN[day.date.getDay()]}`}
      </ThemedText>

      {/* 纪念日：它不是"一件事"，是这一天的底色 —— 排在最前，和日卡一个位置 */}
      {day.marks.map((view) => (
        <View key={view.mark.id} style={styles.row}>
          <Ionicons name="gift-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="small" numberOfLines={1} style={styles.rowTitle}>
            {view.mark.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {markLine(view)}
          </ThemedText>
        </View>
      ))}

      {/* 课：一天一门课可能占好几节，合并成一行说清是哪些课 */}
      {day.courses.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`看${format(day.date, 'M月d日')}的时间轴`}
          onPress={() => onFocusDay(day.date)}
          style={styles.row}>
          <PlanDot shape="course" tint={theme.textSecondary} />
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={styles.rowTitle}>
            {courseSummary(day.courses)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {`${courseCount(day.courses)} 门课`}
          </ThemedText>
        </Pressable>
      ) : null}

      {/* 考试：到点就是它，不带完成态，所以不进 TaskRow（那是个能勾的行） */}
      {day.exams.map((event) => (
        <View key={event.id} style={styles.row}>
          <PlanDot shape="exam" tint={theme.text} />
          <ThemedText type="small" numberOfLines={1} style={styles.rowTitle}>
            {event.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {describeEvent(event)}
          </ThemedText>
        </View>
      ))}

      {/*
        任务行直接复用 TaskRow：勾选、完成灰掉、进详情全部现成。
        刻意**不给拖拽抓手** —— 这张清单是拿来"看"的（在月历上改期有另一条路），
        再挂一层拖拽只会让"拖到哪个格子"变成猜谜。
      */}
      {day.tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onPress={onOpenTask}
          onComplete={onCompleteTask}
        />
      ))}

      {day.extraTasks ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onFocusDay(day.date)}
          style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {`还有 ${day.extraTasks} 件 · 看这天`}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 一门课一天可能排两节，名字只说一次 */
function courseSummary(courses: readonly CourseSlot[]): string {
  return [...new Set(courses.map((slot) => slot.course.title))].join(' · ');
}

function courseCount(courses: readonly CourseSlot[]): number {
  return new Set(courses.map((slot) => slot.course.title)).size;
}

/** 行首的小标记就是月历上的那个圆点：空心＝课 · 方块＝考试 · 实心＝任务 */
function PlanDot({ shape, tint }: { shape: CalendarShape; tint: string }) {
  return (
    <View
      style={[
        styles.dot,
        shape === 'course'
          ? [styles.dotHollow, { borderColor: tint }]
          : shape === 'exam'
            ? styles.dotSquare
            : null,
        shape !== 'course' ? { backgroundColor: tint } : null,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    borderRadius: Spacing.three,
    // 内容撑到底边时要跟着块一起收圆角
    overflow: 'hidden',
  },
  handle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  handleHint: { flex: 1, textAlign: 'right' },
  clip: { overflow: 'hidden' },
  /** 内嵌一层页面底色：任务行（backgroundElement）在它上面才看得出行边界 */
  panel: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  group: { paddingVertical: Spacing.two, gap: Spacing.half },
  groupTitle: { fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  rowTitle: { flex: 1 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  /** 边框宽度必须写在样式里：只给 borderColor 不给宽度，就是一个空气泡 */
  dotHollow: {
    width: 4,
    height: 4,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'transparent',
  },
  dotSquare: { width: 4, height: 4, borderRadius: 0 },
});
