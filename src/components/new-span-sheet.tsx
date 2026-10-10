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

import { ExamFields, defaultExamDraft, examDraftSpan, type ExamDraft } from '@/components/exam-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 在日历上圈出一段时间之后，**只问一件事：它叫什么**（2026-10-10）。
 *
 * ## 为什么不再问一遍时间
 *
 * 用户刚刚用两根手指把时段拖出来了（或者在「＋」那里已经默认好了），
 * 这时候再弹一个"选日期、选时刻"的表单，等于告诉他"你刚才那一下白做了"。
 * 所以这张面板里没有时间输入 —— 顶部那行就是已经定下来的时段，只读。
 *
 * 地点 / 提醒 / 重复这些"想起来才加"的东西一律留给详情页：一条日程想立住，
 * 首先需要一个名字；名字以外的都能事后补，而**在创建那一刻拦住他填四样东西**
 * 是这轮最想避开的那种交互。
 *
 * ## 「日程 | 考试」这个开关（2026-10-10 补）
 *
 * 考试和日程不是一回事：它没有完成态、不进待办、提醒走另一套规则
 * （前一天 20:00，见 `domain/event-reminder`），而且**手动加的那几场
 * 恰恰是教务系统里查不到的**（补考、重修、随堂测验）—— 没有这个开关，
 * 用户就只剩"改一条日程凑合"这一条歪路。
 *
 * 为什么塞进同一张面板而不是再做一个「＋」：位置是同一个（日历上"我要加件事"），
 * 而且**建日程的步数一步都没多** —— 默认就是日程，直接打字走人。
 * 多出来的只有"要建考试时多切一下"。
 *
 * 时间轴上拖出来的那段**不给这个开关**（`allowExam` 只有「＋」传 true）：
 * 拖一段的语义是"这段时间被占住了"，那就是日程；考试得自己填日期和时刻。
 */
export type NewSpanResult =
  | { kind: 'schedule'; title: string }
  | { kind: 'exam'; title: string; startAt: string; endAt: string; location: string | null };

export interface NewSpanSheetProps {
  visible: boolean;
  /** 已经定好的时段，只用来展示（如"10月10日 周六 14:00–15:00"） */
  when: string;
  /** 允许切成"考试"。只有「＋」进来时给 true */
  allowExam?: boolean;
  /** 考试态的默认日期（当前视图正对着的那天） */
  examDate: Date;
  onCancel: () => void;
  onSubmit: (result: NewSpanResult) => void;
}

type Kind = 'schedule' | 'exam';

export function NewSpanSheet({
  visible,
  when,
  allowExam,
  examDate,
  onCancel,
  onSubmit,
}: NewSpanSheetProps) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('schedule');
  const [examDraft, setExamDraft] = useState<ExamDraft>(() => defaultExamDraft(examDate));
  // Modal 收起动画（slide）期间内容还看得见，先留住上一次的输入，避免中途闪成空
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setKind('schedule');
      setExamDraft(defaultExamDraft(examDate));
      setShown(true);
    } else {
      const timer = setTimeout(() => setShown(false), 250);
      return () => clearTimeout(timer);
    }
    // examDate 只在打开那一刻取一次值：面板开着的时候它不该变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * 换类型时把已经打好的名字带过去。
   *
   * 用户多半是先打了名字才发现"这是场考试" —— 切一下名字还在，
   * 才叫切换；清空重打那叫惩罚。
   */
  const switchKind = (next: Kind) => {
    if (next === kind) return;
    if (next === 'exam') setExamDraft((draft) => ({ ...draft, title }));
    else setTitle(examDraft.title);
    setKind(next);
  };

  const examSpan = examDraftSpan(examDraft);
  const examTitle = examDraft.title.trim();
  const ready = kind === 'schedule' ? title.trim().length > 0 : examTitle.length > 0 && examSpan !== null;

  const submit = () => {
    if (!ready) return;
    if (kind === 'schedule') {
      onSubmit({ kind: 'schedule', title: title.trim() });
      return;
    }
    if (!examSpan) return;
    onSubmit({
      kind: 'exam',
      title: examTitle,
      startAt: examSpan.startAt,
      endAt: examSpan.endAt,
      location: examDraft.location.trim() || null,
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
                {kind === 'schedule' ? '新建日程' : '新建考试'}
              </ThemedText>
              {kind === 'schedule' ? (
                <ThemedText type="smallBold">{shown ? when : ''}</ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  考前一天晚上提醒你
                </ThemedText>
              )}
            </View>

            {allowExam ? (
              <View style={styles.kinds}>
                <KindChip label="日程" active={kind === 'schedule'} onPress={() => switchKind('schedule')} />
                <KindChip label="考试" active={kind === 'exam'} onPress={() => switchKind('exam')} />
              </View>
            ) : null}

            {kind === 'schedule' ? (
              <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  autoFocus
                  value={title}
                  onChangeText={setTitle}
                  onSubmitEditing={submit}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  placeholder="做什么？"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text }]}
                />
              </View>
            ) : (
              <ScrollView
                style={styles.examScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                <ExamFields draft={examDraft} onChange={setExamDraft} autoFocusTitle />
              </ScrollView>
            )}

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
                  建好
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 类型开关的一颗。选中用实心反白 —— 与详情页那些"日程 / 截止"的选择器一个长相 */
function KindChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.background,
          borderColor: active ? theme.text : theme.backgroundSelected,
        },
      ]}>
      <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
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
  kinds: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inputRow: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
  input: { paddingVertical: Spacing.two, fontSize: 15 },
  /** 考试字段比日程多三行，键盘起来时得能滚 */
  examScroll: { maxHeight: 300 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
