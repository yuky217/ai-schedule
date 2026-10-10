import { Ionicons } from '@expo/vector-icons';
import { addDays, format, isSameDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MonthPicker } from '@/components/month-picker';
import { ThemedText } from '@/components/themed-text';
import { TimeWheel } from '@/components/time-wheel';
import { Spacing } from '@/constants/theme';
import { TimeAttribute } from '@/domain/enums';
import { buildAllDayTime, buildCustomTime } from '@/domain/schedule-presets';
import { taskAnchor, type Task, type TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { parseDayKey, toDayKey } from '@/utils/datetime';

/**
 * 自定义时间的选择器。
 *
 * 抽成独立组件是因为有几处要"自己指定哪天几点"：
 * 任务详情页（时间卡里常驻展开）、以及首页输入框的快捷设置按钮 ——
 * 后者在任务还不存在的时候就要选时间，所以这里必须能脱离 Task 工作。
 *
 * 组件分两层：
 * - `DateTimePickerBody`：纯内容（类型 + 日期 + 时/分双滚轮），可以塞进任何容器；
 * - `DateTimeSheet`：给它的 Modal 外壳，底部弹出。
 * 这样"内嵌常驻"和"独立弹出"共用同一份实现，不会出现两套走样的 UI。
 */

export interface DateTimeDraft {
  date: Date;
  /** 当天第几分钟。全天时无意义（界面也不显示时刻） */
  minutesOfDay: number;
  attribute: Extract<TimeAttribute, 'fixed' | 'deadline'>;
  /** 全天：占满一整天，没有具体时刻。为 true 时忽略 minutesOfDay */
  allDay?: boolean;
}

/** 常用分钟档，省去滚动 */
const QUICK_MINUTES = [0, 15, 30, 45] as const;

export function draftToTime(draft: DateTimeDraft): TaskTime | null {
  if (draft.allDay) return buildAllDayTime(draft.date);
  return buildCustomTime(draft.attribute, draft.date, draft.minutesOfDay);
}

/** 默认草稿：今天 09:00，日程型 */
export function defaultDraft(now: Date = new Date()): DateTimeDraft {
  const date = new Date(now);
  date.setHours(9, 0, 0, 0);
  return { date, minutesOfDay: 9 * 60, attribute: TimeAttribute.Fixed };
}

/** 从任务现有的时间做草稿；没有时间就回落默认值 */
export function draftFromTask(task: Pick<Task, 'time'>, now: Date = new Date()): DateTimeDraft {
  const anchor = taskAnchor(task);
  if (!anchor) return defaultDraft(now);
  const date = new Date(anchor);
  if (Number.isNaN(date.getTime())) return defaultDraft(now);
  return {
    date,
    minutesOfDay: date.getHours() * 60 + date.getMinutes(),
    attribute: task.time.attribute === TimeAttribute.Deadline ? 'deadline' : 'fixed',
    // 全天要原样带回来，否则编辑一件全天的事会把它变成"当天 00:00 的日程"
    allDay: task.time.allDay || undefined,
  };
}

export function describeDraft(draft: DateTimeDraft): string {
  if (draft.allDay) return `${format(draft.date, 'M月d日')} 全天`;
  return `${format(draft.date, 'M月d日')} ${formatTimeOfMinutes(draft.minutesOfDay)}`;
}

function formatTimeOfMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface DateTimePickerBodyProps {
  value: DateTimeDraft;
  onChange: (next: DateTimeDraft) => void;
  /**
   * 滚轮按住时会调 `true`。外层容器（两个使用点都是竖直 ScrollView）要据此
   * 把自己的滚动关掉 —— Android 上外层会把滚轮的手势全吃掉，内层根本滚不动。
   */
  onScrollLockChange?: (locked: boolean) => void;
}

export function DateTimePickerBody({ value, onChange, onScrollLockChange }: DateTimePickerBodyProps) {
  const theme = useTheme();
  const [calendarOpen, setCalendarOpen] = useState(false);

  return (
    <>
      {/*
        三选一：日程（几点开始）/ 截止（几点前）/ 全天（整天都算它）。
        前两者共用"日期 + 时刻"，落库形状不同；全天**没有时刻**，
        所以选中后下面的滚轮和分钟快选都不出现（见下方 conditional）。
      */}
      <View style={styles.toggle}>
        {(
          [
            { key: 'fixed' as const, label: '日程 · 几点开始' },
            { key: 'deadline' as const, label: '截止 · 几点前' },
            { key: 'allday' as const, label: '全天' },
          ]
        ).map((opt) => {
          const active = opt.key === 'allday' ? Boolean(value.allDay) : value.attribute === opt.key && !value.allDay;
          return (
            <Pressable
              key={opt.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() =>
                onChange(
                  opt.key === 'allday'
                    ? { ...value, allDay: true }
                    : { ...value, attribute: opt.key, allDay: undefined },
                )
              }
              style={[
                styles.toggleItem,
                {
                  backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                {opt.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/* 日期：左右各一天，点中间开月历 */}
      <View style={[styles.dateRow, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前一天"
          hitSlop={6}
          onPress={() => onChange({ ...value, date: addDays(value.date, -1) })}
          style={[styles.dateNav, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">‹</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => setCalendarOpen((o) => !o)}
          style={styles.dateLabel}>
          <ThemedText type="smallBold">
            {format(value.date, 'yyyy年M月d日')} {format(value.date, 'EEE', { locale: zhCN })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isSameDay(value.date, new Date()) ? '今天' : '点这里选其他日期'}
          </ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="后一天"
          hitSlop={6}
          onPress={() => onChange({ ...value, date: addDays(value.date, 1) })}
          style={[styles.dateNav, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">›</ThemedText>
        </Pressable>
      </View>

      {calendarOpen ? (
        <MonthPicker
          value={toDayKey(value.date)}
          // 选时间不允许"清除"：这里必须有一个确定的日期
          allowClear={false}
          onChange={(key) => {
            const picked = parseDayKey(key);
            if (picked) onChange({ ...value, date: picked });
          }}
          onDone={() => setCalendarOpen(false)}
        />
      ) : null}

      {value.allDay ? (
        /*
          全天没有时刻可挑，滚轮和分钟快选都不该出现 —— 摆着就是让人去调一个
          根本不生效的值。这里换成一句说明占住位置，免得面板下半截突然空掉
          （确认键会跟着往上跳，手指刚好点在别的东西上）。
        */
        <View style={styles.allDayNote}>
          <ThemedText type="small" themeColor="textSecondary">
            这一整天都算它，不落到几点几分
          </ThemedText>
        </View>
      ) : (
        <>
          {/* 时 / 分滚轮 */}
          <TimeWheel
            minutesOfDay={value.minutesOfDay}
            onChange={(minutesOfDay) => onChange({ ...value, minutesOfDay })}
            onScrollLockChange={onScrollLockChange}
          />

          <View style={styles.quickRow}>
            {QUICK_MINUTES.map((m) => {
              const target = Math.floor(value.minutesOfDay / 60) * 60 + m;
              const active = value.minutesOfDay === target;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  onPress={() => onChange({ ...value, minutesOfDay: target })}
                  style={[
                    styles.quickChip,
                    {
                      backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
                    },
                  ]}>
                  <ThemedText type="small" themeColor={active ? 'text' : 'textSecondary'}>
                    :{String(m).padStart(2, '0')}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </>
  );
}

/**
 * 快捷预设：一键把草稿定成"今天 18:00"这类完整时间。
 * 点下即应用并收起（预设的值是完整的，没必要再按一次确认）。
 */
export interface DateTimePreset {
  key: string;
  label: string;
  build: () => DateTimeDraft;
}

export interface DateTimeSheetProps {
  visible: boolean;
  value: DateTimeDraft;
  onChange: (next: DateTimeDraft) => void;
  /**
   * 确认时把**当时的时间值**传出来 —— 这样预设 chip 可以"应用 + 确认"一步完成，
   * 不用等 onChange 的 state 更新（同步连调会拿到旧值）。
   */
  onConfirm: (value: DateTimeDraft) => void;
  onCancel: () => void;
  title?: string;
  confirmLabel?: string;
  /** 顶部一排快捷预设（如记一件事的"今天 18:00"）。不传就不渲染 */
  presets?: readonly DateTimePreset[];
}

/** 底部弹出的外壳：输入框的"时间"快捷按钮直接用它 */
export function DateTimeSheet({
  visible,
  value,
  onChange,
  onCancel,
  onConfirm,
  title = '选个时间',
  confirmLabel,
  presets,
}: DateTimeSheetProps) {
  const theme = useTheme();
  /** 滚轮按住时关掉本页的滚动（见 TimeWheel 文件头第 1 条） */
  const [wheelLocked, setWheelLocked] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold" style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </ThemedText>
            <Pressable hitSlop={8} onPress={onCancel}>
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            scrollEnabled={!wheelLocked}
            style={styles.sheetBody}>
            {presets && presets.length > 0 ? (
              <View style={styles.presetRow}>
                {presets.map((preset) => (
                  <Pressable
                    key={preset.key}
                    accessibilityRole="button"
                    onPress={() => {
                      const next = preset.build();
                      onChange(next);
                      onConfirm(next);
                    }}
                    style={[
                      styles.presetChip,
                      { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText type="small">{preset.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <DateTimePickerBody
              value={value}
              onChange={onChange}
              onScrollLockChange={setWheelLocked}
            />
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={() => onConfirm(value)}
            style={[styles.primary, { backgroundColor: theme.text }]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {confirmLabel ?? `设为 ${describeDraft(value)}`}
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  toggleItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginTop: Spacing.two,
  },
  dateNav: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one },
  /** 全天时顶替滚轮的那句说明 */
  allDayNote: { alignItems: 'center', paddingVertical: Spacing.four },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  quickChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  presetChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
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
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.one },
  sheetTitle: { flex: 1 },
  sheetBody: { maxHeight: 420 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
});
