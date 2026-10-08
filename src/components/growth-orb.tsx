import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/utils/datetime';

/**
 * 专注界面的"小东西"（主文档第六节）。
 *
 * 唯一必须遵守的规则：**只涨不落，不惩罚**。
 * 所以下面的 scale 是累计秒数的单调函数 —— 中途退出、提前结束，
 * 它只会保持原样，绝不会缩回去。动画留到后续版本再加。
 */
export interface GrowthOrbProps {
  /** 累计生长秒数 */
  seconds: number;
  size?: number;
  /** 传 null 不显示；不传默认显示生长时长（首页用默认，专注页大字计时器就在旁边，关掉免得说两遍） */
  caption?: string | null;
}

export function GrowthOrb({ seconds, size = 96, caption }: GrowthOrbProps) {
  const theme = useTheme();

  // 对数增长：前期长得快（有反馈），后期变慢但永不回退
  const level = Math.log10(Math.max(1, seconds / 60) + 1);
  const ratio = Math.min(1, level / 2.2);
  const diameter = size * (0.4 + 0.6 * ratio);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.text,
          opacity: 0.08,
        }}
        pointerEvents="none"
      />
      <View
        style={[
          styles.core,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            backgroundColor: theme.text,
            opacity: 0.35 + 0.5 * ratio,
          },
        ]}
      />
      {caption === null ? null : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
          {caption ?? `已生长 ${formatDuration(seconds)}`}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  core: { position: 'absolute' },
  caption: { position: 'absolute', bottom: -Spacing.four, fontSize: 12 },
});
