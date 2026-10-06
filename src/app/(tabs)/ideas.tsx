import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
 */
export default function IdeasScreen() {
  const theme = useTheme();
  const router = useRouter();

  const ideas = useAppStore((state) => state.ideas);
  const capture = useAppStore((state) => state.capture);
  const archiveIdea = useAppStore((state) => state.archiveIdea);

  const aiEnabled = useSettings((state) => state.aiEnabled);
  const semanticSearchOn = useSettings((state) => state.capabilities[AiCapability.SemanticSearch]);

  const [keyword, setKeyword] = useState('');

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
      <Pressable hitSlop={8} onPress={() => onArchive(idea.id)}>
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
});
