import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 在日历上圈出一段时间之后，**只问一件事：它叫什么**（2026-10-10）。
 *
 * ## 为什么不再问一遍时间
 *
 * 用户刚刚用两根手指把时段拖出来了（或者在「新建」那里已经默认好了），
 * 这时候再弹一个"选日期、选时刻"的表单，等于告诉他"你刚才那一下白做了"。
 * 所以这张面板里没有时间输入 —— 顶部那行就是已经定下来的时段，只读。
 *
 * 地点 / 提醒 / 重复这些"想起来才加"的东西一律留给详情页：一条日程想立住，
 * 首先需要一个名字；名字以外的都能事后补，而**在创建那一刻拦住他填四样东西**
 * 是这轮最想避开的那种交互。
 *
 * 空标题不提交：日历上一块没有字的任务不是"未命名日程"，是噪音。
 * （按钮此时是灰的，用户看得见"还差点什么"。）
 */
export interface NewSpanSheetProps {
  visible: boolean;
  /** 已经定好的时段，只用来展示（如"10月10日 周六 14:00–15:00"） */
  when: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}

export function NewSpanSheet({ visible, when, onCancel, onSubmit }: NewSpanSheetProps) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  // Modal 收起动画（slide）期间内容还看得见，先留住上一次的输入，避免中途闪成空
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setShown(true);
    } else {
      const timer = setTimeout(() => setShown(false), 250);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const ready = title.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    onSubmit(title.trim());
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
                新建日程
              </ThemedText>
              <ThemedText type="smallBold">{shown ? when : ''}</ThemedText>
            </View>

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
  inputRow: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
  input: { paddingVertical: Spacing.two, fontSize: 15 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
