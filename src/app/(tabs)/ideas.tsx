import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { AiCapability } from '@/capabilities/types';
import type { Idea } from '@/domain/idea';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { formatMonthDay } from '@/utils/datetime';

/**
 * 想法库（主文档第四节里"软的那一档"）。
 *
 * 三条设计约束在这里是可见的：
 * - 想法不提醒、不催办，只负责"记下来不丢"；
 * - 检索默认是本地模糊匹配，开了「语义检索」后升级成"用一句话找回"；
 * - 归档而不是删除：想法只有被想起来的价值，没有清理的义务。
 *
 * ⚠️ 但"归档"必须**可逆**：归档按钮此前点一下就永久消失（`archived_at`
 * 只被用来过滤，没有任何界面能看到归档过的东西）—— 那就不是"归档"，
 * 是"删掉但骗自己说还能找回来"。所以页脚有一个归档箱：能翻、能放回、也能真删。
 */
export default function IdeasScreen() {
  const theme = useTheme();
  const router = useRouter();

  const ideas = useAppStore((state) => state.ideas);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const capture = useAppStore((state) => state.capture);
  const archiveIdea = useAppStore((state) => state.archiveIdea);
  const loadArchivedIdeas = useAppStore((state) => state.loadArchivedIdeas);
  const unarchiveIdea = useAppStore((state) => state.unarchiveIdea);
  const removeIdea = useAppStore((state) => state.removeIdea);

  const aiEnabled = useSettings((state) => state.aiEnabled);
  const semanticSearchOn = useSettings((state) => state.capabilities[AiCapability.SemanticSearch]);

  const [keyword, setKeyword] = useState('');

  /**
   * 归档箱：默认收起，翻的时候才拉数据。
   * 归档/恢复/删除之后 `dataVersion` 会变，靠它重新拉一遍（不进 refresh）。
   */
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archived, setArchived] = useState<Idea[]>([]);

  const reloadArchived = useCallback(async () => {
    setArchived(await loadArchivedIdeas());
  }, [loadArchivedIdeas]);

  useEffect(() => {
    if (!archiveOpen) return;
    void reloadArchived();
  }, [archiveOpen, dataVersion, reloadArchived]);

  const visible = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return ideas;
    return ideas.filter((idea) => idea.content.toLowerCase().includes(k));
  }, [ideas, keyword]);

  const semanticReady = aiEnabled && semanticSearchOn;

  return (
    <Screen
      title="想法"
      subtitle="不提醒、不催办，只负责不丢"
      right={
        <Pressable hitSlop={8} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      }>
      <CaptureInput
        placeholder="记一个念头、一点灵感…"
        showIdeaToggle={false}
        onSubmit={async (text) => {
          await capture({ text, markedAsInspiration: true });
        }}
      />

      <View
        style={[
          styles.searchBox,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder={semanticReady ? '用一句话找回来（语义检索已开启）' : '按关键词找'}
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
      </View>

      {!semanticReady ? (
        <Card>
          <View style={styles.tipRow}>
            <Ionicons name="bulb-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.tipText}>
              现在的查找是本地关键词匹配。到设置里打开「语义检索」，就能用一句话把以前记过的东西捞出来。
            </ThemedText>
          </View>
        </Card>
      ) : null}

      {visible.length ? (
        <View style={styles.list}>
          {visible.map((idea) => (
            <IdeaRow key={idea.id} idea={idea} onArchive={(id) => void archiveIdea(id)} />
          ))}
        </View>
      ) : (
        <EmptyState
          icon="bulb-outline"
          title={keyword ? '没找到相关想法' : '想法库还是空的'}
          hint={keyword ? '换个说法试试' : '随手记一句，将来的你会感谢现在的你'}
        />
      )}

      {/*
        归档箱。默认收起（它不该跟主列表抢注意力），但必须存在 ——
        否则"归档"按钮就是"永久删除"的委婉说法。
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: archiveOpen }}
        onPress={() => setArchiveOpen((open) => !open)}
        style={({ pressed }) => [styles.archiveToggle, { opacity: pressed ? 0.6 : 1 }]}>
        <Ionicons
          name={archiveOpen ? 'chevron-up' : 'archive-outline'}
          size={14}
          color={theme.textSecondary}
        />
        <ThemedText type="small" themeColor="textSecondary">
          归档箱
        </ThemedText>
      </Pressable>

      {archiveOpen ? (
        <Card hint="归档只是收起来，想法本身还在。想留就放回去，想清就删掉。">
          {archived.length ? (
            archived.map((idea) => (
              <View key={idea.id} style={styles.archivedRow}>
                <View style={styles.ideaBody}>
                  <ThemedText type="small" numberOfLines={3}>
                    {idea.content}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.ideaMeta}>
                    {formatMonthDay(new Date(idea.createdAt))} 记下
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="放回想法库"
                  hitSlop={8}
                  onPress={() => void unarchiveIdea(idea.id)}>
                  <Ionicons name="arrow-undo-outline" size={17} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="彻底删掉这条想法"
                  hitSlop={8}
                  onPress={() => void removeIdea(idea.id)}>
                  <Ionicons name="trash-outline" size={17} color={theme.textSecondary} />
                </Pressable>
              </View>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              还没有归档过东西。
            </ThemedText>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

function IdeaRow({ idea, onArchive }: { idea: Idea; onArchive: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.ideaRow, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.ideaBody}>
        <ThemedText numberOfLines={5}>{idea.content}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.ideaMeta}>
          {formatMonthDay(new Date(idea.createdAt))} 记下
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="归档这条想法（可以在下面的归档箱里找回来）"
        hitSlop={8}
        onPress={() => onArchive(idea.id)}>
        <Ionicons name="archive-outline" size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: Spacing.one },
  tipRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  tipText: { flex: 1, lineHeight: 18 },
  list: { gap: Spacing.two },
  ideaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  ideaBody: { flex: 1, gap: Spacing.one },
  ideaMeta: { fontSize: 12 },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
