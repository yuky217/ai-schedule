import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 通用的"单选一层"底部面板。
 *
 * 提醒、重复、清单这几个快捷设置都是"从一组固定选项里挑一个"，
 * 与其写三份几乎一样的 Modal，不如共用这一份 —— 高度一致的手感也来自这里
 * （点一下选中并立刻收起，不做二次确认）。
 */
export interface ChoiceOption {
  key: string;
  label: string;
  /** 右侧的次要说明 */
  hint?: string;
}

export interface ChoiceSheetProps {
  visible: boolean;
  title: string;
  options: readonly ChoiceOption[];
  /** 当前选中项的 key */
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function ChoiceSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
}: ChoiceSheetProps) {
  const theme = useTheme();
  // Modal 关闭后 animationType="slide" 期间内容会被看到，清空避免闪一下旧选项
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) setShown(true);
    else {
      const timer = setTimeout(() => setShown(false), 250);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <ThemedText type="smallBold" style={styles.title}>
            {title}
          </ThemedText>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {shown
              ? options.map((option) => {
                  const active = option.key === selectedKey;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => onSelect(option.key)}
                      style={[
                        styles.row,
                        {
                          backgroundColor: active
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                      ]}>
                      <ThemedText type="small" themeColor={active ? 'text' : undefined}>
                        {option.label}
                      </ThemedText>
                      {option.hint ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {option.hint}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                  );
                })
              : null}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.cancel, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              取消
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
  title: { marginTop: Spacing.one, marginBottom: Spacing.one },
  body: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
});
