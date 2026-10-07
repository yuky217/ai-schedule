import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { CourseSessionSheet } from '@/components/course-session-sheet';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeWeeks, weekdayLabel, type CourseSession } from '@/domain/course';
import { createCourse } from '@/domain/factory';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 手动添加一门课。
 *
 * 为什么必须有这一页：粘贴导入再宽容，也总有认不出来的时候（学校换了教务系统、
 * 只导出了图片、课表压根没有电子版）。WakeUp 课程表、超级课程表这类成熟软件
 * 都把手动添加作为**兜底出口** —— 没有它，导入失败就是死路一条。
 *
 * 只要求一个课程名：地点、教师、上课时间都可以留空。留空的课会出现在课表的
 * "还没有上课时间"清单里，随时能回来补 —— 这比强迫用户当场填完所有字段友好。
 */
export default function AddCourseScreen() {
  const theme = useTheme();
  const router = useRouter();

  const term = useAppStore((state) => state.term);
  const saveCourse = useAppStore((state) => state.saveCourse);

  const [title, setTitle] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const ready = title.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    await saveCourse(
      createCourse({
        title: title.trim(),
        teacher: teacher.trim() || null,
        location: location.trim() || null,
        sessions,
      }),
    );
    router.back();
  };

  return (
    <Screen
      title="添加课程"
      subtitle="导入认不出来的时候，手填一门"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      <View style={styles.headline}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="课程名（必填）"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          style={[styles.titleInput, { color: theme.text }]}
        />
      </View>

      <Card title="基本信息">
        <FieldRow label="教师" value={teacher} onChangeText={setTeacher} placeholder="谁上的" />
        <FieldRow label="地点" value={location} onChangeText={setLocation} placeholder="在哪上" />
      </Card>

      <Card
        title={sessions.length ? `上课时间 · ${sessions.length} 段` : '上课时间'}
        hint="还不知道什么时候上就先空着 —— 之后在课表里点这门课能补上"
        right={
          <Pressable hitSlop={8} onPress={() => setSheetOpen(true)}>
            <View style={styles.addRow}>
              <Ionicons name="add" size={14} color={theme.text} />
              <ThemedText type="small">加一段</ThemedText>
            </View>
          </Pressable>
        }>
        {sessions.length ? (
          sessions.map((session, index) => (
            <View key={`${session.weekday}-${session.startPeriod}-${index}`} style={styles.sessionRow}>
              <View style={styles.sessionText}>
                <ThemedText type="smallBold">
                  {weekdayLabel(session.weekday)} 第 {session.startPeriod}-{session.endPeriod} 节
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.sessionMeta}>
                  {describeWeeks(session.weeks, term?.totalWeeks)}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="删掉这一段"
                hitSlop={8}
                onPress={() => setSessions((list) => list.filter((item) => item !== session))}>
                <Ionicons name="remove-circle-outline" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            还没填 —— 加一段，或者先保存、之后在课表里补。
          </ThemedText>
        )}
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => void submit()}
        style={[styles.primary, { backgroundColor: theme.text, opacity: ready ? 1 : 0.35 }]}>
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          保存
        </ThemedText>
      </Pressable>

      <CourseSessionSheet
        visible={sheetOpen}
        totalWeeks={term?.totalWeeks ?? 18}
        periodCount={term?.periods.length}
        onClose={() => setSheetOpen(false)}
        onSubmit={(session) => {
          setSessions((list) => [...list, session]);
          setSheetOpen(false);
        }}
      />
    </Screen>
  );
}

function FieldRow({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fieldRow}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  titleInput: { flex: 1, fontSize: 22, lineHeight: 30, fontWeight: '600', paddingVertical: Spacing.one },
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
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.half },
  sessionText: { flex: 1, gap: 1 },
  sessionMeta: { fontSize: 12, lineHeight: 17 },
  primary: { alignItems: 'center', paddingVertical: Spacing.three, borderRadius: Spacing.three },
});
