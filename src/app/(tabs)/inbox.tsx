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
 *
 * 再加一块**「已完成」折叠区**：勾掉的东西必须还能找回来。
 * 一条无时间的任务在收集箱里被勾掉之后，收集箱不收它（这里带 status != done），
 * 日历不收它（没时间）、首页今天不收它（按时间匹配）、习惯页不收它（不是习惯）——
 * 四个列表全都不收，等于"勾一下=弄丢"。这一块就是它的落点，
 * 而且就地能撤销完成（`reopenTask`），不用跑去别的页面。
 */
export default function InboxScreen() {
  const router = useRouter();
  const theme = useTheme();

  const inbox = useAppStore((state) => state.inbox);
  const recentlyDone = useAppStore((state) => state.recentlyDone);
  const completeTask = useAppStore((state) => state.completeTask);
  const reopenTask = useAppStore((state) => state.reopenTask);
  const reorderTasks = useAppStore((state) => state.reorderTasks);
  const [reordering, setReordering] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

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
            <ThemedText type="smallBold">长按</ThemedText>任一行可以拖动排序。勾掉的会收到下面的
            「已完成」里，随时能拿回来。
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

      {/* 已完成：勾掉的东西有个地方待着，也能就地拿回来 */}
      {recentlyDone.length ? (
        <View style={styles.doneBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: doneOpen }}
            onPress={() => setDoneOpen((value) => !value)}
            style={styles.doneHead}>
            <Ionicons name="checkmark-circle-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.doneHeadText}>
              已完成 {recentlyDone.length} 件
            </ThemedText>
            <Ionicons
              name={doneOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textSecondary}
            />
          </Pressable>

          {doneOpen ? (
            <View style={styles.list}>
              {recentlyDone.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onPress={(t) => router.push(`/task/${t.id}`)}
                  // 圈是勾上的，再点一下 = 拿回来（不是再完成一次）
                  onComplete={(t) => void reopenTask(t.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tipRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  tipText: { flex: 1, lineHeight: 18 },
  // 行间距由 ReorderableList 的 gap 统一处理（它要用间距算落点）
  list: {},
  doneBlock: { gap: Spacing.two },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  doneHeadText: { flex: 1 },
});
