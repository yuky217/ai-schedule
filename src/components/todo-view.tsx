import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { groupTodos, TODO_DONE_LIMIT } from '@/domain/todo';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';

/**
 * 待办视图（日历的第五个分段）。
 *
 * 用户的原话是"想找个地方看到所有待办，不管设没设时间；开会、上课这种不算待办"。
 * 它和另外四个视图的分工：
 *   - 月/周/日 回答"**什么时候**做"，必须先有时间才进得去；
 *   - 课表 回答"我什么时候被占着"；
 *   - **待办 回答"我手上欠着什么"** —— 完全不看时间，没排期的照样在里面。
 *
 * 为什么放在日历这一页、而不是自己占一个 Tab：它和日历共用"事情"这一份数据，
 * 切换视图不需要换页面；而且它天然是个"看全局"的视角，跟月视图的定位是一路的。
 *
 * 分档与排序全在 `domain/todo.ts`（有 22 个测试），这里只负责画。
 */

export interface TodoViewProps {
  tasks: readonly Task[];
  onOpen: (task: Task) => void;
  onComplete: (task: Task) => void;
  /** 空态里那个"去记一条"的出口 */
  onCapture: () => void;
}

export function TodoView({ tasks, onOpen, onComplete, onCapture }: TodoViewProps) {
  const theme = useTheme();
  // 每次渲染现算：长时间挂着跨过午夜后，"今天"这一档要能自己变
  const groups = groupTodos(tasks);

  if (!groups.length) {
    return (
      <EmptyState
        icon="checkbox-outline"
        title="手上没有欠着的事"
        hint="写作业、跑步这类要你动手的会出现在这儿；开会、上课不算待办，它们在日历里"
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {groups.map((group) => {
        const isDoneGroup = group.bucket === 'done';
        const shown = isDoneGroup ? group.tasks.slice(0, TODO_DONE_LIMIT) : group.tasks;
        const hidden = group.tasks.length - shown.length;
        return (
          <View key={group.bucket} style={styles.group}>
            <View style={styles.groupHead}>
              <ThemedText type="smallBold" themeColor={isDoneGroup ? 'textSecondary' : 'text'}>
                {group.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {group.tasks.length}
              </ThemedText>
            </View>
            {shown.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onPress={onOpen}
                onComplete={onComplete}
              />
            ))}
            {hidden > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.more}>
                还有 {hidden} 件已完成 · 去回顾页看全部
              </ThemedText>
            ) : null}
          </View>
        );
      })}

      {/* 出口放在最后：看完了还想加一条，就在这儿加，不用切页面 */}
      <ThemedText
        type="small"
        themeColor="textSecondary"
        onPress={onCapture}
        style={[styles.capture, { color: theme.textSecondary }]}>
        ＋ 记一条
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.four },
  group: { gap: Spacing.one },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  more: { paddingHorizontal: Spacing.one, paddingTop: Spacing.one, fontSize: 12 },
  capture: { textAlign: 'center', paddingVertical: Spacing.two },
});
