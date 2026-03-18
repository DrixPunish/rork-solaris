import React, { useState, useCallback, useRef, useMemo } from 'react';
import ClickableCoords from '@/components/ClickableCoords';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { Trophy, Shield, Rocket, FlaskConical, Hammer, ChevronDown } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useGame } from '@/contexts/GameContext';
import { formatNumber } from '@/utils/gameCalculations';
import { trpc } from '@/lib/trpc';

type ScoreCategory = 'total' | 'building' | 'research' | 'fleet' | 'defense';

interface ServerPlayerScore {
  player_id: string;
  username: string;
  coordinates: number[];
  total_points: number;
  building_points: number;
  research_points: number;
  fleet_points: number;
  defense_points: number;
  rank: number;
}

const CATEGORY_CONFIG: Record<ScoreCategory, { label: string; icon: React.ReactNode; color: string }> = {
  total: { label: 'Général', icon: <Trophy size={16} color={Colors.energy} />, color: Colors.energy },
  building: { label: 'Bâtiments', icon: <Hammer size={16} color={Colors.fer} />, color: Colors.fer },
  research: { label: 'Recherche', icon: <FlaskConical size={16} color={Colors.silice} />, color: Colors.silice },
  fleet: { label: 'Flotte', icon: <Rocket size={16} color={Colors.xenogas} />, color: Colors.xenogas },
  defense: { label: 'Défense', icon: <Shield size={16} color={Colors.primary} />, color: Colors.primary },
};

function getPointsForCategory(score: ServerPlayerScore, cat: ScoreCategory): number {
  switch (cat) {
    case 'total': return score.total_points;
    case 'building': return score.building_points;
    case 'research': return score.research_points;
    case 'fleet': return score.fleet_points;
    case 'defense': return score.defense_points;
  }
}

function getMedalColor(rank: number): string | null {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return null;
}

