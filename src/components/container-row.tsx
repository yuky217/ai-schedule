import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Container } from '@/domain/container';
import { CONTAINER_KIND_LABEL, describeContainerSpan, type ContainerStats } from '@/domain/container-stats';
import { useTheme } from '@/hooks/use-theme';

/**
 * 容器的列表行（目标 / 项目 / 文件夹共用）。
 *
 * 一行里要有三件事：它是什么（类型）、它叫啥、做到哪了（进度）。
 * 用一条细进度条而不是百分比数字 —— 列表里扫一眼就够，不需要精确到个位。
 */
export interface ContainerRowProps {
  container: Container;
  stats: ContainerStats;
  /** 子容器数量（文件夹、大项目会有） */
  childCount?: number;
  onPress: (container: Container) => void;
  /** 长按：列表页用来弹出「改名 / 标记完成 / 删除」菜单，不进详情页 */
  onLongPress?: (container: Container) => void;
}

export function ContainerRow({ container, stats, childCount = 0, onPress, onLongPress }: ContainerRowProps) {
  const theme = useTheme();
  const span = describeContainerSpan(container);
  const settled = container.status !== 'active';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={container.title}
      onPress={() => onPress(container)}
      onLongPress={onLongPress ? () => onLongPress(container) : undefined}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {container.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.badge}>
            {CONTAINER_KIND_LABEL[container.kind]}
            {settled ? ' · 已完成' : ''}
          </ThemedText>
        </View>

        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.round(stats.ratio * 100)}%`,
                backgroundColor: theme.text,
                opacity: settled ? 0.4 : 1,
              },
            ]}
          />
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {stats.total ? `${stats.done}/${stats.total} 件` : '还没有任务'}
          </ThemedText>
          {childCount ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              含 {childCount} 个子项
            </ThemedText>
          ) : null}
          {span ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              {span}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
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
  body: { flex: 1, gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  title: { flexShrink: 1 },
  badge: { fontSize: 11 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  meta: { fontSize: 11, lineHeight: 15 },
});
