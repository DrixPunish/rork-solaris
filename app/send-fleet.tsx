import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Rocket, Crosshair, Truck, ScanEye, Minus, Plus, ArrowRight, Clock, Package, Recycle, Globe, Warehouse, Fuel } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGame } from '@/contexts/GameContext';
import { useFleet } from '@/contexts/FleetContext';
import { SHIPS } from '@/constants/gameData';
import { MissionType } from '@/types/fleet';
import { getFleetCargoCapacity } from '@/utils/fleetCalculations';
import { trpcClient } from '@/lib/trpc';
import { formatTime, formatNumber } from '@/utils/gameCalculations';
import Colors from '@/constants/colors';
import { showGameAlert } from '@/components/GameAlert';

const MISSION_TYPES: { id: MissionType; label: string; icon: React.ComponentType<{ size: number; color: string }>; color: string; description: string }[] = [
  { id: 'attack', label: 'Attaque', icon: Crosshair, color: Colors.danger, description: 'Attaquer la planète cible' },
  { id: 'transport', label: 'Transport', icon: Truck, color: Colors.success, description: 'Envoyer des ressources' },
  { id: 'station', label: 'Stationner', icon: Warehouse, color: Colors.primary, description: 'Transférer vaisseaux et ressources' },
  { id: 'espionage', label: 'Espionnage', icon: ScanEye, color: Colors.silice, description: 'Envoyer des sondes' },
  { id: 'recycle', label: 'Recyclage', icon: Recycle, color: Colors.warning, description: 'Collecter les débris' },
  { id: 'colonize', label: 'Coloniser', icon: Globe, color: Colors.xenogas, description: 'Fonder une colonie' },
];

