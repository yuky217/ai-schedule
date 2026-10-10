import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ExamFields, defaultExamDraft, examDraftSpan, type ExamDraft } from '@/components/exam-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 手动加一场考试的表单（2026-10-11 从「＋」面板里搬出来）。
 *
 * ## 为什么不在日历的「＋」里了
 *
 * 试过把「日程 / 考试」做成同一张面板里的两颗切换 —— 默认日程，
 * 建日程的步数一步没多。但那颗开关挂在"新建日程"的脸面上，
 * 每次建日程都要路过一个跟自己无关的选项；而考试和日程根本是两种东西
 * （考试没有完成态、不进待办、提醒走另一套规则），硬挤一张面板
 * 只是为了省一个入口位置。入口回到"考试的家"旁边（导入考试页），
 * 面板回归纯粹：圈好一段时间，只问叫什么。
 *
 * 时刻用打字而不是滚轮、地点选填、校验不过不提交 —— 判断都在
 * `exam-fields.tsx`，这里只管把 Modal 架起来。
 */
export interface ExamSheetResult {
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
}

export interface ExamSheetProps {
  visible: boolean;
  /** 新草稿的默认日期（导入页没有"正对着的那天"，就是今天） */
  initialDate: Date;
  onCancel: () => void;
  onSubmit: (result: ExamSheetResult) => void;
}

export function ExamSheet({ visible, initialDate, onCancel, onSubmit }: ExamSheetProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<ExamDraft>(() => defaultExamDraft(initialDate));
  // Modal 收起动画（slide）期间内容还看得见，先留住上一次的输入，避免中途闪成空
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setDraft(defaultExamDraft(initialDate));
      setShown(true);
    } else {
      const timer = setTimeout(() => setShown(false), 250);
      return () => clearTimeout(timer);
    }
    // initialDate 只在打开那一刻取一次值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const span = examDraftSpan(draft);
  const ready = draft.title.trim().length > 0 && span !== null;

  const submit = () => {
    if (!ready || !span) return;
    onSubmit({
      title: draft.title.trim(),
      startAt: span.startAt,
      endAt: span.endAt,
      location: draft.location.trim() || null,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

            <View style={styles.head}>
              <ThemedText type="small" themeColor="textSecondary">
                新建考试
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                考前一天晚上提醒你
              </ThemedText>
            </View>

            <ScrollView
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <ExamFields draft={draft} onChange={setDraft} autoFocusTitle />
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onCancel}
                style={[styles.button, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  取消
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !ready }}
                disabled={!ready}
                onPress={submit}
                style={[
                  styles.button,
                  { backgroundColor: theme.text, opacity: ready ? 1 : 0.4 },
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  加上
                </ThemedText>
              </Pressable>
            </View>
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
  head: { gap: 1, marginTop: Spacing.one },
  /** 四个字段比"只问标题"高不少，键盘起来时得能滚 */
  scroll: { maxHeight: 320 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
