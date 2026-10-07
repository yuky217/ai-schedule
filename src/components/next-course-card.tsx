import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import { describeSlotTiming, nextCourse } from '@/domain/course';
import { describeClock, periodSpan } from '@/domain/timetable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 首页的"下一节课"。
 *
 * 为什么值得占首页一格：课是**别人定好的时间**，跟"我想做什么"是两回事 ——
 * 它一动，今天剩下的时间怎么排全得跟着改。所以它得在打开 App 的第一屏上，
 * 而且只有它**真的近**的时候才出现（今天/明天/正在上），
 * "5 天后有节课"不是此刻要关心的信息，塞在首页只是噪音。
 *
 * 没有课表时什么都不渲染 —— 不占位、不留一句"还没有课"。
 */
export function NextCourseCard({ onPress }: { onPress: (courseId: string) => void }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const courses = useAppStore((state) => state.courses);
  const term = useAppStore((state) => state.term);

  if (!term || !courses.length) return null;

  const now = new Date();
  const slot = nextCourse(courses, term, now);
  if (!slot) return null;

  const timing = describeSlotTiming(slot, now);
  if (timing !== '正在上' && timing !== '今天' && timing !== '明天') return null;

  const color = courseColor(slot.course.colorIndex, dark);
  const span = periodSpan(term.periods, slot.session.startPeriod, slot.session.endPeriod);
  const clock = span ? `${describeClock(span.start)}–${describeClock(span.end)}` : '';
  const place = slot.session.location ?? slot.course.location;

  /** 快了就说"还有多久"，比甩两个钟点更直接 */
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const minutesUntil = slot.start - nowMinutes;
  const headline =
    timing === '正在上'
      ? `正在上 · ${clock}`
      : minutesUntil > 0 && minutesUntil <= 120
        ? `${minutesUntil} 分钟后 · ${clock}`
        : `${timing} ${clock}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${slot.course.title}，${headline}`}
      onPress={() => onPress(slot.course.id)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.75 : 1 },
      ]}>
      <View style={[styles.stripe, { backgroundColor: color.background, borderColor: color.border }]} />
      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {slot.course.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.meta}>
          {headline}
          {place ? ` · ${place}` : ''}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  stripe: { width: 4, height: 30, borderRadius: 2, borderWidth: 1 },
  body: { flex: 1, gap: 1 },
  meta: { fontSize: 12, lineHeight: 16 },
});
