import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { ReorderableList } from '@/components/reorderable-list';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 收集箱 = 主文档里的"中档待规划"。
 *
 * 这一页存在的意义是：允许用户先记下来、不立刻决定时间。
 * 点条目进任务详情页 —— 那里第一步就是"定时间"（预设 chips 一次点按），
 * 同时还能写备注、设提醒和重复。收集箱本身不再承载编辑动作。
 *
 * 唯一多出来的是**长按拖动排序**：收集箱天然是一个"待消化队列"，
 * 顺序就是你心里的先后。拖过之后顺序会写进 sort_order 落库。
 */
export default function InboxScreen() {
  const router = useRouter();
  const theme = useTheme();

  const inbox = useAppStore((state) => state.inbox);
  const completeTask = useAppStore((state) => state.completeTask);
  const reorderTasks = useAppStore((state) => state.reorderTasks);
  const [reordering, setReordering] = useState(false);

  return (
    <Screen
      title="收集箱"
      subtitle="先记下来，不必当场决定什么时候做"
      scrollEnabled={!reordering}
      right={
        <Pressable hitSlop={8} onPress={() => router.push('/capture')}>
          <Ionicons name="add" size={24} color={theme.text} />
        </Pressable>
      }>
      <Card>
        <View style={styles.tipRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.tipText}>
            有明确时间的事会自动落到日历；剩下没时间的都堆在这里。点一下进详情页定时间，
            <ThemedText type="smallBold">长按</ThemedText>任一行可以拖动排序。
          </ThemedText>
        </View>
      </Card>

      {inbox.length ? (
        <View style={styles.list}>
          <ReorderableList
            items={inbox}
            keyOf={(task) => task.id}
            labelOf={(task) => task.title}
            gap={Spacing.two}
            onDraggingChange={setReordering}
            onReorder={(ids) => void reorderTasks(ids)}
            renderItem={(task) => (
              <TaskRow
                task={task}
                onPress={(t) => router.push(`/task/${t.id}`)}
                onComplete={(t) => void completeTask(t.id)}
              />
            )}
          />
        </View>
      ) : (
        <EmptyState
          icon="file-tray-outline"
          title="收集箱是空的"
          hint="想到什么就丢进来，不用想清楚它属于哪里"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tipRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  tipText: { flex: 1, lineHeight: 18 },
  // 行间距由 ReorderableList 的 gap 统一处理（它要用间距算落点）
  list: {},
});
