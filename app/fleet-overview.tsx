import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Animated, Easing } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Rocket, ArrowLeft, ScanEye, Crosshair, Truck, Clock, ChevronRight, ChevronDown, Recycle, Anchor, ArrowRight, Shield, HelpCircle, Eye, EyeOff, RotateCcw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import ClickableCoords from '@/components/ClickableCoords';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFleet } from '@/contexts/FleetContext';
import { FleetMission, MissionType } from '@/types/fleet';
import { formatTime } from '@/utils/gameCalculations';
import { SHIPS } from '@/constants/gameData';
import Colors from '@/constants/colors';


const SHIP_NAMES: Record<string, string> = {};
for (const ship of SHIPS) {
  SHIP_NAMES[ship.id] = ship.name;
}

const MISSION_CONFIG: Record<MissionType, { label: string; icon: React.ComponentType<{ size: number; color: string }>; color: string }> = {
  attack: { label: 'Attaque', icon: Crosshair, color: Colors.danger },
  transport: { label: 'Transport', icon: Truck, color: Colors.success },
  espionage: { label: 'Espionnage', icon: ScanEye, color: Colors.silice },
  colonize: { label: 'Colonisation', icon: Rocket, color: Colors.energy },
  recycle: { label: 'Recyclage', icon: Recycle, color: Colors.warning },
  station: { label: 'Stationner', icon: Anchor, color: Colors.silice },
};

function getSonarVisibility(espionageTechLevel: number): 'none' | 'count' | 'types' | 'full' {
  if (espionageTechLevel >= 5) return 'full';
  if (espionageTechLevel >= 3) return 'types';
  if (espionageTechLevel >= 1) return 'count';
  return 'none';
}

const CountdownTimer = React.memo(function CountdownTimer({ endTime }: { endTime: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((endTime - Date.now()) / 1000)));

  useEffect(() => {
    const update = () => {
      const r = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemaining(r);
    };
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [endTime]);

  return (
    <View style={styles.missionTimer}>
      <Clock size={11} color={remaining > 0 ? Colors.primary : Colors.success} />
      <Text style={[styles.missionTime, remaining === 0 && { color: Colors.success }]}>
        {remaining > 0 ? formatTime(remaining) : 'Arrivé'}
      </Text>
    </View>
  );
});

