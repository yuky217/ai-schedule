import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import {
  describeChange,
  describePeriods,
  weekdayLabel,
  type CourseSlot,
} from '@/domain/course';
import { describePeriodSpan, type ClassPeriod } from '@/domain/timetable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatMonthDay } from '@/utils/datetime';

/**
 * 课表格子里**某一块**的面板（点一下课块就出来）。
 *
 * 为什么点课块不是直接进课程详情：单次调课（"这周三的课改到周四"）需要知道
 * **是哪一次** —— 也就是哪一天的那一块。课程详情页是"整门课"的视角，没有日期，
 * 在那儿做不了这件事。所以课块先给自己开一层：这一次怎么处理，以及一个
 * "这门课每次都这样？"的出口通向整门课。
 *
 * 三个动作对应三件不同的事，别混：
 * - **改到别的日子/节次**：这一次换时间（还是这门课，只是这次挪了）；
 * - **这一次不上**：这一次停课（`canceled`）；
 * - **恢复**：把这次调整整个撤掉，回到整学期的原样（`dropCourseChange`）。
 *   停课时它显示成「恢复上课」—— 停课的唯一出路就是撤销，两件事是一回事。
 */
export interface CourseSlotSheetProps {
  visible: boolean;
  slot: CourseSlot | null;
  periods: readonly ClassPeriod[];
  /** 改这一次的时间（打开时间面板） */
  onChangeTime: () => void;
  /** 这一次不上 */
  onCancel: () => void;
  /** 撤销这次调整，回到整学期的样子 */
  onRestore: () => void;
  /** 去整门课的详情（改整学期） */
  onOpenCourse: () => void;
  onClose: () => void;
}

export function CourseSlotSheet({
  visible,
  slot,
  periods,
  onChangeTime,
  onCancel,
  onRestore,
  onOpenCourse,
  onClose,
}: CourseSlotSheetProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  if (!slot) return null;

  const color = courseColor(slot.course.colorIndex, dark);
  const change = slot.change ?? null;
  const canceled = change?.kind === 'canceled';
  const clock = describePeriodSpan(periods, slot.session.startPeriod, slot.session.endPeriod);
  const place = slot.session.location ?? slot.course.location;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(event) => event.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={styles.headline}>
            <View
              style={[styles.swatch, { backgroundColor: color.background, borderColor: color.border }]}
            />
            <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
              {slot.course.title}
            </ThemedText>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {/* 调过课的那一块显示的是"它现在所在的这一天" —— 用户看的就是这里 */}
            {formatMonthDay(slot.date)} {weekdayLabel(slot.date.getDay())}
            {change ? ` · ${describeChange(change)}` : ''}
          </ThemedText>

          <View style={[styles.info, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">
              {describePeriods(slot.session)}
              {clock ? ` · ${clock}` : ''}
            </ThemedText>
            {place ? (
              <ThemedText type="small" themeColor="textSecondary">
                {place}
              </ThemedText>
            ) : null}
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            {canceled
              ? '这一次已经停掉 —— 课表里那一格还留着，就是给你点回来恢复的'
              : change
                ? '改的只有这一次，别的周照旧'
                : '只改这一次，整学期的安排不动'}
          </ThemedText>

          <View style={styles.actions}>
            <Action label="改到别的日子 / 节次" onPress={onChangeTime} primary />
            <Action
              label={canceled ? '恢复上课' : '这一次不上'}
              onPress={canceled ? onRestore : onCancel}
            />
          </View>

          {change && !canceled ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRestore}
              style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
              <Ionicons name="arrow-undo-outline" size={14} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                撤销这次调整，恢复成整学期的时间
              </ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={onOpenCourse}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="small" themeColor="textSecondary">
              这门课每次都这样？去改整学期
            </ThemedText>
            <Ionicons name="chevron-forward" size={13} color={theme.textSecondary} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({
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
        styles.action,
        {
          backgroundColor: primary ? theme.text : theme.backgroundSelected,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <ThemedText type="smallBold" style={{ color: primary ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  title: { flex: 1, fontSize: 16, lineHeight: 21 },
  info: { borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, gap: 2 },
  note: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  action: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.half, paddingVertical: Spacing.one },
});
