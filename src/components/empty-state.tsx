import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** 空状态：永远告诉用户"下一步该做什么"，而不是只说"没有数据" */
export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
}

export function EmptyState({ icon = 'sparkles-outline', title, hint }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrapper}>
      <Ionicons name={icon} size={28} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  title: { textAlign: 'center' },
  hint: { textAlign: 'center', fontSize: 12, opacity: 0.7, maxWidth: 280 },
});
