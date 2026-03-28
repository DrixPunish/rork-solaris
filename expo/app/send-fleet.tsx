import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Rocket, Crosshair, Truck, ScanEye, Minus, Plus, ArrowRight, Clock, Package, Recycle, Globe, Warehouse, Fuel, Gauge, AlertTriangle, Cpu, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGame } from '@/contexts/GameContext';
import { useFleet } from '@/contexts/FleetContext';
import { SHIPS } from '@/constants/gameData';
import { MissionType, AttackBlockReason } from '@/types/fleet';
import { getFleetCargoCapacity } from '@/utils/fleetCalculations';
import { trpcClient } from '@/lib/trpc';
import { trpc } from '@/lib/trpc';
import { formatTime, formatNumber } from '@/utils/gameCalculations';
import Colors from '@/constants/colors';
import { showGameAlert } from '@/components/GameAlert';

const ALL_MISSION_TYPES: { id: MissionType; label: string; icon: React.ComponentType<{ size: number; color: string }>; color: string; description: string }[] = [
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
  const { state, userId, activePlanet } = useGame();
  const { sendFleet, isSending } = useFleet();

  const targetCoords = useMemo<[number, number, number]>(() => [
    parseInt(params.targetGalaxy ?? '1', 10),
    parseInt(params.targetSystem ?? '1', 10),
    parseInt(params.targetPosition ?? '1', 10),
  ], [params.targetGalaxy, params.targetSystem, params.targetPosition]);

  const myPlanetsCoords = useMemo(() => {
    const coords: [number, number, number][] = [state.coordinates];
    for (const colony of (state.colonies ?? [])) {
      coords.push(colony.coordinates);
    }
    return coords;
  }, [state.coordinates, state.colonies]);

  const isOwnPlanet = useMemo(() => {
    return myPlanetsCoords.some(c =>
      c[0] === targetCoords[0] && c[1] === targetCoords[1] && c[2] === targetCoords[2]
    );
  }, [myPlanetsCoords, targetCoords]);

  const isEmptyPosition = !params.targetPlayerId && !params.targetUsername;

  const attackStatusQuery = trpc.world.getPlayerAttackStatus.useQuery(
    { attackerId: userId ?? '', defenderId: params.targetPlayerId ?? '' },
    {
      enabled: !!userId && !!params.targetPlayerId && !isOwnPlanet && !isEmptyPosition,
      staleTime: 30000,
    },
  );

  const canAttack = attackStatusQuery.data?.can_attack ?? false;
  const attackBlockReason = (attackStatusQuery.data?.reason ?? null) as AttackBlockReason | null;
  const attackerPts = attackStatusQuery.data?.attacker_pts ?? 0;
  const defenderPts = attackStatusQuery.data?.defender_pts ?? 0;
  const shieldExpiresAt = (attackStatusQuery.data as any)?.shield_expires_at as string | null | undefined;

  const shieldRemainingStr = useMemo(() => {
    if (!shieldExpiresAt) return '';
    const remaining = Math.max(0, Math.floor((new Date(shieldExpiresAt).getTime() - Date.now()) / 1000));
    if (remaining <= 0) return '';
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    return `${h}h${m.toString().padStart(2, '0')}`;
  }, [shieldExpiresAt]);

  const getAttackBlockMessage = useCallback((reason: AttackBlockReason | null): string => {
    switch (reason) {
      case 'quantum_shield_defender':
        return `\u{1F6E1}\uFE0F Bouclier quantique actif sur la cible${shieldRemainingStr ? ` (${shieldRemainingStr} restant)` : ''}`;
      case 'noob_shield_attacker':
        return `\u{1F6E1}\uFE0F Noob shield (100+ pts requis, actuel: ${Math.floor(attackerPts)})`;
      case 'noob_shield_defender':
        return `\u{1F6E1}\uFE0F D\u00e9fenseur prot\u00e9g\u00e9 (${Math.floor(defenderPts)} pts < 100)`;
      case 'point_gap':
        return `\u2696\uFE0F \u00c9cart: ${Math.floor(defenderPts)}/${Math.floor(attackerPts)} pts (${Math.round(defenderPts / Math.max(attackerPts, 1) * 100)}%)`;
      default:
        return '';
    }
  }, [attackerPts, defenderPts, shieldRemainingStr]);

  const availableMissionTypes = useMemo(() => {
    if (isOwnPlanet) {
      return ALL_MISSION_TYPES.filter(mt => ['transport', 'station', 'recycle'].includes(mt.id));
    }
    if (isEmptyPosition) {
      return ALL_MISSION_TYPES.filter(mt => ['colonize', 'recycle'].includes(mt.id));
    }
    const base = ['transport', 'espionage', 'recycle'];
    if (canAttack || attackStatusQuery.isLoading) {
      base.unshift('attack');
    }
    return ALL_MISSION_TYPES.filter(mt => base.includes(mt.id));
  }, [isOwnPlanet, isEmptyPosition, canAttack, attackStatusQuery.isLoading]);

  const getDefaultMission = useCallback((): MissionType => {
    const requested = params.defaultMission as MissionType | undefined;
    if (requested && availableMissionTypes.some(mt => mt.id === requested)) {
      return requested;
    }
    return availableMissionTypes[0]?.id ?? 'attack';
  }, [params.defaultMission, availableMissionTypes]);

  const [missionType, setMissionType] = useState<MissionType>(getDefaultMission());
  const [speedPercent, setSpeedPercent] = useState<number>(100);
  const [selectedShips, setSelectedShips] = useState<Record<string, number>>({});
  const cooldownRef = useRef(false);
  const [transportResources, setTransportResources] = useState({ fer: 0, silice: 0, xenogas: 0 });


  useEffect(() => {
    if (!availableMissionTypes.some(mt => mt.id === missionType)) {
      setMissionType(availableMissionTypes[0]?.id ?? 'attack');
    }
  }, [availableMissionTypes, missionType]);

  const planetShips = activePlanet.ships;
  const planetCoords = activePlanet.coordinates;
  const planetResources = activePlanet.resources;
  const planetName = activePlanet.planetName;
  const activePlanetId = activePlanet.id;

  const [serverResources, setServerResources] = useState<{ fer: number; silice: number; xenogas: number } | null>(null);
  const [maxLoading, setMaxLoading] = useState<'fer' | 'silice' | 'xenogas' | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchServerResources = useCallback(async (): Promise<{ fer: number; silice: number; xenogas: number } | null> => {
    if (!userId || !activePlanetId) {
      console.log('[SendFleet] fetchServerResources: missing userId or activePlanetId', { userId, activePlanetId });
      return null;
    }
    try {
      console.log('[SendFleet] Fetching server resources via tRPC for planet:', activePlanetId);
      const result = await trpcClient.world.getPlanetResources.query({ planetId: activePlanetId, userId });
      if (result.success) {
        const res = { fer: result.fer as number, silice: result.silice as number, xenogas: result.xenogas as number };
        setServerResources(res);
        console.log('[SendFleet] Server resources FRESH fetched:', res);
        return res;
      }
      console.log('[SendFleet] Server resources fetch failed:', result.error);
      return null;
    } catch (err) {
      console.log('[SendFleet] Server resources fetch error:', err);
      return null;
    }
  }, [userId, activePlanetId]);

  const availableShips = useMemo(() => {
    return SHIPS.filter(s => (planetShips[s.id] ?? 0) > 0);
  }, [planetShips]);

  const isEspionage = missionType === 'espionage';
  const isColonize = missionType === 'colonize';
  const showResourceInputs = missionType === 'transport' || missionType === 'station';

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

  const fleetStatusQuery = trpc.world.getFleetStatus.useQuery(
    { userId: userId ?? '' },
    { enabled: !!userId, staleTime: 10000 },
  );
  const activeFleetCount = fleetStatusQuery.data?.activeFleets ?? 0;
  const fleetLimit = fleetStatusQuery.data?.fleetLimit ?? 1;
  const fleetLimitReached = activeFleetCount >= fleetLimit;

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

    console.log('[SendFleet] Calculating flight from', planetCoords, 'planet:', planetName, 'speed:', speedPercent, '%');

    trpcClient.world.calculateFlightTime.query({
      userId,
      senderCoords: planetCoords as number[],
      targetCoords: targetCoords as number[],
      ships: shipsToSend,
      speedPercent,
    }).then(result => {
      if (cancelled) return;
      if (result.success) {
        setServerFlightData({
          distance: result.distance,
          flight_time_sec: result.flight_time_sec,
          slowest_speed: result.slowest_speed,
          fuel_cost: result.fuel_cost,
        });
        console.log('[SendFleet] Server flight time:', result.flight_time_sec, 's, distance:', result.distance, ', fuel:', result.fuel_cost, 'speed:', speedPercent, '%');
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
  }, [hasShips, fleetForCalc, planetCoords, targetCoords, userId, planetName, speedPercent]);

  const travelTime = serverFlightData?.flight_time_sec ?? 0;
  const distance = serverFlightData?.distance ?? 0;
  const fuelCost = serverFlightData?.fuel_cost ?? 0;
  const effectiveResources = useMemo(() => {
    if (serverResources) {
      return {
        fer: Math.floor(serverResources.fer),
        silice: Math.floor(serverResources.silice),
        xenogas: Math.floor(serverResources.xenogas),
      };
    }
    return {
      fer: Math.floor(planetResources.fer),
      silice: Math.floor(planetResources.silice),
      xenogas: Math.floor(planetResources.xenogas),
    };
  }, [serverResources, planetResources]);

  const availableXenogas = effectiveResources.xenogas;
  const cargoXenogas = showResourceInputs ? transportResources.xenogas : 0;
  const totalXenogasNeeded = fuelCost + cargoXenogas;
  const insufficientFuel = hasShips && fuelCost > 0 && availableXenogas < totalXenogasNeeded;

  const cargoCapacity = useMemo(() => {
    return getFleetCargoCapacity(fleetForCalc, state.research);
  }, [fleetForCalc, state.research]);

  const totalTransport = showResourceInputs
    ? transportResources.fer + transportResources.silice + transportResources.xenogas
    : 0;

  const updateShipCount = useCallback((shipId: string, delta: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedShips(prev => {
      const max = planetShips[shipId] ?? 0;
      const current = prev[shipId] ?? 0;
      const next = Math.max(0, Math.min(max, current + delta));
      return { ...prev, [shipId]: next };
    });
  }, [planetShips]);

  const setAllShips = useCallback((shipId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedShips(prev => ({
      ...prev,
      [shipId]: planetShips[shipId] ?? 0,
    }));
  }, [planetShips]);

  const arrivalTime = useMemo(() => {
    if (!hasShips || travelTime <= 0) return null;
    return new Date(Date.now() + travelTime * 1000);
  }, [hasShips, travelTime]);

  const startCooldown = useCallback((seconds: number) => {
    setSendCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setSendCooldown(prev => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (!hasShips || isConfirming || sendCooldown > 0) return;

    if (cooldownRef.current) {
      console.log('[SendFleet] Cooldown active, ignoring send');
      return;
    }

    if (fleetLimitReached) {
      showGameAlert('Limite de flottes', `Vous avez atteint la limite de ${fleetLimit} flotte${fleetLimit > 1 ? 's' : ''} simultanée${fleetLimit > 1 ? 's' : ''}. Recherchez IA Stratégique pour augmenter cette limite.`);
      return;
    }

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

    const shipsToSend: Record<string, number> = {};
    for (const [id, count] of Object.entries(fleetForCalc)) {
      if (count > 0) shipsToSend[id] = count;
    }

    let resources: { fer: number; silice: number; xenogas: number } | undefined;
    if (showResourceInputs) {
      resources = transportResources;
    }

    setIsConfirming(true);
    cooldownRef.current = true;

    const timeoutId = setTimeout(() => {
      console.log('[SendFleet] Server timeout after 15s');
      setIsConfirming(false);
      cooldownRef.current = false;
      startCooldown(3);
      showGameAlert('Timeout', 'Le serveur met trop de temps à répondre. Vérifiez vos flottes actives avant de réessayer.');
    }, 15000);

    try {
      await sendFleet({
        targetCoords,
        targetPlayerId: params.targetPlayerId || null,
        targetUsername: params.targetUsername || null,
        targetPlanet: params.targetPlanet || null,
        missionType,
        ships: shipsToSend,
        resources,
        speedPercent,
      });

      clearTimeout(timeoutId);
      setIsConfirming(false);
      cooldownRef.current = false;

      console.log('[SendFleet] Fleet sent successfully');

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
      clearTimeout(timeoutId);
      setIsConfirming(false);
      cooldownRef.current = false;
      startCooldown(3);

      let msg = 'Erreur inconnue';
      if (e instanceof Error) {
        msg = e.message;
      } else if (e && typeof e === 'object' && 'message' in e) {
        msg = String((e as { message: string }).message);
      }
      console.log('[SendFleet] Error sending fleet:', msg, e);
      showGameAlert('Erreur d\'envoi', `${msg}\n\nVos vaisseaux n'ont pas été retirés. Vous pouvez réessayer.`);
    }
  }, [hasShips, isConfirming, sendCooldown, fleetForCalc, targetCoords, params, missionType, transportResources, sendFleet, travelTime, router, serverFlightData, isLoadingFlight, insufficientFuel, totalXenogasNeeded, fuelCost, cargoXenogas, availableXenogas, showResourceInputs, speedPercent, fleetLimitReached, fleetLimit, startCooldown]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>Envoyer la Flotte</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.sourceCard}>
              <Text style={styles.sourceLabel}>Depuis</Text>
              <Text style={styles.sourceName}>{planetName}</Text>
              <Text style={styles.sourceCoords}>[{planetCoords[0]}:{planetCoords[1]}:{planetCoords[2]}]</Text>
            </View>

            <View style={styles.targetCard}>
              <Text style={styles.targetLabel}>Cible</Text>
              <Text style={styles.targetCoords}>[{targetCoords[0]}:{targetCoords[1]}:{targetCoords[2]}]</Text>
              {isOwnPlanet ? (
                <View style={styles.ownPlanetBadge}>
                  <Text style={styles.ownPlanetText}>Votre planète</Text>
                </View>
              ) : params.targetUsername ? (
                <Text style={styles.targetPlayer}>{params.targetUsername} - {params.targetPlanet}</Text>
              ) : (
                <Text style={styles.targetPlayer}>Position vide</Text>
              )}
              <Text style={styles.distanceText}>Distance: {distance > 0 ? formatNumber(distance) : '--'}</Text>
            </View>

            <View style={styles.fleetStatusBar}>
              <View style={styles.fleetStatusLeft}>
                <Navigation size={14} color={fleetLimitReached ? Colors.danger : Colors.accent} />
                <Text style={[styles.fleetStatusText, fleetLimitReached && styles.fleetStatusDanger]}>
                  Flottes: {activeFleetCount}/{fleetLimit}
                </Text>
              </View>
              {fleetLimitReached && (
                <View style={styles.fleetLimitBadge}>
                  <AlertTriangle size={12} color={Colors.danger} />
                  <Text style={styles.fleetLimitText}>Limite atteinte</Text>
                </View>
              )}
              <View style={styles.fleetStatusRight}>
                <Cpu size={12} color={Colors.textMuted} />
                <Text style={styles.fleetTechText}>IA Nv.{fleetStatusQuery.data?.computerTechLevel ?? 0}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Type de mission</Text>
            <View style={styles.missionRow}>
              {availableMissionTypes.map(mt => {
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

            {!isOwnPlanet && !isEmptyPosition && !canAttack && !attackStatusQuery.isLoading && attackBlockReason && (
              <View style={styles.protectionBanner}>
                <Text style={styles.protectionText}>
                  {getAttackBlockMessage(attackBlockReason)}
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>
              {isEspionage ? 'Sondes à envoyer' : isColonize ? 'Barge coloniale' : 'Sélection des vaisseaux'}
            </Text>

            {isEspionage ? (
              <View style={styles.shipRow}>
                <View style={styles.shipInfo}>
                  <ScanEye size={16} color={Colors.silice} />
                  <Text style={styles.shipName}>Spectre Sonde</Text>
                  <Text style={styles.shipAvailable}>({planetShips.spectreSonde ?? 0})</Text>
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
                  <Text style={styles.shipAvailable}>({planetShips.colonyShip ?? 0})</Text>
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
                const max = planetShips[ship.id] ?? 0;
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

            {showResourceInputs && (
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
                  const maxForThisRes = Math.min(effectiveResources[res], cargoCapacity - otherTotal);
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
                        style={[styles.resMaxBtn, maxLoading === res && styles.resMaxBtnLoading]}
                        onPress={async () => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setMaxLoading(res);
                          const freshRes = await fetchServerResources();
                          if (!freshRes) {
                            console.log('[SendFleet] MAX: server fetch failed, aborting');
                            setMaxLoading(null);
                            return;
                          }
                          const serverVal = Math.floor(freshRes[res]);
                          const otherTot = (['fer', 'silice', 'xenogas'] as const).filter(r => r !== res).reduce((sum, r) => sum + transportResources[r], 0);
                          const maxSafe = Math.max(0, Math.min(serverVal, cargoCapacity - otherTot));
                          console.log('[SendFleet] MAX', res, ': server=', serverVal, 'otherCargo=', otherTot, 'maxSafe=', maxSafe);
                          setTransportResources(prev => ({ ...prev, [res]: maxSafe }));
                          setMaxLoading(null);
                        }}
                        activeOpacity={0.7}
                        disabled={maxLoading === res}
                      >
                        {maxLoading === res ? (
                          <ActivityIndicator size="small" color={Colors.primary} />
                        ) : (
                          <Text style={styles.resMaxText}>MAX</Text>
                        )}
                      </TouchableOpacity>
                      <Text style={styles.resAvailable}>/ {formatNumber(effectiveResources[res])}</Text>
                    </View>
                  );
                })}
              </>
            )}



            <Text style={styles.sectionTitle}>Vitesse de la flotte</Text>
            <View style={styles.speedRow}>
              {[10, 20, 30, 40, 50].map(pct => {
                const isActive = speedPercent === pct;
                return (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.speedBtn, isActive && styles.speedBtnActive]}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSpeedPercent(pct);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.speedBtnText, isActive && styles.speedBtnTextActive]}>{pct}%</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.speedRow}>
              {[60, 70, 80, 90, 100].map(pct => {
                const isActive = speedPercent === pct;
                return (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.speedBtn, isActive && styles.speedBtnActive]}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSpeedPercent(pct);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.speedBtnText, isActive && styles.speedBtnTextActive]}>{pct}%</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Gauge size={14} color={Colors.energy} />
                <Text style={styles.summaryLabel}>Vitesse</Text>
                <Text style={[styles.summaryValue, speedPercent < 100 && { color: Colors.warning }]}>{speedPercent}%</Text>
              </View>
              <View style={styles.summaryRow}>
                <Clock size={14} color={Colors.primary} />
                <Text style={styles.summaryLabel}>Temps de trajet</Text>
                <Text style={styles.summaryValue}>
                  {isLoadingFlight ? <ActivityIndicator size="small" color={Colors.primary} /> : hasShips && travelTime > 0 ? formatTime(travelTime) : '--'}
                </Text>
              </View>
              {hasShips && travelTime > 0 && arrivalTime && !isLoadingFlight && (
                <View style={styles.summaryRow}>
                  <ArrowRight size={14} color={Colors.success} />
                  <Text style={styles.summaryLabel}>Arrivée</Text>
                  <Text style={styles.arrivalValue}>
                    {arrivalTime.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {arrivalTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              )}
              {missionType !== 'station' && (
                <View style={styles.summaryRow}>
                  <ArrowRight size={14} color={Colors.accent} />
                  <Text style={styles.summaryLabel}>Retour estimé</Text>
                  <Text style={styles.summaryValue}>
                    {isLoadingFlight ? <ActivityIndicator size="small" color={Colors.primary} /> : hasShips && travelTime > 0 ? formatTime(travelTime * 2) : '--'}
                  </Text>
                </View>
              )}
              {missionType === 'station' && (
                <View style={styles.stationNote}>
                  <Text style={styles.stationNoteText}>Les vaisseaux resteront sur la planète cible (pas de retour)</Text>
                </View>
              )}
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
              style={[styles.sendBtn, (!hasShips || isSending || isConfirming || insufficientFuel || fleetLimitReached || sendCooldown > 0) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!hasShips || isSending || isConfirming || insufficientFuel || fleetLimitReached || sendCooldown > 0}
              activeOpacity={0.7}
            >
              {(isSending || isConfirming) ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Rocket size={18} color={hasShips && !insufficientFuel && !fleetLimitReached && sendCooldown <= 0 ? '#0A0A14' : Colors.textMuted} />
              )}
              <Text style={[styles.sendText, (!hasShips || isSending || isConfirming || insufficientFuel || fleetLimitReached || sendCooldown > 0) && styles.sendTextDisabled]}>
                {(isSending || isConfirming) ? 'Envoi en cours...'
                  : sendCooldown > 0 ? `Patientez ${sendCooldown}s`
                  : fleetLimitReached ? `Limite flottes (${activeFleetCount}/${fleetLimit})`
                  : insufficientFuel ? 'Xenogas insuffisant'
                  : 'Lancer la mission'}
              </Text>
            </TouchableOpacity>

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
    paddingTop: 12,
    paddingBottom: 24,
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
    flexWrap: 'wrap' as const,
    justifyContent: 'space-around' as const,
  },
  missionBtn: {
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
    minWidth: 72,
    flex: 1,
    maxWidth: 100,
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
    minHeight: 48,
  },
  shipInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden' as const,
  },
  shipName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500' as const,
    flexShrink: 1,
  },
  shipAvailable: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  shipControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    flexShrink: 0,
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
  resMaxBtnLoading: {
    opacity: 0.6,
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
    marginTop: 10,
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
  sourceCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    marginBottom: 10,
    alignItems: 'center' as const,
  },
  sourceLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  sourceName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginTop: 4,
  },
  sourceCoords: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
    marginTop: 2,
    letterSpacing: 1,
  },
  ownPlanetBadge: {
    backgroundColor: Colors.success + '20',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
    borderWidth: 1,
    borderColor: Colors.success + '40',
  },
  ownPlanetText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  stationNote: {
    backgroundColor: Colors.primary + '10',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  stationNoteText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
  },
  protectionBanner: {
    backgroundColor: Colors.warning + '15',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
    marginBottom: 12,
  },
  protectionText: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  fleetStatusBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fleetStatusLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  fleetStatusText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  fleetStatusDanger: {
    color: Colors.danger,
  },
  fleetLimitBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.danger + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  fleetLimitText: {
    color: Colors.danger,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  fleetStatusRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  fleetTechText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500' as const,
  },
  speedRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 6,
  },
  speedBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  speedBtnActive: {
    borderColor: Colors.energy,
    backgroundColor: Colors.energy + '15',
  },
  speedBtnText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  speedBtnTextActive: {
    color: Colors.energy,
  },
  arrivalValue: {
    color: Colors.success,
    fontSize: 13,
    fontWeight: '700' as const,
  },
});
