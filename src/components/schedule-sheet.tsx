import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DateTimePickerBody, describeDraft, draftFromTask, draftToTime, type DateTimeDraft } from '@/components/date-time-picker';
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
 * 预设覆盖不到的情形走「自定义时间…」：自己选哪天 + 时/分双滚轮（精确到 1 分钟），
 * 并可选"日程（几点开始）"还是"截止（几点前）"。这块 UI 与首页输入框的
 * 快捷设置按钮共用 `components/date-time-picker.tsx`，避免两处走样。
 *
 * 提醒提前量与重复规则是面板里的两个设置行：点开换一层 chips，选择后
 * 立即写回任务（不动时间），安排过时间的任务改完会自动重排通知。
 */
export type SheetView = 'main' | 'custom' | 'reminder' | 'repeat';

export interface ScheduleSheetProps {
  /** 正在安排的任务；null = 关闭 */
  task: Task | null;
  onClose: () => void;
  onSchedule: (task: Task, time: TaskTime) => void;
  /** 设置提前量（分钟）。不传则隐藏该设置行 */
  onSetReminder?: (task: Task, minutes: number) => void;
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
  const [draft, setDraft] = useState<DateTimeDraft>(() => draftFromTask({ time: { attribute: 'none' } }));
  /** 滚轮按住时关掉本面板的滚动（见 TimeWheel 文件头第 1 条） */
  const [wheelLocked, setWheelLocked] = useState(false);

  // 任务切换 / 关闭 / 换入口时回到指定层，避免下次打开还停在上次的位置
  useEffect(() => {
    setView(initialView);
  }, [task?.id, task !== null, initialView]);

  // 进自定义层时把草稿初始化成"这条任务现在的时间"，没有时间则给个友好默认值（今天 09:00）
  useEffect(() => {
    if (view !== 'custom' || !task) return;
    setDraft(draftFromTask(task));
    // 只在"进入自定义层"这一刻初始化，之后的编辑不能被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, task?.id]);

  const handlePick = (presetId: string) => {
    if (!task) return;
    const preset = SCHEDULE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onSchedule(task, buildScheduleTime(preset));
    onClose();
  };

  const handleCustomConfirm = () => {
    if (!task) return;
    const time = draftToTime(draft);
    if (!time) return;
    onSchedule(task, time);
    onClose();
  };

  const handleReminder = (minutes: number) => {
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
        : view === 'custom'
          ? '自定义时间'
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
            scrollEnabled={!wheelLocked}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {view === 'main' ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
                  安排后会落到日历并按时提醒
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

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setView('custom')}
                  style={({ pressed }) => [
                    styles.chip,
                    styles.chipWide,
                    {
                      backgroundColor: pressed
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                    },
                  ]}>
                  <Ionicons name="options-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="small" style={styles.chipText}>
                    自定义时间…
                  </ThemedText>
                </Pressable>

                <View style={styles.settingRows}>
                  {onSetReminder ? (
                    <SettingRow
                      icon="notifications-outline"
                      label="提醒"
                      value={describeReminder(task?.reminderMinutesBefore ?? 0)}
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

            {view === 'custom' ? (
              <DateTimePickerBody
                value={draft}
                onChange={setDraft}
                onScrollLockChange={setWheelLocked}
              />
            ) : null}

            {view === 'reminder'
              ? REMINDER_PRESETS.map((preset) => {
                  const current = (task?.reminderMinutesBefore ?? 0) === preset.minutes;
                  return (
                    <ChipRow
                      key={preset.id}
                      label={preset.label}
                      selected={current}
                      theme={theme}
                      onPress={() => handleReminder(preset.minutes)}
                    />
                  );
                })
              : null}

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

          {view === 'custom' ? (
            <Pressable
              accessibilityRole="button"
              onPress={handleCustomConfirm}
              style={[styles.primary, { backgroundColor: theme.text }]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                设为 {describeDraft(draft)}
              </ThemedText>
            </Pressable>
          ) : null}

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
  chipWide: { flexGrow: 0, marginTop: Spacing.two, justifyContent: 'center' },
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
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
});