export default function LeaderboardScreen() {
  const { userId } = useGame();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<ScoreCategory>('total');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const pickerAnim = useRef(new Animated.Value(0)).current;

  const leaderboardQuery = trpc.world.getLeaderboard.useQuery(
    { limit: 100 },
    {
      refetchInterval: 30000,
    },
  );

  const players = useMemo(() => leaderboardQuery.data?.players ?? [], [leaderboardQuery.data]);

  const sortedScores = useMemo(() => {
    if (!players.length) return [];
    return [...players].sort((a, b) => getPointsForCategory(b, category) - getPointsForCategory(a, category));
  }, [players, category]);

  const myRank = useMemo(() => {
    if (!userId) return null;
    const idx = sortedScores.findIndex(s => s.player_id === userId);
    return idx >= 0 ? idx + 1 : null;
  }, [sortedScores, userId]);

  const myScore = useMemo(() => {
    if (!userId) return null;
    return sortedScores.find(s => s.player_id === userId) ?? null;
  }, [sortedScores, userId]);

  const togglePicker = useCallback(() => {
    const toValue = showCategoryPicker ? 0 : 1;
    setShowCategoryPicker(!showCategoryPicker);
    Animated.spring(pickerAnim, {
      toValue,
      useNativeDriver: false,
      friction: 8,
    }).start();
  }, [showCategoryPicker, pickerAnim]);

  const selectCategory = useCallback((cat: ScoreCategory) => {
    setCategory(cat);
    setShowCategoryPicker(false);
    Animated.spring(pickerAnim, {
      toValue: 0,
      useNativeDriver: false,
      friction: 8,
    }).start();
  }, [pickerAnim]);

  const pickerHeight = pickerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 220],
  });

  const rotateChevron = pickerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const renderItem = useCallback(({ item, index }: { item: ServerPlayerScore; index: number }) => {
    const rank = index + 1;
    const isMe = item.player_id === userId;
    const medal = getMedalColor(rank);
    const points = getPointsForCategory(item, category);

    const coords: [number, number, number] = Array.isArray(item.coordinates)
      ? [item.coordinates[0] ?? 1, item.coordinates[1] ?? 1, item.coordinates[2] ?? 1]
      : [1, 1, 1];

    return (
      <View style={[styles.row, isMe && styles.rowMe]} testID={`leaderboard-row-${rank}`}>
        <View style={styles.rankContainer}>
          {medal ? (
            <View style={[styles.medalCircle, { backgroundColor: medal }]}>
              <Text style={styles.medalText}>{rank}</Text>
            </View>
          ) : (
            <Text style={styles.rankText}>{rank}</Text>
          )}
        </View>
        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, isMe && styles.playerNameMe]} numberOfLines={1}>
            {item.username}{isMe ? ' (vous)' : ''}
          </Text>
          <ClickableCoords coords={coords} style={styles.playerCoords} />
        </View>
        <View style={styles.pointsContainer}>
          <Text style={[styles.pointsText, isMe && styles.pointsTextMe]}>
            {formatNumber(points)}
          </Text>
          <Text style={styles.pointsLabel}>pts</Text>
        </View>
      </View>
    );
  }, [userId, category]);

  const keyExtractor = useCallback((item: ServerPlayerScore) => item.player_id, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Classement' }} />
      <View style={[styles.notchSpacer, { height: insets.top }]} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.categorySelector}
          onPress={togglePicker}
          activeOpacity={0.7}
          testID="category-selector"
        >
          <View style={styles.categorySelectorInner}>
            {CATEGORY_CONFIG[category].icon}
            <Text style={[styles.categorySelectorText, { color: CATEGORY_CONFIG[category].color }]}>
              {CATEGORY_CONFIG[category].label}
            </Text>
            <Animated.View style={{ transform: [{ rotate: rotateChevron }] }}>
              <ChevronDown size={18} color={Colors.textSecondary} />
            </Animated.View>
          </View>
        </TouchableOpacity>

        {myScore && myRank && (
          <View style={styles.myRankBadge}>
            <Text style={styles.myRankLabel}>Vous</Text>
            <Text style={styles.myRankNumber}>#{myRank}</Text>
          </View>
        )}
      </View>

      <Animated.View style={[styles.pickerContainer, { height: pickerHeight }]}>
        <View style={styles.pickerInner}>
          {(Object.keys(CATEGORY_CONFIG) as ScoreCategory[]).map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const isActive = cat === category;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.pickerItem, isActive && styles.pickerItemActive]}
                onPress={() => selectCategory(cat)}
                activeOpacity={0.7}
              >
                {config.icon}
                <Text style={[styles.pickerItemText, isActive && { color: config.color }]}>
                  {config.label}
                </Text>
                {isActive && <View style={[styles.pickerDot, { backgroundColor: config.color }]} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>

      {myScore && (
        <View style={styles.myStatsBar}>
          <View style={styles.statItem}>
            <Hammer size={12} color={Colors.fer} />
            <Text style={styles.statValue}>{formatNumber(myScore.building_points)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <FlaskConical size={12} color={Colors.silice} />
            <Text style={styles.statValue}>{formatNumber(myScore.research_points)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Rocket size={12} color={Colors.xenogas} />
            <Text style={styles.statValue}>{formatNumber(myScore.fleet_points)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Shield size={12} color={Colors.primary} />
            <Text style={styles.statValue}>{formatNumber(myScore.defense_points)}</Text>
          </View>
        </View>
      )}

      {leaderboardQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Chargement du classement...</Text>
        </View>
      ) : leaderboardQuery.isError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Erreur de chargement</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => leaderboardQuery.refetch()}
          >
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : sortedScores.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Trophy size={48} color={Colors.textMuted} />
          <Text style={styles.emptyText}>Aucun joueur pour le moment</Text>
        </View>
      ) : (
        <FlatList
          data={sortedScores}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={leaderboardQuery.isFetching && !leaderboardQuery.isLoading}
              onRefresh={() => leaderboardQuery.refetch()}
              tintColor={Colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  notchSpacer: {
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  categorySelector: {
    flex: 1,
    marginRight: 12,
  },
  categorySelectorInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  categorySelectorText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  myRankBadge: {
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primaryDim,
  },
  myRankLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  myRankNumber: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  pickerContainer: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerInner: {
    padding: 12,
    gap: 4,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 10,
  },
  pickerItemActive: {
    backgroundColor: Colors.card,
  },
  pickerItemText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  pickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  myStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.border,
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 12,
    marginVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowMe: {
    borderColor: Colors.primaryDim,
    backgroundColor: 'rgba(212, 168, 71, 0.06)',
  },
  rankContainer: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#1a1a1a',
  },
  rankText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },
  playerInfo: {
    flex: 1,
    marginLeft: 10,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  playerNameMe: {
    color: Colors.primary,
  },
  playerCoords: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  pointsContainer: {
    alignItems: 'flex-end',
    marginLeft: 10,
  },
  pointsText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  pointsTextMe: {
    color: Colors.primary,
  },
  pointsLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: Colors.danger,
    fontWeight: '600' as const,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: '#0A0A14',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
