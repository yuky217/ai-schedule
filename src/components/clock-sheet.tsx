import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TimeWheel } from '@/components/time-wheel';
import { Spacing } from '@/constants/theme';
import { describeClock, parseClock } from '@/domain/timetable';
import { useTheme } from '@/hooks/use-theme';

/**
 * 只挑"几点几分"的底部面板。
 *
 * 为什么不复用 `DateTimeSheet`：那个是为**任务**做的，带"日程/截止"切换和
 * 一整块月历 —— 作息表里每一节都只有一个钟点，没有日期、也没有那种语义。
 * 硬套上去会让"改一下第三节的上课时间"这件事变成要先跨过两个不相干的控件。
 *
 * 直接输文字也能进：作息表上的时刻用户心里是**现成的数字**（"我们上午 8:20 开始"），
 * 让他滚 8 下小时轮、再滚 20 下分钟轮，不如让他打"8:20"四个字符。
 * 两种入口并存，谁顺手用谁。
 */
export interface ClockSheetProps {
  visible: boolean;
  title: string;
  /** 当天第几分钟 */
  minutesOfDay: number;
  onConfirm: (minutesOfDay: number) => void;
  onClose: () => void;
}

/** 常见档：整点、半点、以及国内常见的 5 分钟刻度 */
const QUICK_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

export function ClockSheet({ visible, title, minutesOfDay, onConfirm, onClose }: ClockSheetProps) {
  const theme = useTheme();
  /** 滚轮按住时关掉本页滚动（Android 上外层会把手势全吃掉，见 TimeWheel 文件头） */
  const [wheelLocked, setWheelLocked] = useState(false);
  /** 拖到哪儿算哪儿：点「完成」才写回去，中途收起等于没改 */
  const [draft, setDraft] = useState(minutesOfDay);
  /** 手输的文本；失焦/回车时解析，认不出就不动 */
  const [text, setText] = useState(() => describeClock(minutesOfDay));

  useEffect(() => {
    if (!visible) return;
    setDraft(minutesOfDay);
    setText(describeClock(minutesOfDay));
  }, [visible, minutesOfDay]);

  /** 文本 → 草稿。认不出来就原样退回，不把用户打错的东西当成新值。 */
  const applyText = () => {
    const parsed = parseClock(text);
    if (parsed == null) {
      setText(describeClock(draft));
      return;
    }
    setDraft(parsed);
    setText(describeClock(parsed));
  };

  const commit = () => {
    const parsed = parseClock(text);
    const next = parsed ?? draft;
    onConfirm(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={styles.header}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
              {title}
            </ThemedText>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            scrollEnabled={!wheelLocked}
            style={styles.body}>
            <View style={styles.textRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={applyText}
                onEndEditing={applyText}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                placeholder="08:00"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.textInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                也可以直接打，比如 8:20
              </ThemedText>
            </View>

            <TimeWheel
              minutesOfDay={draft}
              onChange={(next) => {
                setDraft(next);
                setText(describeClock(next));
              }}
              onScrollLockChange={setWheelLocked}
            />

            <View style={styles.quickRow}>
              {QUICK_MINUTES.map((minute) => {
                const target = Math.floor(draft / 60) * 60 + minute;
                const active = draft === target;
                return (
                  <Pressable
                    key={minute}
                    accessibilityRole="button"
                    onPress={() => {
                      setDraft(target);
                      setText(describeClock(target));
                    }}
                    style={[
                      styles.quickChip,
                      { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement },
                    ]}>
                    <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                      :{String(minute).padStart(2, '0')}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={commit}
            style={[styles.primary, { backgroundColor: theme.text }]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              设为 {describeClock(draft)}
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
  header: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.one },
  title: { flex: 1 },
  body: { maxHeight: 380 },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  textInput: {
    width: 88,
    textAlign: 'center',
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.one,
    fontSize: 16,
    lineHeight: 22,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  quickChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.two },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
});
