import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  WEEK_ORDER,
  describeWeeks,
  weekdayLabel,
  weeksFromRange,
  type CourseSession,
} from '@/domain/course';
import { parseWeeks } from '@/domain/course-text';
import { useTheme } from '@/hooks/use-theme';

/**
 * 一段上课时间的编辑面板（星期 / 节次 / 周次）。
 *
 * 两个地方用它：给手动添加的课选第一段时间、给"没有时间的课"补一段时间。
 * 合起来是有原因的 —— 这两件事的输入完全一样，写两份的下场是两份的
 * 默认值、校验、手感迟早跑偏。
 *
 * 默认值刻意都是"最可能的那个"：星期取今天、节次取 1-2 节、
 * 周次直接铺满整学期 —— 多数情况下用户只需要点一下"保存"。
 */
export interface CourseSessionSheetProps {
  visible: boolean;
  /** 学期总周数，用来铺默认周次 */
  totalWeeks: number;
  /** 作息表里有几节（决定节次可选到几） */
  periodCount?: number;
  /** 编辑已有的一段；不传 = 新增 */
  initial?: CourseSession | null;
  onSubmit: (session: CourseSession) => void;
  onClose: () => void;
}

export function CourseSessionSheet({
  visible,
  totalWeeks,
  periodCount = 12,
  initial,
  onSubmit,
  onClose,
}: CourseSessionSheetProps) {
  const theme = useTheme();
  const [weekday, setWeekday] = useState(() => initial?.weekday ?? new Date().getDay());
  const [startPeriod, setStartPeriod] = useState(initial?.startPeriod ?? 1);
  const [endPeriod, setEndPeriod] = useState(initial?.endPeriod ?? 2);
  const [weeksText, setWeeksText] = useState('');

  // 每次打开都按 initial 重置一次 —— 否则上一次开的残留会带进下一次
  useEffect(() => {
    if (!visible) return;
    setWeekday(initial?.weekday ?? new Date().getDay());
    setStartPeriod(initial?.startPeriod ?? 1);
    setEndPeriod(initial?.endPeriod ?? 2);
    setWeeksText('');
  }, [visible, initial]);

  /**
   * 周次直接复用课表解析器 —— 用户能写"1-16周"、"1-16周(双)"、"1、3、5周"，
   * 全都认。空着就是整学期，也是默认值。
   */
  const weeks = useMemo(() => {
    const parsed = parseWeeks(weeksText, { start: 1, end: totalWeeks });
    return parsed?.weeks ?? weeksFromRange(1, totalWeeks);
  }, [weeksText, totalWeeks]);

  const maxPeriod = Math.min(Math.max(2, periodCount), 20);
  const periods = useMemo(() => Array.from({ length: maxPeriod }, (_, i) => i + 1), [maxPeriod]);
  const weeksReady = weeks.length > 0;

  const submit = () => {
    if (!weeksReady) return;
    onSubmit({
      weekday,
      startPeriod,
      endPeriod: Math.max(startPeriod, endPeriod),
      weeks,
      location: initial?.location ?? null,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(event) => event.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />
          <ThemedText type="smallBold" style={styles.title}>
            上课时间
          </ThemedText>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              星期
            </ThemedText>
            <View style={styles.wrap}>
              {WEEK_ORDER.map((day) => (
                <Chip
                  key={day}
                  label={weekdayLabel(day)}
                  active={day === weekday}
                  onPress={() => setWeekday(day)}
                />
              ))}
            </View>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              节次
            </ThemedText>
            <View style={styles.periodRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.periodLabel}>
                从
              </ThemedText>
              <View style={styles.wrap}>
                {periods.map((period) => (
                  <Chip
                    key={`from-${period}`}
                    label={String(period)}
                    active={period === startPeriod}
                    onPress={() => {
                      setStartPeriod(period);
                      if (period > endPeriod) setEndPeriod(period);
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.periodRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.periodLabel}>
                到
              </ThemedText>
              <View style={styles.wrap}>
                {periods.map((period) => (
                  <Chip
                    key={`to-${period}`}
                    label={String(period)}
                    active={period === endPeriod}
                    disabled={period < startPeriod}
                    onPress={() => setEndPeriod(period)}
                  />
                ))}
              </View>
            </View>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              周次
            </ThemedText>
            <TextInput
              value={weeksText}
              onChangeText={setWeeksText}
              placeholder={`1-${totalWeeks}周（不填就是整学期）`}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
              ]}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.preview}>
              {weeksReady
                ? `${weekdayLabel(weekday)} 第 ${startPeriod}-${Math.max(startPeriod, endPeriod)} 节 · ${describeWeeks(weeks, totalWeeks)}`
                : '这段周次没读懂，试试"1-16周"或"1-16周(双)"'}
            </ThemedText>
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !weeksReady }}
            disabled={!weeksReady}
            onPress={submit}
            style={[
              styles.confirm,
              { backgroundColor: theme.text, opacity: weeksReady ? 1 : 0.35 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {initial ? '保存' : '加这一段'}
            </ThemedText>
          </Pressable>
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

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.backgroundElement,
          opacity: disabled ? 0.3 : 1,
        },
      ]}>
      <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
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
  title: { marginTop: Spacing.one },
  body: { maxHeight: 420 },
  label: { marginTop: Spacing.two, marginBottom: Spacing.one },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, flex: 1 },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two, minWidth: 34, alignItems: 'center' },
  periodRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  periodLabel: { width: 18, paddingTop: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  preview: { marginTop: Spacing.one, fontSize: 12, lineHeight: 17 },
  confirm: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three, marginTop: Spacing.two },
  cancel: { alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.three },
});
