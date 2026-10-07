import { Ionicons } from '@expo/vector-icons';
import { startOfWeek } from 'date-fns';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { TimetableGrid } from '@/components/timetable-grid';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import { weekGrid, weekIndexOf, type Course, type CourseSlot, type Term } from '@/domain/course';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 课表视图（日历的第四个分段）。
 *
 * 它和日历的另外三个视图不是一回事，但摆在同一个位置：
 * "月/周/日"回答的是"我要做什么"，"课表"回答的是"我什么时候被占着"。
 * 后者不是任务（没有完成态、不该被勾掉），所以在数据上也从来不进任务表。
 *
 * 空态的处理跟日历一致：**只替换内容区**，工具栏和分段控件必须还在 ——
 * 否则用户在空课表里连"换个视图"都点不到。
 */
export interface TimetableViewProps {
  courses: readonly Course[];
  term: Term | null;
  /** 正在看的那一周里的任意一天 */
  cursor: Date;
  onSelectSlot: (slot: CourseSlot) => void;
  onSelectCourse: (course: Course) => void;
  onImport: () => void;
  /** 手动添加一门课（导入认不出来时的兜底出口） */
  onAddCourse: () => void;
}

export function TimetableView({
  courses,
  term,
  cursor,
  onSelectSlot,
  onSelectCourse,
  onImport,
  onAddCourse,
}: TimetableViewProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const days = useMemo(() => {
    const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
    return term
      ? weekGrid(courses, weekStart, term)
      : Array.from({ length: 7 }, (_, offset) => ({
          date: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset),
          slots: [] as CourseSlot[],
        }));
  }, [courses, cursor, term]);

  /**
   * 网格行数按**整个学期**的课算，不按这一周 —— 否则从满课的周一翻到
   * 没课的周二，整张表的高度会跳一下，看着像界面出了错。
   */
  const rows = useMemo(() => {
    if (!term) return 8;
    let max = 0;
    for (const course of courses) {
      for (const session of course.sessions) max = Math.max(max, session.endPeriod);
    }
    return Math.min(Math.max(8, max), Math.max(1, term.periods.length));
  }, [courses, term]);

  /**
   * 没有任何上课时间的课。教务系统里这类课很常见（实践、网课、时间待定，
   * 导出文本里写成"…/1-12周/无"），它们画不进时间网格，但**不能被当成
   * "没有这门课"** —— 单独列出来，点一下就能补时间。
   */
  const timeless = useMemo(() => courses.filter((course) => !course.sessions.length), [courses]);

  if (!term || !courses.length) {
    const hasCourses = courses.length > 0;
    return (
      <Card>
        <EmptyState
          icon="school-outline"
          title={hasCourses ? '还差一个开学日' : '还没有课表'}
          hint="把教务系统的课表文本粘进来就能导入。开学日填第 1 周的周一 —— 有了它，每节课是第几周才算得出来。"
        />
        <View style={styles.emptyActions}>
          <TextButton label="导入课表" onPress={onImport} primary />
          <TextButton label="手动添加" onPress={onAddCourse} />
        </View>
      </Card>
    );
  }

  const weekIndex = weekIndexOf(term, cursor);
  const inTerm = weekIndex != null && weekIndex >= 1;
  const week = weekIndex ?? 0;

  /** 这周不上、但这学期有安排 —— 说出来，免得用户以为课被弄丢了 */
  const idle = (() => {
    if (!inTerm) return [];
    const showing = new Set<string>();
    for (const day of days) for (const slot of day.slots) showing.add(slot.course.id);
    return courses
      .filter((course) => course.sessions.length && !showing.has(course.id))
      .map((course) => course.title);
  })();

  return (
    <View style={styles.container}>
      <TimetableGrid
        days={days}
        periods={term.periods}
        rows={rows}
        today={new Date()}
        onSelectSlot={onSelectSlot}
      />

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.footerText}>
          {inTerm
            ? `第 ${week} 周 · 共 ${term.totalWeeks} 周 · ${courses.length} 门课`
            : weekIndex != null && weekIndex > term.totalWeeks
              ? `${term.label} 已经结束了（共 ${term.totalWeeks} 周）`
              : `${term.label} 还没开始 · 第 1 周从 ${term.startDayKey.replace(/-/g, '/')} 起`}
        </ThemedText>
        <View style={styles.footerLinks}>
          <Pressable accessibilityRole="button" onPress={onAddCourse} hitSlop={10}>
            <View style={styles.linkRow}>
              <Ionicons name="add" size={15} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
                添加
              </ThemedText>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onImport} hitSlop={10}>
            <View style={styles.linkRow}>
              <Ionicons name="download-outline" size={13} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
                导入
              </ThemedText>
            </View>
          </Pressable>
        </View>
      </View>

      {idle.length ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.idle}>
          这一周不上：{idle.join('、')}
        </ThemedText>
      ) : null}

      {timeless.length ? (
        <Card
          title={`没有上课时间 · ${timeless.length} 门`}
          hint="教务系统里这类课本来就没排时间（实践、网课、待定）。点一门就能补上。">
          {timeless.map((course) => {
            const color = courseColor(course.colorIndex, dark);
            return (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                onPress={() => onSelectCourse(course)}
                style={({ pressed }) => [styles.timelessRow, { opacity: pressed ? 0.6 : 1 }]}>
                <View style={[styles.dot, { backgroundColor: color.background, borderColor: color.border }]} />
                <ThemedText type="small" numberOfLines={1} style={styles.timelessTitle}>
                  {course.title}
                </ThemedText>
                {course.teacher ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {course.teacher}
                  </ThemedText>
                ) : null}
                <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

/** 页脚用的纯文字按钮：课表的次要动作不该抢主视觉 */
function TextButton({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.textButton,
        { backgroundColor: primary ? theme.text : theme.background },
        { opacity: pressed ? 0.8 : 1 },
      ]}>
      <ThemedText
        type="smallBold"
        style={{ color: primary ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  emptyActions: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  footerText: { flex: 1, fontSize: 12, lineHeight: 16 },
  footerLinks: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  link: { fontSize: 12 },
  idle: { fontSize: 12, lineHeight: 17, opacity: 0.75 },
  timelessRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  timelessTitle: { flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  textButton: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
});
