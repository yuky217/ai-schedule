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
import { buildCustomTime } from '@/domain/schedule-presets';
import { taskAnchor, type Task, type TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { parseDayKey, toDayKey } from '@/utils/datetime';

/**
 * 自定义时间的选择器。
 *
 * 抽成独立组件是因为有三个地方要"自己指定哪天几点"：
 * 任务详情页、安排面板、以及首页输入框的快捷设置按钮 ——
 * 后两者在任务还不存在的时候就要选时间，所以这里必须能脱离 Task 工作。
 *
 * 组件分两层：
 * - `DateTimePickerBody`：纯内容（类型 + 日期 + 时/分双滚轮），可以塞进任何容器；
 * - `DateTimeSheet`：给它的 Modal 外壳，底部弹出。
 * 这样"面板里内嵌"和"独立弹出"共用同一份实现，不会出现两套走样的 UI。
 */

export interface DateTimeDraft {
  date: Date;
  /** 当天第几分钟 */
  minutesOfDay: number;
  attribute: Extract<TimeAttribute, 'fixed' | 'deadline'>;
}

/** 常用分钟档，省去滚动 */
const QUICK_MINUTES = [0, 15, 30, 45] as const;

export function draftToTime(draft: DateTimeDraft): TaskTime | null {
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
  };
}

export function describeDraft(draft: DateTimeDraft): string {
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
      {/* 日程 or 截止：同一套日期+时刻，落库形状不同 */}
      <View style={styles.toggle}>
        {(
          [
            { key: 'fixed' as const, label: '日程 · 几点开始' },
            { key: 'deadline' as const, label: '截止 · 几点前' },
          ]
        ).map((opt) => {
          const active = value.attribute === opt.key;
          return (
            <Pressable
              key={opt.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange({ ...value, attribute: opt.key })}
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
  );
}

export interface DateTimeSheetProps {
  visible: boolean;
  value: DateTimeDraft;
  onChange: (next: DateTimeDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
}

/** 底部弹出的外壳：输入框的"时间"快捷按钮直接用它 */
export function DateTimeSheet({
  visible,
  value,
  onChange,
  onCancel,
  onConfirm,
  title = '自定义时间',
  confirmLabel,
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
            <DateTimePickerBody
              value={value}
              onChange={onChange}
              onScrollLockChange={setWheelLocked}
            />
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onConfirm}
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
