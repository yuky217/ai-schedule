import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { BREAKDOWN_STEP_MAX } from '@/domain/idea-breakdown';
import type { Idea } from '@/domain/idea';
import { useTheme } from '@/hooks/use-theme';

/**
 * 把一条想法拆成能动手的几步（想法页点一行就出来）。
 *
 * 为什么是面板而不是新页面：想法页上的动作只有"看一眼"和"拆开它"两件，
 * 而拆之前**必须能读到原文**（想法往往是长的一段话，列表里只显示前几行）。
 * 面板把原文和拆解放在同一屏，就不用"点进去看完了再退出来拆"。
 *
 * 输入方式刻意做成"写一条、加一条"的一行式（而不是一个大文本框让用户敲换行）：
 * 手机上敲换行要按两下，而且换行后看不出到底算几条。
 * 一行一个「加上」，写到第几条是数得出来的 —— 那个数字就是待会按钮上的数字。
 *
 * 这里的去重和上限跟领域层是**同一套口径**（`planBreakdown`），不是各写一份：
 * 面板上拦下来只是为了让用户当场看见"这条重复了"，落库前领域层还会再洗一遍。
 */
export interface IdeaBreakdownSheetProps {
  visible: boolean;
  idea: Idea | null;
  onSubmit: (steps: readonly string[]) => void;
  onClose: () => void;
}

export function IdeaBreakdownSheet({ visible, idea, onSubmit, onClose }: IdeaBreakdownSheetProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [steps, setSteps] = useState<string[]>([]);

  /**
   * 每次打开都从空白开始。
   * 不这样做的话，上一条拆到一半的步骤会留在列表里，
   * 换一条想法再拆时会被当成"这条的步骤"一起交出去 —— 而用户完全看不出。
   */
  useEffect(() => {
    if (!visible) return;
    setDraft('');
    setSteps([]);
  }, [visible]);

  if (!idea) return null;

  const full = steps.length >= BREAKDOWN_STEP_MAX;

  const addStep = () => {
    const text = draft.trim();
    if (!text || full) return;
    // 重复的直接吞掉并清空：列表里那条就摆在眼前，不需要额外弹一句"这条重复了"
    if (steps.includes(text)) {
      setDraft('');
      return;
    }
    setSteps([...steps, text]);
    setDraft('');
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

            <ThemedText type="smallBold" style={styles.title}>
              把它拆成能动手的几步
            </ThemedText>

            <View style={[styles.origin, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" numberOfLines={4}>
                {idea.content}
              </ThemedText>
            </View>

            {steps.length ? (
              <ScrollView style={styles.steps} showsVerticalScrollIndicator={false}>
                {steps.map((step, index) => (
                  <View
                    key={step}
                    style={[styles.stepRow, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.stepIndex}>
                      {index + 1}
                    </ThemedText>
                    <ThemedText type="small" style={styles.stepText}>
                      {step}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删掉第 ${index + 1} 步`}
                      hitSlop={8}
                      onPress={() => removeStep(index)}>
                      <Ionicons name="close" size={15} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                一条一步。写完之后，它们会成为一条任务下的几步，落到收集箱等你安排时间。
              </ThemedText>
            )}

            <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={addStep}
                editable={!full}
                returnKeyType="done"
                blurOnSubmit={false}
                placeholder={full ? `最多 ${BREAKDOWN_STEP_MAX} 步` : '下一步要做什么'}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="加上这一步"
                disabled={!draft.trim() || full}
                hitSlop={6}
                onPress={addStep}
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: theme.backgroundSelected,
                    opacity: !draft.trim() || full ? 0.35 : pressed ? 0.6 : 1,
                  },
                ]}>
                <Ionicons name="add" size={17} color={theme.text} />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={!steps.length}
              onPress={() => onSubmit(steps)}
              style={({ pressed }) => [
                styles.submit,
                {
                  backgroundColor: theme.text,
                  opacity: steps.length ? (pressed ? 0.75 : 1) : 0.35,
                },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                {steps.length ? `拆成 ${steps.length} 步` : '还没写步骤'}
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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
  title: { marginTop: Spacing.one },
  origin: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: Spacing.one },
  steps: { maxHeight: 216 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  stepIndex: { fontSize: 12, width: 16 },
  stepText: { flex: 1 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: Spacing.two },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
