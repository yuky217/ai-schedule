import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { CourseSessionSheet } from '@/components/course-session-sheet';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import {
  describePeriods,
  describeWeeks,
  sanitizeSessions,
  weekdayLabel,
  type Course,
  type CourseSession,
} from '@/domain/course';
import { colorIndexOf } from '@/domain/factory';
import { describePeriodSpan } from '@/domain/timetable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 课程详情。
 *
 * 立场跟任务详情页一样：**列表只做"看一眼 + 勾一下"，改东西全在这里**。
 * 课表的格子太小，放不下任何编辑动作，点一下就进这里。
 *
 * 课名、教师、地点是"改一个字就保存"（没有保存按钮）—— 这些字段不值得
 * 让用户多点一次；已有的时段只给删不给改（改时间意味着"这课换时间了"，
 * 重新导入一次课表比在手机上逐格调更快也更准）。
 *
 * **例外**：这门课一段时段都没有的时候，"加一段"是唯一的出路 ——
 * 教务系统里那些没排时间的课（实践/网课/待定）就靠它补上，
 * 不给这个入口的话它们永远是"没有时间的课"。
 */
export default function CourseDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';

  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const courses = useAppStore((state) => state.courses);
  const term = useAppStore((state) => state.term);
  const saveCourse = useAppStore((state) => state.saveCourse);
  const removeCourse = useAppStore((state) => state.removeCourse);

  const course = courses.find((item) => item.id === id) ?? null;
  const [removing, setRemoving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const patch = useCallback(
    async (changes: Partial<Course>) => {
      if (!course) return;
      await saveCourse({ ...course, ...changes });
    },
    [course, saveCourse],
  );

  if (!course) {
    return (
      <Screen title="课程">
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            这门课不在了（可能已经被删掉，或者课表重新导入过）。
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <ThemedText type="small">返回</ThemedText>
          </Pressable>
        </Card>
      </Screen>
    );
  }

  const color = courseColor(course.colorIndex, dark);
  const periods = term?.periods ?? [];

  const dropSession = (target: CourseSession) => {
    const sessions = course.sessions.filter((session) => session !== target);
    void patch({ sessions });
  };

  return (
    <Screen
      title="课程"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      <View style={styles.headline}>
        <View
          style={[styles.swatch, { backgroundColor: color.background, borderColor: color.border }]}
        />
        <TextInput
          defaultValue={course.title}
          onEndEditing={(event) => {
            const next = event.nativeEvent.text.trim();
            if (!next || next === course.title) return;
            // 颜色由课名决定，改名会跟着换色 —— 页脚里写明了这一点
            void patch({ title: next, colorIndex: colorIndexOf(next) });
          }}
          style={[styles.titleInput, { color: theme.text }]}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        色块的颜色跟着课名走，改名字会换色 —— 同一门课在任何地方都是同一个颜色。
      </ThemedText>

      <Card title="基本信息">
        <FieldRow
          label="教师"
          value={course.teacher ?? ''}
          placeholder="谁上的"
          onSave={(value) => void patch({ teacher: value || null })}
        />
        <FieldRow
          label="地点"
          value={course.location ?? ''}
          placeholder="在哪上"
          onSave={(value) => void patch({ location: value || null })}
        />
      </Card>

      <Card
        title={course.sessions.length ? `上课时间 · ${course.sessions.length} 段` : '上课时间'}
        hint={
          course.sessions.length
            ? '换时间了就重新导入一次课表，比在这里一格一格改快'
            : '这类课（实践、网课、时间待定）教务系统里本来就不排时间 —— 知道的时候补上就行'
        }
        right={
          <Pressable hitSlop={8} onPress={() => setSheetOpen(true)}>
            <View style={styles.addRow}>
              <Ionicons name="add" size={14} color={theme.text} />
              <ThemedText type="small">加一段</ThemedText>
            </View>
          </Pressable>
        }>
        {course.sessions.length ? (
          course.sessions.map((session, index) => {
            const clock = describePeriodSpan(periods, session.startPeriod, session.endPeriod);
            const place = session.location ?? course.location;
            return (
              <View
                key={`${session.weekday}-${session.startPeriod}-${session.endPeriod}-${index}`}
                style={styles.sessionRow}>
                <View style={styles.sessionText}>
                  <ThemedText type="smallBold">
                    {weekdayLabel(session.weekday)} {describePeriods(session)}
                    {clock ? ` · ${clock}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.sessionMeta}>
                    {describeWeeks(session.weeks, term?.totalWeeks)}
                    {session.location ? ` · 换到 ${session.location}` : place ? ` · ${place}` : ''}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="删掉这一段"
                  hitSlop={8}
                  onPress={() => dropSession(session)}>
                  <Ionicons name="remove-circle-outline" size={20} color={theme.textSecondary} />
                </Pressable>
              </View>
            );
          })
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)}>
            <ThemedText type="small">还没有上课时间 —— 点这里补上一段</ThemedText>
          </Pressable>
        )}
      </Card>

      <CourseSessionSheet
        visible={sheetOpen}
        totalWeeks={term?.totalWeeks ?? 18}
        periodCount={term?.periods.length}
        onClose={() => setSheetOpen(false)}
        onSubmit={(session) => {
          void patch({ sessions: sanitizeSessions([...course.sessions, session]) });
          setSheetOpen(false);
        }}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (removing) return;
          setRemoving(true);
          void removeCourse(course.id).then(() => router.back());
        }}
        style={({ pressed }) => [styles.danger, { opacity: pressed || removing ? 0.6 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
          {removing ? '正在删除…' : '删掉这门课'}
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

/** 一行"标签 + 输入框"，失焦即保存（没有保存按钮） */
function FieldRow({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fieldRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <TextInput
        defaultValue={value}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        onEndEditing={(event) => onSave(event.nativeEvent.text.trim())}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  swatch: { width: 22, height: 22, borderRadius: 6, borderWidth: 1 },
  titleInput: { flex: 1, fontSize: 22, lineHeight: 30, fontWeight: '600', paddingVertical: Spacing.one },
  hint: { fontSize: 12, lineHeight: 17, opacity: 0.7 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fieldLabel: { width: 32 },
  input: {
    flex: 1,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.half },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  sessionText: { flex: 1, gap: 1 },
  sessionMeta: { fontSize: 12, lineHeight: 17 },
  danger: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
