import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { searchAll, type SearchGroupKey } from '@/domain/search';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 全库搜索（2026-10-10）。
 *
 * 从首页右上角那颗放大镜进来 —— 首页是回得最频的地方，
 * "我现在想起来要找什么"也总是从那儿开始。
 *
 * 匹配口径全在 `domain/search.ts`（纯函数、有测试），这一页只负责：
 * 递数据、画结果、把每一条送回它自己的家。
 *
 * ⚠️ 这是**子串匹配**，不是语义检索。所以输入框的提示语只说"找标题、备注、地点"，
 * 不承诺"懂你的意思" —— 界面在承诺、代码不兑现，比不做更伤。
 */
export default function SearchScreen() {
  const router = useRouter();
  const theme = useTheme();

  const [keyword, setKeyword] = useState('');

  const tasks = useAppStore((state) => state.tasks);
  const containers = useAppStore((state) => state.containers);
  const courses = useAppStore((state) => state.courses);
  const marks = useAppStore((state) => state.marks);
  const ideas = useAppStore((state) => state.ideas);

  const groups = useMemo(
    () => searchAll(keyword, { tasks, containers, courses, marks, ideas }),
    [containers, courses, ideas, keyword, marks, tasks],
  );

  /** 每一条点回它自己的家 */
  const openHit = useCallback(
    (group: SearchGroupKey, id: string) => {
      switch (group) {
        case 'task':
          router.push(`/task/${id}`);
          return;
        case 'container':
          router.push(`/container/${id}`);
          return;
        case 'course':
          router.push(`/course/${id}`);
          return;
        case 'mark':
          router.push('/marks');
          return;
        case 'idea':
          // 想法页有它自己的搜索框，把当前关键词带过去预填 —— 落地就能看到那条
          router.push({ pathname: '/ideas', params: { q: keyword.trim() } });
          return;
      }
    },
    [keyword, router],
  );

  const searching = keyword.trim().length > 0;

  return (
    <Screen title="搜索">
      <View
        style={[
          styles.box,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          autoFocus
          placeholder="找标题、备注、地点…"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
        />
        {searching ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空"
            hitSlop={8}
            onPress={() => setKeyword('')}>
            <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {groups.length ? (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <View style={styles.groupHead}>
              <Ionicons
                name={GROUP_ICON[group.key]}
                size={14}
                color={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {group.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {group.hits.length}
              </ThemedText>
            </View>
            {group.hits.map((hit) => (
              <Pressable
                key={hit.id}
                accessibilityRole="button"
                onPress={() => openHit(group.key, hit.id)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={styles.rowBody}>
                  <ThemedText numberOfLines={2}>{hit.title}</ThemedText>
                  {hit.subtitle ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.rowMeta}>
                      {hit.subtitle}
                    </ThemedText>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
              </Pressable>
            ))}
          </View>
        ))
      ) : (
        <EmptyState
          icon={searching ? 'search-outline' : 'search'}
          title={searching ? '没找到' : '搜点什么'}
          hint={
            searching
              ? '试试少写几个字 —— 它按字面找，记不清原话就先搜个词'
              : '任务、项目、课程、纪念日、想法，一次全找'
          }
        />
      )}
    </Screen>
  );
}

/** 每组前面那颗小图标：一眼知道这一堆是什么 */
const GROUP_ICON: Record<SearchGroupKey, keyof typeof Ionicons.glyphMap> = {
  task: 'checkbox-outline',
  container: 'folder-outline',
  course: 'school-outline',
  mark: 'gift-outline',
  idea: 'bulb-outline',
};

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: Spacing.one },
  group: { gap: Spacing.one },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowBody: { flex: 1, gap: Spacing.half },
  rowMeta: { fontSize: 12 },
});