export default function SendFleetScreen() {
  const params = useLocalSearchParams<{
    targetGalaxy: string;
    targetSystem: string;
    targetPosition: string;
    targetPlayerId: string;
    targetUsername: string;
    targetPlanet: string;
    defaultMission: string;
  }>();
  const router = useRouter();
  const { state, userId } = useGame();
  const { sendFleet, isSending } = useFleet();

  const targetCoords = useMemo<[number, number, number]>(() => [
    parseInt(params.targetGalaxy ?? '1', 10),
    parseInt(params.targetSystem ?? '1', 10),
    parseInt(params.targetPosition ?? '1', 10),
  ], [params.targetGalaxy, params.targetSystem, params.targetPosition]);

  const [missionType, setMissionType] = useState<MissionType>(
    (params.defaultMission as MissionType) ?? 'attack',
  );
  const [selectedShips, setSelectedShips] = useState<Record<string, number>>({});
  const [transportResources, setTransportResources] = useState({ fer: 0, silice: 0, xenogas: 0 });

  const availableShips = useMemo(() => {
    return SHIPS.filter(s => (state.ships[s.id] ?? 0) > 0);
  }, [state.ships]);

  const isEspionage = missionType === 'espionage';
  const isColonize = missionType === 'colonize';

  const fleetForCalc = useMemo(() => {
    if (isEspionage) {
      return { spectreSonde: selectedShips.spectreSonde ?? 0 };
    }
    if (isColonize) {
      return { colonyShip: selectedShips.colonyShip ?? 0 };
    }
    return selectedShips;
  }, [selectedShips, isEspionage, isColonize]);

  const hasShips = useMemo(() => {
    return Object.values(fleetForCalc).some(c => c > 0);
  }, [fleetForCalc]);

  const [serverFlightData, setServerFlightData] = useState<{
    distance: number;
    flight_time_sec: number;
    slowest_speed: number;
    fuel_cost: number;
  } | null>(null);
  const [isLoadingFlight, setIsLoadingFlight] = useState(false);

  useEffect(() => {
    if (!hasShips) {
      setServerFlightData(null);
      return;
    }

    const shipsToSend: Record<string, number> = {};
    for (const [id, count] of Object.entries(fleetForCalc)) {
      if (count > 0) shipsToSend[id] = count;
    }
    if (Object.keys(shipsToSend).length === 0) {
      setServerFlightData(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFlight(true);

    if (!userId) {
      setIsLoadingFlight(false);
      return;
    }

    trpcClient.world.calculateFlightTime.query({
      userId,
      senderCoords: state.coordinates as number[],
      targetCoords: targetCoords as number[],
      ships: shipsToSend,
    }).then(result => {
      if (cancelled) return;
      if (result.success) {
        setServerFlightData({
          distance: result.distance,
          flight_time_sec: result.flight_time_sec,
          slowest_speed: result.slowest_speed,
          fuel_cost: result.fuel_cost,
        });
        console.log('[SendFleet] Server flight time:', result.flight_time_sec, 's, distance:', result.distance, ', fuel:', result.fuel_cost);
      } else {
        console.log('[SendFleet] Flight calc error:', result.error);
        setServerFlightData(null);
      }
    }).catch(err => {
      if (!cancelled) {
        console.log('[SendFleet] Flight calc fetch error:', err);
        setServerFlightData(null);
      }
    }).finally(() => {
      if (!cancelled) setIsLoadingFlight(false);
    });

    return () => { cancelled = true; };
  }, [hasShips, fleetForCalc, state.coordinates, targetCoords, userId]);

  const travelTime = serverFlightData?.flight_time_sec ?? 0;
  const distance = serverFlightData?.distance ?? 0;
  const fuelCost = serverFlightData?.fuel_cost ?? 0;
  const availableXenogas = Math.floor(state.resources.xenogas);
  const cargoXenogas = (missionType === 'transport' || missionType === 'station') ? transportResources.xenogas : 0;
  const totalXenogasNeeded = fuelCost + cargoXenogas;
  const insufficientFuel = hasShips && fuelCost > 0 && availableXenogas < totalXenogasNeeded;

  const cargoCapacity = useMemo(() => {
    return getFleetCargoCapacity(fleetForCalc, state.research);
  }, [fleetForCalc, state.research]);

  const totalTransport = transportResources.fer + transportResources.silice + transportResources.xenogas;

  const updateShipCount = useCallback((shipId: string, delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedShips(prev => {
      const max = state.ships[shipId] ?? 0;
      const current = prev[shipId] ?? 0;
      const next = Math.max(0, Math.min(max, current + delta));
      return { ...prev, [shipId]: next };
    });
  }, [state.ships]);

  const setAllShips = useCallback((shipId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedShips(prev => ({
      ...prev,
      [shipId]: state.ships[shipId] ?? 0,
    }));
  }, [state.ships]);

  const handleSend = useCallback(async () => {
    if (!hasShips) return;

    if (!serverFlightData && !isLoadingFlight) {
      showGameAlert('Erreur', 'Impossible de calculer le temps de vol. Réessayez.');
      return;
    }

    if (insufficientFuel) {
      showGameAlert('Xenogas insuffisant', `Il vous faut ${formatNumber(totalXenogasNeeded)} xenogas (${formatNumber(fuelCost)} carburant${cargoXenogas > 0 ? ' + ' + formatNumber(cargoXenogas) + ' cargo' : ''}). Disponible: ${formatNumber(availableXenogas)}.`);
      return;
    }

    if (missionType === 'recycle') {
      const mantaCount = fleetForCalc.mantaRecup ?? 0;
      if (mantaCount <= 0) {
        showGameAlert('Pas de Manta Recup', 'Sélectionnez au moins un Manta Recup pour une mission de recyclage.');
        return;
      }
    }

    if (missionType === 'colonize') {
      const colonyCount = fleetForCalc.colonyShip ?? 0;
      if (colonyCount <= 0) {
        showGameAlert('Pas de Barge Coloniale', 'Vous devez posséder au moins une Barge Coloniale pour lancer une mission de colonisation.');
        return;
      }
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const missionLabels: Record<MissionType, string> = {
      attack: "d'attaque",
      transport: 'de transport',
      station: 'de stationnement',
      recycle: 'de recyclage',
      espionage: "d'espionnage",
      colonize: 'de colonisation',
    };

    const savedTravelTime = travelTime;
    const savedMissionType = missionType;

    try {
      const shipsToSend: Record<string, number> = {};
      for (const [id, count] of Object.entries(fleetForCalc)) {
        if (count > 0) shipsToSend[id] = count;
      }

      await sendFleet({
        targetCoords,
        targetPlayerId: params.targetPlayerId || null,
        targetUsername: params.targetUsername || null,
        targetPlanet: params.targetPlanet || null,
        missionType,
        ships: shipsToSend,
        resources: (missionType === 'transport' || missionType === 'station') ? transportResources : undefined,
      });

      setTimeout(() => {
        router.back();
        setTimeout(() => {
          showGameAlert(
            'Flotte envoyée !',
            `Mission ${missionLabels[savedMissionType]} lancée.\nArrivée dans ${formatTime(savedTravelTime)}.`,
            undefined,
            'success',
          );
        }, 300);
      }, 100);
    } catch (e: unknown) {
      let msg = 'Erreur inconnue';
      if (e instanceof Error) {
        msg = e.message;
      } else if (e && typeof e === 'object' && 'message' in e) {
        msg = String((e as { message: string }).message);
      }
      console.log('[SendFleet] Error sending fleet:', msg, e);
      showGameAlert('Erreur', msg);
    }
  }, [hasShips, fleetForCalc, targetCoords, params, missionType, transportResources, sendFleet, travelTime, router, serverFlightData, isLoadingFlight, insufficientFuel, totalXenogasNeeded, fuelCost, cargoXenogas, availableXenogas]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Envoyer la Flotte</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.targetCard}>
              <Text style={styles.targetLabel}>Cible</Text>
              <Text style={styles.targetCoords}>[{targetCoords[0]}:{targetCoords[1]}:{targetCoords[2]}]</Text>
              {params.targetUsername ? (
                <Text style={styles.targetPlayer}>{params.targetUsername} - {params.targetPlanet}</Text>
              ) : (
                <Text style={styles.targetPlayer}>Position vide</Text>
              )}
              <Text style={styles.distanceText}>Distance: {distance > 0 ? formatNumber(distance) : '--'}</Text>
            </View>

            <Text style={styles.sectionTitle}>Type de mission</Text>
            <View style={styles.missionRow}>
              {MISSION_TYPES.map(mt => {
                const Icon = mt.icon;
                const active = missionType === mt.id;
                return (
                  <TouchableOpacity
                    key={mt.id}
                    style={[styles.missionBtn, active && { borderColor: mt.color, backgroundColor: mt.color + '15' }]}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMissionType(mt.id);
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon size={18} color={active ? mt.color : Colors.textMuted} />
                    <Text style={[styles.missionLabel, active && { color: mt.color }]}>{mt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>
              {isEspionage ? 'Sondes à envoyer' : isColonize ? 'Barge coloniale' : 'Sélection des vaisseaux'}
            </Text>

            {isEspionage ? (
              <View style={styles.shipRow}>
                <View style={styles.shipInfo}>
                  <ScanEye size={16} color={Colors.silice} />
                  <Text style={styles.shipName}>Spectre Sonde</Text>
                  <Text style={styles.shipAvailable}>({state.ships.spectreSonde ?? 0})</Text>
                </View>
                <View style={styles.shipControls}>
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => updateShipCount('spectreSonde', -1)}
                  >
                    <Minus size={14} color={Colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.shipCount}>{selectedShips.spectreSonde ?? 0}</Text>
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => updateShipCount('spectreSonde', 1)}
                  >
                    <Plus size={14} color={Colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.maxBtn}
                    onPress={() => setAllShips('spectreSonde')}
                  >
                    <Text style={styles.maxText}>MAX</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : isColonize ? (
              <View style={styles.shipRow}>
                <View style={styles.shipInfo}>
                  <Globe size={16} color={Colors.xenogas} />
                  <Text style={styles.shipName}>Barge Coloniale</Text>
                  <Text style={styles.shipAvailable}>({state.ships.colonyShip ?? 0})</Text>
                </View>
                <View style={styles.shipControls}>
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => updateShipCount('colonyShip', -1)}
                  >
                    <Minus size={14} color={Colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.shipCount}>{selectedShips.colonyShip ?? 0}</Text>
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => updateShipCount('colonyShip', 1)}
                  >
                    <Plus size={14} color={Colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.maxBtn}
                    onPress={() => setAllShips('colonyShip')}
                  >
                    <Text style={styles.maxText}>MAX</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              availableShips.map(ship => {
                const count = selectedShips[ship.id] ?? 0;
                const max = state.ships[ship.id] ?? 0;
                return (
                  <View key={ship.id} style={styles.shipRow}>
                    <View style={styles.shipInfo}>
                      <Rocket size={14} color={Colors.primary} />
                      <Text style={styles.shipName}>{ship.name}</Text>
                      <Text style={styles.shipAvailable}>({max})</Text>
                    </View>
                    <View style={styles.shipControls}>
                      <TouchableOpacity
                        style={styles.ctrlBtn}
                        onPress={() => updateShipCount(ship.id, -1)}
                      >
                        <Minus size={14} color={Colors.text} />
                      </TouchableOpacity>
                      <Text style={styles.shipCount}>{count}</Text>
                      <TouchableOpacity
                        style={styles.ctrlBtn}
                        onPress={() => updateShipCount(ship.id, 1)}
                      >
                        <Plus size={14} color={Colors.text} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.maxBtn}
                        onPress={() => setAllShips(ship.id)}
                      >
                        <Text style={styles.maxText}>MAX</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}

            {(missionType === 'transport' || missionType === 'station') && (
              <>
                <Text style={styles.sectionTitle}>Ressources à transporter</Text>
                <View style={styles.cargoInfo}>
                  <Package size={14} color={Colors.primary} />
                  <Text style={styles.cargoText}>
                    Capacité: {formatNumber(totalTransport)} / {formatNumber(cargoCapacity)}
                  </Text>
                </View>
                {(['fer', 'silice', 'xenogas'] as const).map(res => {
                  const otherResources = (['fer', 'silice', 'xenogas'] as const).filter(r => r !== res);
                  const otherTotal = otherResources.reduce((sum, r) => sum + transportResources[r], 0);
                  const maxForThisRes = Math.min(Math.floor(state.resources[res]), cargoCapacity - otherTotal);
                  return (
                    <View key={res} style={styles.resourceRow}>
                      <Text style={styles.resLabel}>{res.charAt(0).toUpperCase() + res.slice(1)}</Text>
                      <TextInput
                        style={styles.resInput}
                        value={String(transportResources[res])}
                        onChangeText={(text) => {
                          const num = parseInt(text, 10) || 0;
                          const clamped = Math.max(0, Math.min(num, maxForThisRes));
                          setTransportResources(prev => ({
                            ...prev,
                            [res]: clamped,
                          }));
                        }}
                        keyboardType="number-pad"
                        selectTextOnFocus
                      />
                      <TouchableOpacity
                        style={styles.resMaxBtn}
                        onPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setTransportResources(prev => ({
                            ...prev,
                            [res]: Math.max(0, maxForThisRes),
                          }));
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.resMaxText}>MAX</Text>
                      </TouchableOpacity>
                      <Text style={styles.resAvailable}>/ {formatNumber(Math.floor(state.resources[res]))}</Text>
                    </View>
                  );
                })}
              </>
            )}

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Clock size={14} color={Colors.primary} />
                <Text style={styles.summaryLabel}>Temps de trajet</Text>
                <Text style={styles.summaryValue}>
                  {isLoadingFlight ? <ActivityIndicator size="small" color={Colors.primary} /> : hasShips && travelTime > 0 ? formatTime(travelTime) : '--'}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <ArrowRight size={14} color={Colors.accent} />
                <Text style={styles.summaryLabel}>Retour estimé</Text>
                <Text style={styles.summaryValue}>
                  {isLoadingFlight ? <ActivityIndicator size="small" color={Colors.primary} /> : hasShips && travelTime > 0 ? formatTime(travelTime * 2) : '--'}
                </Text>
              </View>
              {missionType !== 'espionage' && missionType !== 'colonize' && (
                <View style={styles.summaryRow}>
                  <Package size={14} color={Colors.success} />
                  <Text style={styles.summaryLabel}>Capacité fret</Text>
                  <Text style={styles.summaryValue}>{formatNumber(cargoCapacity)}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Fuel size={14} color={Colors.xenogas} />
                <Text style={styles.summaryLabel}>Carburant (Xenogas)</Text>
                <Text style={[styles.summaryValue, insufficientFuel && styles.insufficientText]}>
                  {isLoadingFlight ? <ActivityIndicator size="small" color={Colors.xenogas} /> : hasShips && fuelCost > 0 ? formatNumber(fuelCost) : '--'}
                </Text>
              </View>
              {insufficientFuel && (
                <View style={styles.fuelWarning}>
                  <Text style={styles.fuelWarningText}>
                    Xenogas insuffisant ! Requis: {formatNumber(totalXenogasNeeded)} — Disponible: {formatNumber(availableXenogas)}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.sendBtn, (!hasShips || isSending || insufficientFuel) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!hasShips || isSending || insufficientFuel}
              activeOpacity={0.7}
            >
              <Rocket size={18} color={hasShips && !isSending && !insufficientFuel ? '#0A0A14' : Colors.textMuted} />
              <Text style={[styles.sendText, (!hasShips || isSending || insufficientFuel) && styles.sendTextDisabled]}>
                {isSending ? 'Envoi en cours...' : insufficientFuel ? 'Xenogas insuffisant' : 'Lancer la mission'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  targetCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  targetLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  targetCoords: {
    color: Colors.primary,
    fontSize: 20,
    fontWeight: '700' as const,
    marginTop: 4,
    letterSpacing: 2,
  },
  targetPlayer: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  distanceText: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
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
  missionRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 16,
  },
  missionBtn: {
    flex: 1,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  missionLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  shipRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shipInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  shipName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500' as const,
  },
  shipAvailable: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  shipControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  ctrlBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  shipCount: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    minWidth: 30,
    textAlign: 'center' as const,
  },
  maxBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  maxText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  cargoInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 10,
  },
  cargoText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  resourceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 8,
  },
  resLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500' as const,
    width: 70,
  },
  resInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'center' as const,
  },
  resMaxBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  resMaxText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  resAvailable: {
    color: Colors.textMuted,
    fontSize: 11,
    width: 80,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 16,
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  sendBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.border,
  },
  sendText: {
    color: '#0A0A14',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  sendTextDisabled: {
    color: Colors.textMuted,
  },
  insufficientText: {
    color: Colors.danger,
  },
  fuelWarning: {
    backgroundColor: Colors.danger + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  fuelWarningText: {
    color: Colors.danger,
    fontSize: 11,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
});