const MissionCard = React.memo(function MissionCard({ mission, isSender, sonarLevel, onRecall, isRecalling }: { mission: FleetMission; isSender: boolean; sonarLevel: number; onRecall?: (id: string) => void; isRecalling?: boolean }) {
  const config = MISSION_CONFIG[mission.mission_type] ?? MISSION_CONFIG.attack;
  const Icon = config.icon;
  const isReturning = mission.mission_phase === 'returning';
  const expandedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const chevronAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const startTime = isReturning ? mission.arrival_time : mission.departure_time;
  const endTime = isReturning ? (mission.return_time ?? mission.arrival_time) : mission.arrival_time;

  useEffect(() => {
    const totalDuration = endTime - startTime;
    if (totalDuration <= 0) {
      progressAnim.setValue(1);
      return;
    }
    const now = Date.now();
    const currentProgress = Math.min(1, Math.max(0, (now - startTime) / totalDuration));
    const remainingMs = Math.max(0, endTime - now);
    progressAnim.setValue(currentProgress);
    if (currentProgress < 1 && remainingMs > 0) {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: remainingMs,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }
  }, [startTime, endTime, progressAnim]);

  const shipEntries = Object.entries(mission.ships).filter(([, c]) => c > 0);
  const shipCount = shipEntries.reduce((s, [, c]) => s + c, 0);

  const visibility = isSender ? 'full' : getSonarVisibility(sonarLevel);

  const toggleExpand = useCallback(() => {
    const next = !expandedRef.current;
    expandedRef.current = next;
    setExpanded(next);
    Animated.timing(chevronAnim, {
      toValue: next ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [chevronAnim]);

  const chevronRotation = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={toggleExpand}
      style={[styles.missionCard, { borderLeftColor: config.color, borderLeftWidth: 3 }]}
    >
      <View style={styles.missionHeader}>
        <View style={[styles.missionIconWrap, { backgroundColor: config.color + '18' }]}>
          <Icon size={16} color={config.color} />
        </View>
        <View style={styles.missionInfo}>
          <View style={styles.missionTypeRow}>
            <Text style={styles.missionType}>{config.label}</Text>
            {isReturning && (
              <View style={styles.returningBadge}>
                <ArrowLeft size={9} color={Colors.success} />
                <Text style={styles.returningText}>Retour</Text>
              </View>
            )}
          </View>
          <View style={styles.routeRow}>
            <View style={styles.routeEndpoint}>
              <Text style={styles.routeLabel}>{isSender ? 'Vous' : (mission.sender_username || '???')}</Text>
              <ClickableCoords coords={mission.sender_coords} style={styles.routeCoords} />
            </View>
            <View style={styles.arrowContainer}>
              {isReturning ? (
                <ArrowLeft size={14} color={Colors.success} />
              ) : (
                <ArrowRight size={14} color={config.color} />
              )}
            </View>
            <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
              <Text style={styles.routeLabel}>
                {mission.target_username || (mission.mission_type === 'recycle' ? 'Champ de Débris' : (isSender ? 'Vide' : 'Vous'))}
              </Text>
              <ClickableCoords coords={mission.target_coords} style={styles.routeCoords} />
            </View>
          </View>
        </View>
        <View style={styles.missionRight}>
          <CountdownTimer endTime={endTime} />
          <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
            <ChevronDown size={14} color={Colors.textMuted} />
          </Animated.View>
        </View>
      </View>

      <View style={styles.progressBarBg}>
        <Animated.View style={[styles.progressBarFill, { width: progressWidth, backgroundColor: config.color }]}>
          <View style={[styles.progressBarGlow, { backgroundColor: config.color }]} />
        </Animated.View>
        <Animated.View style={[
          styles.shipIcon,
          {
            left: progressAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}>
          <Rocket size={10} color={config.color} style={{ transform: [{ rotate: '90deg' }] }} />
        </Animated.View>
      </View>

      <View style={styles.missionFooter}>
        <Text style={styles.missionShips}>
          {isSender || visibility !== 'none'
            ? `${shipCount} vaisseau${shipCount > 1 ? 'x' : ''}`
            : 'Flotte inconnue'}
        </Text>
      </View>

      {expanded && (
        <View style={styles.expandedSection}>
          <View style={styles.divider} />

          <Text style={styles.detailSectionTitle}>
            {isSender ? 'Composition de votre flotte' : 'Renseignements sur la flotte'}
          </Text>

          {isSender || visibility === 'full' ? (
            <View style={styles.shipGrid}>
              {shipEntries.map(([id, count]) => (
                <View key={id} style={styles.shipRow}>
                  <Text style={styles.shipName}>{SHIP_NAMES[id] ?? id}</Text>
                  <Text style={styles.shipCount}>x{count}</Text>
                </View>
              ))}
            </View>
          ) : visibility === 'types' ? (
            <View style={styles.shipGrid}>
              {shipEntries.map(([id]) => (
                <View key={id} style={styles.shipRow}>
                  <Text style={styles.shipName}>{SHIP_NAMES[id] ?? id}</Text>
                  <Text style={styles.shipCountHidden}>?</Text>
                </View>
              ))}
              <View style={styles.sonarHint}>
                <Eye size={11} color={Colors.textMuted} />
                <Text style={styles.sonarHintText}>Sonar niv.5 requis pour les quantités</Text>
              </View>
            </View>
          ) : visibility === 'count' ? (
            <View style={styles.unknownFleet}>
              <Shield size={14} color={Colors.textMuted} />
              <Text style={styles.unknownFleetText}>{shipCount} vaisseau{shipCount > 1 ? 'x' : ''} détecté{shipCount > 1 ? 's' : ''}</Text>
              <View style={styles.sonarHint}>
                <Eye size={11} color={Colors.textMuted} />
                <Text style={styles.sonarHintText}>Sonar niv.3 requis pour les types</Text>
              </View>
            </View>
          ) : (
            <View style={styles.unknownFleet}>
              <EyeOff size={14} color={Colors.textMuted} />
              <Text style={styles.unknownFleetText}>Flotte non identifiée</Text>
              <View style={styles.sonarHint}>
                <HelpCircle size={11} color={Colors.textMuted} />
                <Text style={styles.sonarHintText}>Recherchez Sonar Cosmique pour scanner</Text>
              </View>
            </View>
          )}

          {isSender && mission.resources && (mission.resources.fer > 0 || mission.resources.silice > 0 || mission.resources.xenogas > 0) && (
            <>
              <Text style={styles.detailSectionTitle}>Ressources transportées</Text>
              <View style={styles.resourceRow}>
                {mission.resources.fer > 0 && (
                  <View style={styles.resourceItem}>
                    <View style={[styles.resourceDot, { backgroundColor: Colors.fer }]} />
                    <Text style={styles.resourceText}>{Math.floor(mission.resources.fer).toLocaleString()} Fer</Text>
                  </View>
                )}
                {mission.resources.silice > 0 && (
                  <View style={styles.resourceItem}>
                    <View style={[styles.resourceDot, { backgroundColor: Colors.silice }]} />
                    <Text style={styles.resourceText}>{Math.floor(mission.resources.silice).toLocaleString()} Silice</Text>
                  </View>
                )}
                {mission.resources.xenogas > 0 && (
                  <View style={styles.resourceItem}>
                    <View style={[styles.resourceDot, { backgroundColor: Colors.xenogas }]} />
                    <Text style={styles.resourceText}>{Math.floor(mission.resources.xenogas).toLocaleString()} Xenogas</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {mission.sender_planet && isSender && (
            <View style={styles.detailMeta}>
              <Text style={styles.detailMetaText}>Départ : {mission.sender_planet}</Text>
            </View>
          )}
          {mission.target_planet && (
            <View style={styles.detailMeta}>
              <Text style={styles.detailMetaText}>Destination : {mission.target_planet}</Text>
            </View>
          )}

          {isSender && onRecall && !isReturning && (
            mission.mission_type !== 'attack' || mission.mission_phase !== 'arrived'
          ) && (mission.mission_phase === 'en_route' || mission.mission_phase === 'arrived') ? (
            <TouchableOpacity
              style={styles.recallBtn}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onRecall(mission.id);
              }}
              disabled={isRecalling}
              activeOpacity={0.7}
            >
              <RotateCcw size={13} color={isRecalling ? Colors.textMuted : Colors.warning} />
              <Text style={[styles.recallText, isRecalling && { color: Colors.textMuted }]}>
                {isRecalling ? 'Rappel...' : 'Rappeler la flotte'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.mission.id === next.mission.id
    && prev.mission.mission_phase === next.mission.mission_phase
    && prev.mission.arrival_time === next.mission.arrival_time
    && prev.mission.return_time === next.mission.return_time
    && prev.isSender === next.isSender
    && prev.sonarLevel === next.sonarLevel
    && prev.isRecalling === next.isRecalling;
});

export default function FleetOverviewScreen() {
  const router = useRouter();
  const { activeMissions, refreshMissions, sonarLevel, userId, recallFleet } = useFleet();
  const [refreshing, setRefreshing] = useState(false);

  const [recallingId, setRecallingId] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    refreshMissions();
    setTimeout(() => setRefreshing(false), 1000);
  }, [refreshMissions]);

  const handleRecall = useCallback(async (missionId: string) => {
    setRecallingId(missionId);
    try {
      await recallFleet(missionId);
      console.log('[FleetOverview] Fleet recalled:', missionId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.log('[FleetOverview] Recall error:', msg);
    } finally {
      setRecallingId(null);
    }
  }, [recallFleet]);

  const visibleMissions = activeMissions.filter(m => {
    if (m.sender_id === userId) return true;
    if (m.target_player_id === userId && m.mission_phase === 'en_route') return true;
    return false;
  });

  const outgoing = visibleMissions.filter(m => m.mission_phase === 'en_route' || m.mission_phase === 'arrived');
  const returning = visibleMissions.filter(m => m.mission_phase === 'returning');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Mouvements de Flotte</Text>
          <TouchableOpacity onPress={() => router.push('/reports')} style={styles.reportBtn}>
            <Text style={styles.reportText}>Rapports</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {visibleMissions.length === 0 && (
            <View style={styles.emptyState}>
              <Rocket size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucune flotte en mouvement</Text>
              <Text style={styles.emptyDesc}>
                Envoyez des vaisseaux depuis la vue Galaxie pour les voir ici.
              </Text>
            </View>
          )}

          {outgoing.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>En route ({outgoing.length})</Text>
              {outgoing.map(m => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  isSender={m.sender_id === userId}
                  sonarLevel={sonarLevel}
                  onRecall={m.sender_id === userId ? handleRecall : undefined}
                  isRecalling={recallingId === m.id}
                />
              ))}
            </>
          )}

          {returning.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>En retour ({returning.length})</Text>
              {returning.map(m => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  isSender={m.sender_id === userId}
                  sonarLevel={sonarLevel}
                />
              ))}
            </>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 60,
  },
  backText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  reportBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
  },
  reportText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 8,
  },
  missionCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  missionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  missionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  missionInfo: {
    flex: 1,
  },
  missionTypeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  missionType: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  missionRight: {
    alignItems: 'flex-end' as const,
    gap: 6,
  },
  missionTimer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  missionTime: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  routeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  routeEndpoint: {
    flex: 1,
  },
  routeEndpointRight: {
    alignItems: 'flex-end' as const,
  },
  routeLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500' as const,
    marginBottom: 1,
  },
  routeCoords: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  arrowContainer: {
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  progressBarBg: {
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 6,
    overflow: 'visible' as const,
    position: 'relative' as const,
  },
  progressBarFill: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  progressBarGlow: {
    position: 'absolute' as const,
    right: 0,
    top: -1,
    width: 12,
    height: 5,
    borderRadius: 3,
    opacity: 0.6,
  },
  shipIcon: {
    position: 'absolute' as const,
    top: -9,
    marginLeft: -5,
  },
  missionFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  missionShips: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  returningBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  returningText: {
    color: Colors.success,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  expandedSection: {
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 10,
  },
  detailSectionTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  shipGrid: {
    marginBottom: 10,
  },
  shipRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: Colors.surface,
    borderRadius: 6,
    marginBottom: 3,
  },
  shipName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  shipCount: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  shipCountHidden: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  unknownFleet: {
    alignItems: 'center' as const,
    paddingVertical: 10,
    gap: 6,
    marginBottom: 10,
  },
  unknownFleetText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  sonarHint: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
  },
  sonarHintText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic' as const,
  },
  resourceRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 10,
  },
  resourceItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
  },
  resourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  resourceText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '500' as const,
  },
  detailMeta: {
    marginBottom: 4,
  },
  detailMetaText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  recallBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.warning + '12',
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  recallText: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  emptyDesc: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center' as const,
    paddingHorizontal: 40,
  },
});
