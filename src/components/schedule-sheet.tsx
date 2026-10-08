import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { buildScheduleTime, SCHEDULE_PRESETS } from '@/domain/schedule-presets';
import {
  describeReminder,
  describeRepeat,
  REMINDER_PRESETS,
  REPEAT_PRESETS,
} from '@/domain/repeat-next';
import type { RepeatRule, Task, TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';

/**
 * 「安排时间」底部面板。
 *
 * 交互借鉴滴答清单 / Todoist：点开就是一排高频时间预设，一次点按完成安排，
 * 不强制填表。选中的预设由领域层 `buildScheduleTime` 换算成 TaskTime。
 * 安排成功的任务会自动离开收集箱、落到日历。
 *
 * 这里**没有**"自定义时间"这一层：需要自己挑哪天几点的场景，任务详情页的
 * 时间卡里那张调整栏是常驻的（见 `components/date-time-picker.tsx`），
 * 多一层入口只会让人多按一下。本面板的职责只剩"预设 + 提醒 / 重复"。
 *
 * 提醒提前量与重复规则是面板里的两个设置行：点开换一层 chips，选择后
 * 立即写回任务（不动时间），安排过时间的任务改完会自动重排通知。
 */
export type SheetView = 'main' | 'reminder' | 'repeat';

export interface ScheduleSheetProps {
  /** 正在安排的任务；null = 关闭 */
  task: Task | null;
  onClose: () => void;
  onSchedule: (task: Task, time: TaskTime) => void;
  /** 设置提前量（分钟）。**null = 不提醒**。不传则隐藏该设置行 */
  onSetReminder?: (task: Task, minutes: number | null) => void;
  /** 设置重复规则。不传则隐藏该设置行 */
  onSetRepeat?: (task: Task, rule: RepeatRule | null) => void;
  /** 打开时停在那一层：详情页点"提醒"就直接进提醒层，少一次点按 */
  initialView?: SheetView;
}

export function ScheduleSheet({
  task,
  onClose,
  onSchedule,
  onSetReminder,
  onSetRepeat,
  initialView = 'main',
}: ScheduleSheetProps) {
  const theme = useTheme();
  const [view, setView] = useState<SheetView>(initialView);

  // 任务切换 / 关闭 / 换入口时回到指定层，避免下次打开还停在上次的位置
  useEffect(() => {
    setView(initialView);
  }, [task?.id, task !== null, initialView]);

  const handlePick = (presetId: string) => {
    if (!task) return;
    const preset = SCHEDULE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onSchedule(task, buildScheduleTime(preset));
    onClose();
  };

  const handleReminder = (minutes: number | null) => {
    if (!task || !onSetReminder) return;
    onSetReminder(task, minutes);
    setView('main');
  };

  const handleRepeat = (rule: RepeatRule | null) => {
    if (!task || !onSetRepeat) return;
    onSetRepeat(task, rule);
    setView('main');
  };

  const title =
    view === 'reminder'
      ? '提醒时间'
      : view === 'repeat'
        ? '重复'
        : task
          ? task.title
          : '';

  return (
    <Modal visible={task !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={styles.titleRow}>
            {view !== 'main' ? (
              <Pressable hitSlop={8} onPress={() => setView('main')} style={styles.backButton}>
                <Ionicons name="chevron-back" size={18} color={theme.textSecondary} />
              </Pressable>
            ) : null}
            <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
              {title}
            </ThemedText>
          </View>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {view === 'main' ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
                  安排后落到日历；提醒不自动开，要的话在下面设
                </ThemedText>

                <View style={styles.grid}>
                  {SCHEDULE_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityLabel={`安排为${preset.label}`}
                      onPress={() => handlePick(preset.id)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: pressed
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                      ]}>
                      <Ionicons
                        name={preset.attribute === 'fixed' ? 'time-outline' : 'alarm-outline'}
                        size={16}
                        color={theme.textSecondary}
                      />
                      <ThemedText type="small" style={styles.chipText}>
                        {preset.label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.settingRows}>
                  {onSetReminder ? (
                    <SettingRow
                      icon="notifications-outline"
                      label="提醒"
                      value={describeReminder(task?.reminderMinutesBefore)}
                      theme={theme}
                      onPress={() => setView('reminder')}
                    />
                  ) : null}
                  {onSetRepeat ? (
                    <SettingRow
                      icon="repeat-outline"
                      label="重复"
                      value={task?.repeat ? describeRepeat(task.repeat) : '不重复'}
                      theme={theme}
                      onPress={() => setView('repeat')}
                    />
                  ) : null}
                </View>
              </>
            ) : null}

            {view === 'reminder' ? (
              <>
                {/* 「不提醒」排第一：它是默认值，用户最可能来这儿做的就是把提醒关掉 */}
                <ChipRow
                  label="不提醒"
                  selected={task?.reminderMinutesBefore == null}
                  theme={theme}
                  onPress={() => handleReminder(null)}
                />
                {REMINDER_PRESETS.map((preset) => {
                  const current = task?.reminderMinutesBefore === preset.minutes;
                  return (
                    <ChipRow
                      key={preset.id}
                      label={preset.label}
                      selected={current}
                      theme={theme}
                      onPress={() => handleReminder(preset.minutes)}
                    />
                  );
                })}
              </>
            ) : null}

            {view === 'repeat'
              ? REPEAT_PRESETS.map((preset) => {
                  const current =
                    preset.rule === null
                      ? !task?.repeat
                      : JSON.stringify(preset.rule) === JSON.stringify(task?.repeat);
                  return (
                    <ChipRow
                      key={preset.id}
                      label={preset.label}
                      selected={current}
                      theme={theme}
                      onPress={() => handleRepeat(preset.rule)}
                    />
                  );
                })
              : null}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.cancel, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {view === 'main' ? '先不定时间' : '完成'}
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <ThemedText type="small">{label}</ThemedText>
      <View style={styles.settingValue}>
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
        <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

function ChipRow({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.optionRow,
        { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <ThemedText type="small" themeColor={selected ? 'text' : undefined}>
        {label}
      </ThemedText>
      {selected ? <Ionicons name="checkmark" size={16} color={theme.text} /> : null}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.one },
  backButton: { marginRight: Spacing.one },
  title: { flex: 1 },
  body: { maxHeight: 420 },
  subtitle: { lineHeight: 18 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    flexGrow: 1,
  },
  chipText: { flexShrink: 1 },
  settingRows: { gap: Spacing.two, marginTop: Spacing.two },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  settingValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  optionRow: {
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
