import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import { describeSession, guessTermLabel, mondayOfWeek } from '@/domain/course';
import { parseCourseText } from '@/domain/course-text';
import { colorIndexOf, createCourse } from '@/domain/factory';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { toDayKey } from '@/utils/datetime';

/**
 * 导入课表。
 *
 * 为什么把"学期设置"也放在这一页：开学日是课表的**必要输入**（没有它就算不出
 * 第几周），把它拆成另一个页面意味着用户要来回跳两次才看得到第一张课表。
 * 而且这里三个字段的默认值**已经是对的**（学期名按当前日期推、开学日默认本周一、
 * 18 周）—— 直接粘文本点导入就行，一个字都不用填。
 *
 * 导入策略：**替换**。按钮上写清楚会替换掉几门课，用户点之前就知道结果，
 * 所以不再加二次确认弹窗（多一次点击换不来更多安全感）。
 */
export default function ImportCoursesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';

  const term = useAppStore((state) => state.term);
  const courses = useAppStore((state) => state.courses);
  const importCourses = useAppStore((state) => state.importCourses);
  const saveTerm = useAppStore((state) => state.saveTerm);

  const [label, setLabel] = useState(() => term?.label ?? guessTermLabel());
  const [startDayKey, setStartDayKey] = useState(
    () => term?.startDayKey ?? toDayKey(mondayOfWeek(new Date())),
  );
  const [totalWeeksText, setTotalWeeksText] = useState(() => String(term?.totalWeeks ?? 18));
  const [pickerOpen, setPickerOpen] = useState(false);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const totalWeeks = Math.min(30, Math.max(1, Number(totalWeeksText) || 18));

  const result = useMemo(() => {
    if (!text.trim()) return null;
    return parseCourseText(text, { defaultWeeks: { start: 1, end: totalWeeks } });
  }, [text, totalWeeks]);

  const drafted = result?.courses ?? [];
  const sessionCount = drafted.reduce((n, course) => n + course.sessions.length, 0);
  const ready = drafted.length > 0 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    await saveTerm({ label: label.trim() || guessTermLabel(), startDayKey, totalWeeks });
    await importCourses(
      drafted.map((draft) =>
        createCourse({
          title: draft.title,
          teacher: draft.teacher,
          location: draft.location,
          sessions: draft.sessions,
        }),
      ),
      { replace: true },
    );
    setBusy(false);
    router.back();
  };

  return (
    <Screen
      title="导入课表"
      subtitle="从教务系统复制过来，粘进去就行"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      {/* 学期：三个字段的默认值都已经是对的，正常情况下不用碰 */}
      <Card title="学期" hint="开学日填第 1 周的周一 —— 有它才能算出每节课是第几周">
        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            学期
          </ThemedText>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={guessTermLabel()}
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              styles.grow,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen((open) => !open)}
          style={({ pressed }) => [
            styles.fieldRow,
            { opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            开学
          </ThemedText>
          <ThemedText type="small">{startDayKey.replace(/-/g, '/')}</ThemedText>
          <View style={styles.grow} />
          <Ionicons
            name={pickerOpen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.textSecondary}
          />
        </Pressable>
        {pickerOpen ? (
          <MonthPicker
            value={startDayKey}
            onChange={(key) => {
              // 开学日必须有值（没有它整张课表都算不出来），所以 null 直接忽略
              if (key) setStartDayKey(key);
            }}
            onDone={() => setPickerOpen(false)}
          />
        ) : null}

        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            共
          </ThemedText>
          <TextInput
            value={totalWeeksText}
            onChangeText={setTotalWeeksText}
            onEndEditing={() => setTotalWeeksText(String(totalWeeks))}
            keyboardType="number-pad"
            style={[
              styles.input,
              styles.weeksInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            周（没写周次的课按这个补齐）
          </ThemedText>
        </View>
      </Card>

      {/* 粘贴区 */}
      <Card
        title="课表文本"
        hint="在教务系统课表页 Ctrl+A 全选、复制，粘到下面 —— 表格和一行一门课都认"
        right={
          text ? (
            <Pressable hitSlop={8} onPress={() => setText('')}>
              <ThemedText type="small" themeColor="textSecondary">
                清空
              </ThemedText>
            </Pressable>
          ) : undefined
        }>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'周一\n1-2节 高等数学 教一101 张三 1-16周\n3-4节 大学物理 教二203 李四 1-8周'}
          placeholderTextColor={theme.textSecondary}
          multiline
          textAlignVertical="top"
          style={[
            styles.textarea,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />
      </Card>

      {/* 预览：先让用户核对，再写库 */}
      {result ? (
        <Card
          title={
            drafted.length
              ? sessionCount
                ? `识别到 ${drafted.length} 门课 · ${sessionCount} 条上课时间`
                : `读到 ${drafted.length} 门课，但都没有上课时间`
              : '没认出课程'
          }
          hint={drafted.length ? '核对一下，没问题就导入' : '换个复制方式，或者用下面的「手动添加」'}>
          {result.problems.length ? (
            <View style={styles.problems}>
              {result.problems.map((problem) => (
                <ThemedText key={problem} type="small" themeColor="textSecondary" style={styles.problem}>
                  · {problem}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {drafted.map((draft) => {
            const color = courseColor(colorIndexOf(draft.title), dark);
            return (
              <View key={draft.title} style={styles.course}>
                <View style={styles.courseHead}>
                  <View style={[styles.dot, { backgroundColor: color.background, borderColor: color.border }]} />
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.grow}>
                    {draft.title}
                  </ThemedText>
                  {draft.teacher ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {draft.teacher}
                    </ThemedText>
                  ) : null}
                </View>
                {draft.sessions.length ? (
                  draft.sessions.map((session, index) => (
                    <ThemedText
                      key={`${session.weekday}-${session.startPeriod}-${index}`}
                      type="small"
                      themeColor="textSecondary"
                      style={styles.session}>
                      {describeSession(session, totalWeeks)}
                      {session.location ?? draft.location ? ` · ${session.location ?? draft.location}` : ''}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.session}>
                    没有上课时间
                  </ThemedText>
                )}
                {draft.warnings.map((warning) => (
                  <ThemedText key={warning} type="small" themeColor="textSecondary" style={styles.warning}>
                    ⚠ {warning}
                  </ThemedText>
                ))}
              </View>
            );
          })}
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: theme.text, opacity: !ready ? 0.35 : pressed ? 0.8 : 1 },
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          {busy
            ? '正在导入…'
            : courses.length
              ? `导入并替换现有 ${courses.length} 门课`
              : drafted.length
                ? `导入 ${drafted.length} 门课`
                : '导入'}
        </ThemedText>
      </Pressable>

      {/* 认不出来时的兜底出口 —— 成熟课表软件（WakeUp、超级课程表）都留着这一步 */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/add-course')}
        style={({ pressed }) => [
          styles.secondary,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
        ]}>
        <ThemedText type="small">认不出来？手动添加一门</ThemedText>
      </Pressable>

      {courses.length ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          导入会替换掉现在的 {courses.length} 门课（连同手改过的教师/地点）。换学期时正好这样用；只想加一门的话，建议先在课表里删掉那门再整体导入。
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 32,
  },
  fieldLabel: { width: 32 },
  grow: { flex: 1 },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  weeksInput: { width: 56, textAlign: 'center' },
  textarea: {
    minHeight: 132,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 13,
    lineHeight: 18,
  },
  problems: { gap: Spacing.half },
  problem: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  course: { gap: 2, paddingVertical: Spacing.one },
  courseHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  session: { fontSize: 12, lineHeight: 17, paddingLeft: Spacing.four },
  warning: { fontSize: 12, lineHeight: 17, paddingLeft: Spacing.four, opacity: 0.8 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  footnote: { fontSize: 12, lineHeight: 17, opacity: 0.75 },
});
