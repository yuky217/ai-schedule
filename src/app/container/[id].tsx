import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ContainerRow } from '@/components/container-row';
import { GanttChart } from '@/components/gantt-chart';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Container } from '@/domain/container';
import { CONTAINER_KIND_LABEL, containerStats } from '@/domain/container-stats';
import { ContainerKind, ContainerStatus } from '@/domain/enums';
import type { GanttItem } from '@/domain/gantt';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { describeDue, formatMonthDay, parseDayKey } from '@/utils/datetime';

/**
 * 容器详情（目标 / 项目 / 文件夹共用）。
 *
 * 它承担三件事：
 * 1. **定义这个容器**：名字、备注、类型、状态、起止时间；
 * 2. **收拢成员**：直属任务列表 + 子容器列表，并能把"还散在外面的任务"拉进来；
 * 3. **看进度**：一条进度条 + 一张只属于它的甘特图。
 *
 * 保存策略跟任务详情页一致：本地 state 是唯一显示源（乐观更新），
 * 改动即刻写库，不回头 reload —— 否则会跟正在输入的文本打架。
 */
export default function ContainerDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();

  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const loadContainer = useAppStore((state) => state.loadContainer);
  const updateContainer = useAppStore((state) => state.updateContainer);
  const removeContainer = useAppStore((state) => state.removeContainer);
  const createContainer = useAppStore((state) => state.createContainer);
  const containers = useAppStore((state) => state.containers);
  const tasks = useAppStore((state) => state.tasks);
  const updateTask = useAppStore((state) => state.updateTask);
  const completeTask = useAppStore((state) => state.completeTask);
  const shiftTaskByDays = useAppStore((state) => state.shiftTaskByDays);

  const [container, setContainer] = useState<Container | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [titleRef, setTitleRef] = useState('');
  const [noteRef, setNoteRef] = useState('');
  const [editingDate, setEditingDate] = useState<'startAt' | 'endAt' | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const [pickingTasks, setPickingTasks] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** 甘特图拖拽期间锁住页面滚动，否则手指一竖页面就跟着滚 */
  const [ganttDragging, setGanttDragging] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    void loadContainer(id).then((found) => {
      if (!alive) return;
      setContainer(found);
      if (found) {
        setTitle(found.title);
        setNote(found.note ?? '');
        setTitleRef(found.title);
        setNoteRef(found.note ?? '');
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, loadContainer]);

  const patch = useCallback(
    async (changes: Partial<Container>) => {
      if (!container) return;
      setContainer((current) => (current ? { ...current, ...changes } : current));
      await updateContainer(container.id, changes);
    },
    [container, updateContainer],
  );

  const setDay = useCallback(
    (field: 'startAt' | 'endAt', dayKey: string | null) => {
      const iso = dayKey ? (parseDayKey(dayKey)?.toISOString() ?? null) : null;
      void patch({ [field]: iso } as Partial<Container>);
      setEditingDate(null);
    },
    [patch],
  );

  const children = useMemo(
    () => (id ? containers.filter((c) => c.parentId === id) : []),
    [containers, id],
  );
  const members = useMemo(
    () => (id ? tasks.filter((t) => t.containerId === id) : []),
    [id, tasks],
  );
  /** 可以拉进来的任务：还没归属、也还没做完的 */
  const candidates = useMemo(
    () => tasks.filter((t) => !t.containerId && t.status !== 'done'),
    [tasks],
  );
  const stats = useMemo(() => containerStats(members), [members]);

  const ganttItems = useMemo<GanttItem[]>(() => {
    if (!container) return [];
    const items: GanttItem[] = [];
    if (container.startAt || container.endAt) {
      items.push({
        id: container.id,
        label: container.title,
        kind: 'container',
        startAt: container.startAt,
        endAt: container.endAt,
        done: container.status !== 'active',
        badge: CONTAINER_KIND_LABEL[container.kind],
      });
    }
    for (const task of members) {
      if (!task.time.startAt && !task.time.dueAt) continue;
      items.push({
        id: task.id,
        label: task.title,
        kind: 'task',
        startAt: task.time.startAt,
        endAt: task.time.endAt,
        dueAt: task.time.dueAt,
        done: task.status === 'done',
      });
    }
    return items;
  }, [container, members]);

  if (loading) {
    return (
      <Screen title="项目">
        <ThemedText type="small" themeColor="textSecondary">
          正在读取…
        </ThemedText>
      </Screen>
    );
  }

  if (!container) {
    return (
      <Screen
        title="项目"
        right={
          <Pressable hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        }>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            这个目标 / 项目已经不存在了（可能刚被删除）。
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  const span =
    container.startAt || container.endAt
      ? `${container.startAt ? formatMonthDay(new Date(container.startAt)) : '未定'} - ${
          container.endAt ? formatMonthDay(new Date(container.endAt)) : '未定'
        }`
      : '还没定起止时间';

  return (
    <Screen
      title={CONTAINER_KIND_LABEL[container.kind]}
      subtitle={stats.total ? `${stats.done}/${stats.total} 件已完成` : '还没有任务挂进来'}
      scrollEnabled={!ganttDragging}
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {/* 名字与备注 */}
      <Card>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setTitleRef(value);
          }}
          onBlur={() => {
            const next = titleRef.trim();
            if (next && next !== container.title) void patch({ title: next });
          }}
          multiline
          placeholder="这是什么"
          placeholderTextColor={theme.textSecondary}
          style={[styles.titleInput, { color: theme.text }]}
        />
        <TextInput
          value={note}
          onChangeText={(value) => {
            setNote(value);
            setNoteRef(value);
          }}
          onBlur={() => {
            const next = noteRef.trim();
            if (next !== (container.note ?? '')) void patch({ note: next || null });
          }}
          multiline
          placeholder="备注（自动保存）"
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.noteInput,
            {
              color: theme.text,
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
            },
          ]}
        />
      </Card>

      {/* 类型与状态 */}
      <Card title="类型" hint="目标看方向、项目看进度、文件夹只管分类">
        <View style={styles.chips}>
          {[ContainerKind.Goal, ContainerKind.Project, ContainerKind.Folder].map((option) => (
            <Chip
              key={option}
              label={CONTAINER_KIND_LABEL[option]}
              active={container.kind === option}
              theme={theme}
              onPress={() => void patch({ kind: option })}
            />
          ))}
        </View>
        <View style={styles.chips}>
          {[ContainerStatus.Active, ContainerStatus.Done, ContainerStatus.Archived].map((option) => (
            <Chip
              key={option}
              label={
                option === ContainerStatus.Active
                  ? '进行中'
                  : option === ContainerStatus.Done
                    ? '已完成'
                    : '已归档'
              }
              active={container.status === option}
              theme={theme}
              onPress={() => void patch({ status: option })}
            />
          ))}
        </View>
      </Card>

      {/* 起止时间 */}
      <Card title="时间" hint="定了起止，它就会出现在甘特图上">
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditingDate(editingDate === 'startAt' ? null : 'startAt')}
          style={({ pressed }) => [
            styles.settingRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons name="play-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small">开始</ThemedText>
          <View style={styles.settingValue}>
            <ThemedText type="small" themeColor="textSecondary">
              {container.startAt ? formatMonthDay(new Date(container.startAt)) : '未设置'}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </View>
        </Pressable>
        {editingDate === 'startAt' ? (
          <MonthPicker value={container.startAt} onChange={(key) => setDay('startAt', key)} onDone={() => setEditingDate(null)} />
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => setEditingDate(editingDate === 'endAt' ? null : 'endAt')}
          style={({ pressed }) => [
            styles.settingRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons name="flag-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small">结束</ThemedText>
          <View style={styles.settingValue}>
            <ThemedText type="small" themeColor="textSecondary">
              {container.endAt ? formatMonthDay(new Date(container.endAt)) : '未设置'}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </View>
        </Pressable>
        {editingDate === 'endAt' ? (
          <MonthPicker value={container.endAt} onChange={(key) => setDay('endAt', key)} onDone={() => setEditingDate(null)} />
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {span}
        </ThemedText>
      </Card>

      {/* 进度 */}
      <Card title="进度" hint={stats.total ? `${stats.open} 件还没做完` : '挂几个任务进来看进度'}>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(stats.ratio * 100)}%`, backgroundColor: theme.text },
            ]}
          />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {stats.total
            ? `${stats.done} / ${stats.total} 件（${Math.round(stats.ratio * 100)}%）`
            : '这个容器下还没有任务'}
        </ThemedText>
      </Card>

      {/* 甘特图 */}
      <Card title="甘特图" hint="它自己和成员任务排在同一条时间轴上">
        <GanttChart
          items={ganttItems}
          emptyHint="给它定个起止时间，或者把带时间的任务挂进来，就能看到条子"
          onDragStateChange={setGanttDragging}
          onReschedule={(item, days) => void shiftTaskByDays(item.id, days)}
          onSelect={(item) => {
            if (item.kind === 'container') return;
            router.push(`/task/${item.id}`);
          }}
        />
      </Card>

      {/* 成员任务 */}
      <Card
        title="任务"
        hint={members.length ? `${members.length} 件` : '还没挂任务'}
        right={
          candidates.length ? (
            <Pressable accessibilityRole="button" onPress={() => setPickingTasks((value) => !value)}>
              <ThemedText type="small" themeColor="textSecondary">
                {pickingTasks ? '收起' : '加入任务'}
              </ThemedText>
            </Pressable>
          ) : null
        }>
        {members.length ? (
          members.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onPress={(t) => router.push(`/task/${t.id}`)}
              onComplete={(t) => void completeTask(t.id)}
              onDelete={(t) => void updateTask(t.id, { containerId: null })}
            />
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            还没有任务。可以在任务详情页的「归属」里选这个容器，也可以点右上角「加入任务」。
          </ThemedText>
        )}

        {pickingTasks ? (
          <View style={styles.pickList}>
            <ThemedText type="small" themeColor="textSecondary">
              以下任务还没有归属（点一下挂进来）
            </ThemedText>
            {candidates.length ? (
              candidates.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  onPress={() => void updateTask(task.id, { containerId: container.id })}
                  style={({ pressed }) => [
                    styles.pickRow,
                    { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
                  ]}>
                  <Ionicons name="add-circle-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="small" numberOfLines={1} style={styles.pickText}>
                    {task.title}
                  </ThemedText>
                  {task.time.dueAt ?? task.time.startAt ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {describeDue(task.time.dueAt ?? task.time.startAt)}
                    </ThemedText>
                  ) : null}
                </Pressable>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                所有任务都有归属了。
              </ThemedText>
            )}
          </View>
        ) : null}
      </Card>

      {/* 子项 */}
      <Card
        title="子项"
        hint={children.length ? `${children.length} 个` : '可以把项目挂在目标下'}
        right={
          <Pressable accessibilityRole="button" onPress={() => setAddingChild((value) => !value)}>
            <ThemedText type="small" themeColor="textSecondary">
              {addingChild ? '收起' : '新建'}
            </ThemedText>
          </Pressable>
        }>
        {children.map((child) => (
          <ContainerRow
            key={child.id}
            container={child}
            stats={containerStats(tasks.filter((t) => t.containerId === child.id))}
            childCount={containers.filter((c) => c.parentId === child.id).length}
            onPress={(target) => router.push(`/container/${target.id}`)}
          />
        ))}

        {addingChild ? (
          <View style={styles.addRow}>
            <TextInput
              value={childTitle}
              onChangeText={setChildTitle}
              placeholder="子项名字"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.inlineInput,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                const next = childTitle.trim();
                if (!next) return;
                const created = await createContainer({
                  title: next,
                  kind: ContainerKind.Project,
                  parentId: container.id,
                });
                setChildTitle('');
                setAddingChild(false);
                router.push(`/container/${created.id}`);
              }}
              style={[styles.smallAction, { backgroundColor: theme.text }]}>
              <ThemedText type="small" style={{ color: theme.background }}>
                建好
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {!children.length && !addingChild ? (
          <ThemedText type="small" themeColor="textSecondary">
            还没有子项。
          </ThemedText>
        ) : null}
      </Card>

      {/* 删除 */}
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
          }
          await removeContainer(container.id);
          router.back();
        }}
        style={({ pressed }) => [
          styles.deleteButton,
          { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
        ]}>
        <ThemedText type="small" themeColor="textSecondary">
          {confirmingDelete ? '再点一次确认删除（任务会保留，只是不再归它）' : '删除这个容器'}
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.background,
          borderColor: active ? theme.text : theme.backgroundSelected,
        },
      ]}>
      <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleInput: { fontSize: 22, lineHeight: 30, fontWeight: '600', padding: 0 },
  noteInput: {
    minHeight: 64,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  settingValue: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  footnote: { fontSize: 12, lineHeight: 16, opacity: 0.8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  pickList: { gap: Spacing.two, paddingTop: Spacing.two },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  pickText: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  inlineInput: {
    flex: 1,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  smallAction: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
