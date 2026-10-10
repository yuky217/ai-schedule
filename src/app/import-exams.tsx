import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeEvent, type CalEvent } from '@/domain/event';
import { CaptureSource } from '@/domain/enums';
import { examDraftToEvent, parseExamText } from '@/domain/exam-text';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 导入考试。
 *
 * 与导入课表同一条路：教务网页复制 → 粘贴 → 预览核对 → 替换导入。
 * 导入策略同样是**替换**（按钮上写清楚会替换几场，不加二次确认弹窗）——
 * 考试安排一个学期查一次，重新查询后重新导入就是常规动作。
 *
 * 考试与课程分开导入：它们是两个不同的查询页，文本长相完全不同，
 * 一个解析器包两种格式只会两个都变得脆弱。
 */

const TEXT_TIPS = [
  '在教务系统「考试信息查询」页长按表格 → 全选 → 拷贝，回到这里粘贴',
  '选不中的话：先截图，再到相册里打开那张图，长按上面的文字选中复制',
  '手机上不顺就借电脑：教务系统里复制，微信发给自己，手机上粘贴',
];

export default function ImportExamsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const events = useAppStore((state) => state.events);
  const importEvents = useAppStore((state) => state.importEvents);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    return parseExamText(text);
  }, [text]);

  const drafts = result?.exams ?? [];
  const ready = drafts.length > 0 && !busy;

  /**
   * 库里的考试分两类，导入对它们的态度不一样：
   * **之前导入的会被替换掉，手动加的一场都不动**（补考/重修本来就查不到，
   * 被"替换"清掉是静默丢数据 —— 见 `eventRepository.softDeleteImported`）。
   * 所以按钮和脚注都得把这两个数分开说，否则用户没法预判自己那几场会怎样。
   */
  const importedCount = useMemo(
    () => events.filter((event) => event.source !== CaptureSource.Manual).length,
    [events],
  );
  const manualCount = events.length - importedCount;

  const footNote = !events.length
    ? null
    : importedCount && manualCount
      ? `导入会替换掉之前导入的 ${importedCount} 场；你自己加的 ${manualCount} 场会留着。`
      : importedCount
        ? `导入会替换掉现有的 ${importedCount} 场考试。重新查询后整体导入正好这样用。`
        : `你自己加的 ${manualCount} 场不会被这次导入动到。`;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const entities: CalEvent[] = drafts.map(examDraftToEvent);
    await importEvents(entities, { replace: true });
    setBusy(false);
    router.back();
  };

  return (
    <Screen
      title="导入考试"
      subtitle="把教务系统查到的考试安排复制过来，粘进去就行"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      {/* 粘贴区 */}
      <Card
        title="考试安排文本"
        hint="一行一场考试也能认。只取课程名、时间、地点，其余列自动丢弃"
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
          placeholder={'2025-2026  2  高等数学  2026-07-08(14:30-16:30)  教B216  …\n2025-2026  2  线性代数  2026-06-29(09:00-11:00)  教C402  …'}
          placeholderTextColor={theme.textSecondary}
          multiline
          textAlignVertical="top"
          style={[
            styles.textarea,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />

        {!text ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTipsOpen((open) => !open)}
              hitSlop={8}
              style={({ pressed }) => [styles.tipsToggle, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons
                name={tipsOpen ? 'chevron-up' : 'help-circle-outline'}
                size={13}
                color={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.tipsToggleText}>
                在手机上怎么拿到这段文本？
              </ThemedText>
            </Pressable>
            {tipsOpen ? (
              <View style={styles.tips}>
                {TEXT_TIPS.map((tip) => (
                  <ThemedText key={tip} type="small" themeColor="textSecondary" style={styles.tip}>
                    · {tip}
                  </ThemedText>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* 预览：先核对再写库 */}
      {result ? (
        <Card
          title={
            drafts.length
              ? `识别到 ${drafts.length} 场考试`
              : '没认出考试'
          }
          hint={
            drafts.length
              ? '核对一下，没问题就导入；每场会在考前一天 20:00 提醒你'
              : '粘的内容里没找到「2026-07-08(14:30-16:30)」这样的考试时间'
          }>
          {result.problems.length ? (
            <View style={styles.problems}>
              {result.problems.slice(0, 6).map((problem) => (
                <ThemedText key={problem} type="small" themeColor="textSecondary" style={styles.problem}>
                  · {problem}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {drafts.map((draft) => {
            const entity = examDraftToEvent(draft);
            return (
              <View key={`${draft.title}-${draft.startAt}`} style={styles.examRow}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.grow}>
                  {draft.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {describeEvent(entity)}
                </ThemedText>
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
            : drafts.length
              ? importedCount
                ? `导入 ${drafts.length} 场，替换之前的 ${importedCount} 场`
                : `导入 ${drafts.length} 场考试`
              : '先粘文本'}
        </ThemedText>
      </Pressable>

      {footNote ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {footNote}
        </ThemedText>
      ) : null}

      <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
        教务系统里查不到的（补考、重修、随堂测验）：在日历右下角「＋」里选「考试」自己加。
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  textarea: {
    minHeight: 132,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 13,
    lineHeight: 18,
  },
  tipsToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.one },
  tipsToggleText: { fontSize: 12 },
  tips: { gap: Spacing.half, paddingTop: Spacing.half },
  tip: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  problems: { gap: Spacing.half },
  problem: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  examRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  grow: { flex: 1 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  footnote: { fontSize: 12, lineHeight: 17, opacity: 0.75 },
});
