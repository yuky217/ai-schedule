import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** 分组卡片：把一组相关内容圈在一起，降低页面的视觉噪音 */
export interface CardProps {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ title, hint, right, children, style }: CardProps) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>
      {title || right ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
            {hint ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {hint}
              </ThemedText>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerText: { flex: 1, gap: Spacing.half },
  hint: { fontSize: 12, lineHeight: 16 },
  body: { gap: Spacing.two },
});
