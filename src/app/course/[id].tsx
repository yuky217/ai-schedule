import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ChoiceSheet } from '@/components/choice-sheet';
import { CourseSessionSheet } from '@/components/course-session-sheet';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import {
  describeChange,
  describePeriods,
  describeWeeks,
  replaceSession,
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
 * 让用户多点一次。
 *
 * 上课时间（下面那张卡）：**点某一段 = 改它**（星期/节次/周次都能改），
 * 右侧那个 ⊖ 才是删。改和删都不带二次确认 —— 它们都看得见结果，
 * 而"再问一遍"会把一次点击变成两次（第一原则）。
 * 课表网格里长按拖课块改的是星期/节次，这里多给的是**周次**（拖拽改不了它）。
 * 一段都没有的课（实践/网课/时间待定）靠右上角「加一段」补上 ——
 * 没这个入口它们永远是"没有时间的课"。
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
  /**
   * 面板正在改第几段（null = 新增一段）。
   * 一个状态同时装"开没开"和"改哪段"会再多一层判断，拆成两个变量反而清楚。
   */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const openSheet = (index: number | null) => {
    setEditingIndex(index);
    setSheetOpen(true);
  };

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
        title="上课提醒"
        hint={
          term
            ? '只排未来 7 天的课；课表一改，提醒会自动重排'
            : '还没设开学日 —— 算不出上课时刻，先在课表页脚进「学期」把它填上'
        }>
        <Pressable
          accessibilityRole="button"
          onPress={() => setReminderOpen(true)}
          style={({ pressed }) => [styles.reminderRow, { opacity: pressed ? 0.6 : 1 }]}>
          <ThemedText type="small">{describeCourseReminder(course.reminderMinutesBefore)}</ThemedText>
          <View style={styles.spacer} />
          <ThemedText type="small" themeColor="textSecondary">
            点一下改
          </ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
        </Pressable>
      </Card>

      <ChoiceSheet
        visible={reminderOpen}
        title="上课前多久提醒"
        selectedKey={course.reminderMinutesBefore == null ? 'off' : String(course.reminderMinutesBefore)}
        options={REMINDER_OPTIONS}
        onSelect={(key) => {
          void patch({ reminderMinutesBefore: key === 'off' ? null : Number(key) });
          setReminderOpen(false);
        }}
        onClose={() => setReminderOpen(false)}
      />

      <Card
        title={course.sessions.length ? `上课时间 · ${course.sessions.length} 段` : '上课时间'}
        hint={
          course.sessions.length
            ? '点某一段可以改它'
            : '这类课（实践、网课、时间待定）教务系统里本来就不排时间 —— 知道的时候补上就行'
        }
        right={
          <Pressable hitSlop={8} onPress={() => openSheet(null)}>
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`改这一段：${weekdayLabel(session.weekday)} ${describePeriods(session)}`}
                  onPress={() => openSheet(index)}
                  style={({ pressed }) => [styles.sessionText, { opacity: pressed ? 0.55 : 1 }]}>
                  <ThemedText type="smallBold">
                    {weekdayLabel(session.weekday)} {describePeriods(session)}
                    {clock ? ` · ${clock}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.sessionMeta}>
                    {describeWeeks(session.weeks, term?.totalWeeks)}
                    {session.location ? ` · 换到 ${session.location}` : place ? ` · ${place}` : ''}
                  </ThemedText>
                </Pressable>
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
          <Pressable accessibilityRole="button" onPress={() => openSheet(null)}>
            <ThemedText type="small">还没有上课时间 —— 点这里补上一段</ThemedText>
          </Pressable>
        )}

        {/*
          单次调整（调课/停课）是**按天**的，不在这张"整学期"的列表里 ——
          所以这里点一句，让用户知道自己调过几次、都调成了什么样，
          以及去哪儿改回来。少了这句，从课程详情看过去就像"我那次调课丢了"。
        */}
        {course.changes?.length ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.changeNote}>
            {`另有 ${course.changes.length} 次单次调整 · ${course.changes
              .slice(0, 2)
              .map(describeChange)
              .join('；')}${course.changes.length > 2 ? ' …' : ''}`}
            {'（在课表里点那一块就能改回来）'}
          </ThemedText>
        ) : null}
      </Card>

      <CourseSessionSheet
        visible={sheetOpen}
        totalWeeks={term?.totalWeeks ?? 18}
        periodCount={term?.periods.length}
        initial={editingIndex == null ? null : course.sessions[editingIndex] ?? null}
        onClose={() => setSheetOpen(false)}
        onSubmit={(session) => {
          void patch({
            sessions:
              editingIndex == null
                ? sanitizeSessions([...course.sessions, session])
                : replaceSession(course.sessions, editingIndex, session),
          });
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

/**
 * 提前量的可选项。
 *
 * 为什么默认是 15 分钟而不是"不提醒"：用户导课表图的就是"别错过课"。
 * 默认关掉等于把"要不要提醒"这个决定又推回给他，而他得先知道有这个开关
 * 才可能去开 —— 15 分钟够从宿舍走到教室，不想要的人在这里点一下关掉。
 */
const REMINDER_OPTIONS = [
  { key: 'off', label: '不提醒' },
  { key: '0', label: '上课时提醒', hint: '准点' },
  { key: '5', label: '提前 5 分钟' },
  { key: '10', label: '提前 10 分钟' },
  { key: '15', label: '提前 15 分钟', hint: '默认' },
  { key: '30', label: '提前半小时' },
  { key: '60', label: '提前 1 小时' },
];

function describeCourseReminder(minutes: number | null | undefined): string {
  if (minutes == null) return '不提醒';
  if (minutes <= 0) return '上课时提醒';
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时提醒`;
  return `提前 ${minutes} 分钟提醒`;
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
  changeNote: { fontSize: 12, lineHeight: 17, marginTop: Spacing.one },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one },
  spacer: { flex: 1 },
  danger: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
