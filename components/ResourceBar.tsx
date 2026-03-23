import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useGame } from '@/contexts/GameContext';
import { useFleet } from '@/contexts/FleetContext';
import { formatNumber, calculateEnergyProduced, calculateEnergyConsumption, getResourceStorageCapacity } from '@/utils/gameCalculations';
import Colors from '@/constants/colors';
import ProductionModal from '@/components/ProductionPanel';

interface ResourceItemProps {
  label: string;
  color: string;
  value: number;
  rate?: number;
  storagePercent?: number;
  storageCap?: number;
}

function getStorageColor(percent: number): string {
  if (percent >= 1) return Colors.danger;
  if (percent >= 0.8) return Colors.warning;
  return '';
}

const ResourceItem = React.memo(function ResourceItem({ label, color, value, rate, storagePercent, storageCap }: ResourceItemProps) {
  const storageColor = storagePercent !== undefined ? getStorageColor(storagePercent) : '';
  const valueColor = storageColor || Colors.text;
  const showStorageBar = storagePercent !== undefined && storageCap !== undefined;

  return (
    <View style={styles.item}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.itemContent}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: valueColor }]}>{formatNumber(value)}</Text>
        {showStorageBar && (
          <View style={styles.storageBarOuter}>
            <View
              style={[
                styles.storageBarInner,
                {
                  width: `${Math.min(100, Math.round(storagePercent * 100))}%` as unknown as number,
                  backgroundColor: storageColor || Colors.primary + '60',
                },
              ]}
            />
          </View>
        )}
        {rate !== undefined && rate > 0 && storagePercent !== undefined && storagePercent >= 1 ? (
          <Text style={[styles.rate, { color: Colors.danger }]}>FULL</Text>
        ) : rate !== undefined && rate > 0 ? (
          <Text style={[styles.rate, { color }]}>+{formatNumber(rate)}/h</Text>
        ) : null}
      </View>
    </View>
  );
});

function IncomingAttackBanner({ missions }: { missions: { arrival_time: number; sender_username: string | null }[] }) {
  const flashAnim = useRef(new Animated.Value(1)).current;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [flashAnim]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const nearest = missions[0];
  const diffMs = nearest.arrival_time - now;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const timeStr = hours > 0
    ? `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`
    : `${mins}m ${String(secs).padStart(2, '0')}s`;

  return (
    <Animated.View style={[attackStyles.banner, { opacity: flashAnim }]}>
      <Text style={attackStyles.icon}>🚨</Text>
      <View style={attackStyles.textWrap}>
        <Text style={attackStyles.title}>
          ATTAQUE{missions.length > 1 ? ` (${missions.length})` : ''}
        </Text>
        <Text style={attackStyles.countdown}>
          {nearest.sender_username ? `${nearest.sender_username} — ` : ''}{timeStr}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function ResourceBar() {
  const { state, activePlanet, activeProduction, activeProductionPercentages } = useGame();
  const { activeMissions, userId } = useFleet();
  const [modalVisible, setModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const incomingAttacks = useMemo(() => {
    const coords = activePlanet.coordinates;
    if (!coords || !userId) return [];
    return activeMissions
      .filter(m =>
        m.mission_type === 'attack' &&
        m.mission_phase === 'en_route' &&
        m.sender_id !== userId &&
        m.target_coords &&
        m.target_coords[0] === coords[0] &&
        m.target_coords[1] === coords[1] &&
        m.target_coords[2] === coords[2]
      )
      .sort((a, b) => a.arrival_time - b.arrival_time);
  }, [activeMissions, activePlanet.coordinates, userId]);

  const energyProduced = calculateEnergyProduced(activePlanet.buildings, state.research, activePlanet.ships, activeProductionPercentages);
  const energyConsumed = calculateEnergyConsumption(activePlanet.buildings, activeProductionPercentages);
  const energyBalance = energyProduced - energyConsumed;
  const energyColor = energyBalance < 0 ? Colors.danger : Colors.energy;

  const storageCap = useMemo(() => getResourceStorageCapacity(activePlanet.buildings), [activePlanet.buildings]);
  const storagePct = useMemo(() => ({
    fer: storageCap.fer > 0 ? activePlanet.resources.fer / storageCap.fer : 0,
    silice: storageCap.silice > 0 ? activePlanet.resources.silice / storageCap.silice : 0,
    xenogas: storageCap.xenogas > 0 ? activePlanet.resources.xenogas / storageCap.xenogas : 0,
  }), [activePlanet.resources.fer, activePlanet.resources.silice, activePlanet.resources.xenogas, storageCap]);

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  return (
    <>
      <View style={[styles.notchSpacer, { height: insets.top }]} />
      <Pressable onPress={openModal}>
        <LinearGradient
          colors={['#0C1628', '#0A1220', '#0E1424']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.container}
        >
          <ResourceItem label="Fer" color={Colors.fer} value={activePlanet.resources.fer} rate={activeProduction.fer} storagePercent={storagePct.fer} storageCap={storageCap.fer} />
          <View style={styles.divider} />
          <ResourceItem label="Silice" color={Colors.silice} value={activePlanet.resources.silice} rate={activeProduction.silice} storagePercent={storagePct.silice} storageCap={storageCap.silice} />
          <View style={styles.divider} />
          <ResourceItem label="Xenogas" color={Colors.xenogas} value={activePlanet.resources.xenogas} rate={activeProduction.xenogas} storagePercent={storagePct.xenogas} storageCap={storageCap.xenogas} />
          <View style={styles.divider} />
          <ResourceItem label="Énergie" color={energyColor} value={energyBalance} />
          <View style={styles.divider} />
          <ResourceItem label="Solar" color={Colors.solar} value={state.solar} />
        </LinearGradient>
      </Pressable>
      {incomingAttacks.length > 0 && (
        <IncomingAttackBanner missions={incomingAttacks} />
      )}
      <ProductionModal visible={modalVisible} onClose={closeModal} />
    </>
  );
}

const attackStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#991B1B',
  },
  icon: {
    fontSize: 16,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  },
  countdown: {
    color: '#FECACA',
    fontSize: 12,
    fontWeight: '600' as const,
    marginTop: 1,
  },
});

const styles = StyleSheet.create({
  notchSpacer: {
    backgroundColor: '#060D1B',
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    ...(Platform.OS !== 'web' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    } : {}),
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: Colors.border,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  itemContent: {
    minWidth: 40,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  label: {
    color: Colors.textMuted,
    fontSize: 8,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  value: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  storageBarOuter: {
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginTop: 2,
    overflow: 'hidden',
  },
  storageBarInner: {
    height: 3,
    borderRadius: 2,
  },
  rate: {
    fontSize: 9,
  },
});
