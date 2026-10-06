import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TaskKind, TaskStatus } from '@/domain/enums';
import { describeRepeat, describeReminder } from '@/domain/repeat-next';
import { taskDue, type Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { describeDue, formatDayTime } from '@/utils/datetime';

/** 类型的中文短标签，界面上一律用它，不直接显示英文枚举 */
export const KIND_LABEL: Record<TaskKind, string> = {
  [TaskKind.Schedule]: '日程',
  [TaskKind.Execution]: '执行',
  [TaskKind.Habit]: '习惯',
  [TaskKind.Idea]: '想法',
};

export interface TaskRowProps {
  task: Task;
  /** 勾选完成。这是唯一的"完成"入口 —— 整行点击只负责打开详情 */
  onComplete?: (task: Task) => void;
  onPress?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  /** 右侧尾部插槽（例如日历里的拖拽抓手） */
  trailing?: ReactNode;
}

export function TaskRow({ task, onComplete, onPress, onDelete, trailing }: TaskRowProps) {
  const theme = useTheme();
  const done = task.status === TaskStatus.Done;
  // 行上显示的是"期限"（优先截止），不是"什么时候发生" —— 两者不同，见 taskDue 的注释
  const anchor = taskDue(task);

  return (
    <Pressable
      onPress={() => onPress?.(task)}
      // 长按交给外层拖拽手势，这里不抢
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? '标记为未完成' : '标记为完成'}
        onPress={() => onComplete?.(task)}
        style={[
          styles.checkbox,
          {
            borderColor: done ? theme.text : theme.textSecondary,
            backgroundColor: done ? theme.text : 'transparent',
          },
        ]}>
        {done ? <Ionicons name="checkmark" size={15} color={theme.background} /> : null}
      </Pressable>

      <View style={styles.body}>
        <ThemedText
          style={done ? styles.doneText : undefined}
          themeColor={done ? 'textSecondary' : 'text'}
          numberOfLines={2}>
          {task.title}
        </ThemedText>

        <View style={styles.metaRow}>
          <Meta text={KIND_LABEL[task.kind]} />
          {task.repeat ? <Meta text={describeRepeat(task.repeat)} /> : null}
          {task.status === TaskStatus.Waiting && task.waitingFor ? (
            <Meta text={`等 ${task.waitingFor}`} />
          ) : null}
          {anchor ? (
            <Meta text={`${describeDue(anchor)} · ${formatDayTime(anchor)}`} />
          ) : (
            <Meta text="待规划" muted />
          )}
          {(task.reminderMinutesBefore ?? 0) > 0 && anchor ? (
            <Meta text={describeReminder(task.reminderMinutesBefore)} muted />
          ) : null}
        </View>
      </View>

      <View style={styles.right}>
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除"
            hitSlop={6}
            onPress={() => onDelete(task)}>
            <Ionicons name="close" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : onPress ? (
          // 能点进详情时给一个方向暗示，而不是让用户猜这行能不能点
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        ) : null}
        {trailing}
      </View>
    </Pressable>
  );
}

function Meta({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <ThemedText
      type="small"
      themeColor="textSecondary"
      style={[styles.meta, muted ? styles.metaMuted : undefined]}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  /**
   * 完成按钮：不再往外扩热区（之前 hitSlop 8 会让整行左侧一小片区域都变成"完成"，
   * 想点进详情或拖拽的时候很容易误触）。要做完一件事，就明确点这个圈。
   */
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.one },
  doneText: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  meta: { fontSize: 12, lineHeight: 16 },
  metaMuted: { opacity: 0.6 },
  right: { alignItems: 'center', gap: Spacing.two, flexDirection: 'row' },
});
