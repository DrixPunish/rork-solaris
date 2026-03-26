import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Modal, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Globe, User, CircleDot, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Mail, ScanEye, Crosshair, Truck, Sparkles, Recycle, X, Flag, MapPin, Warehouse, Navigation } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useGame } from '@/contexts/GameContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/utils/supabase';
import ResourceBar from '@/components/ResourceBar';
import StarField from '@/components/StarField';
import Colors from '@/constants/colors';
import { showGameAlert } from '@/components/GameAlert';
import { formatNumber } from '@/utils/gameCalculations';
import { AttackBlockReason } from '@/types/fleet';

interface GalaxyPlayer {
  user_id: string;
  email: string;
  username: string;
  planet_name: string;
  coordinates: [number, number, number];
  is_colony?: boolean;
}

interface DebrisField {
  id: string;
  coords: [number, number, number];
  fer: number;
  silice: number;
}

const MAX_GALAXIES = 1;
const MAX_SYSTEMS = 100;

export default function GalaxyScreen() {
  const { state, activePlanetId } = useGame();
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ g?: string; ss?: string }>();

  const [viewGalaxy, setViewGalaxy] = useState(() => {
    const g = params.g ? parseInt(params.g, 10) : NaN;
    return !isNaN(g) && g >= 1 && g <= MAX_GALAXIES ? g : state.coordinates[0];
  });
  const [viewSystem, setViewSystem] = useState(() => {
    const ss = params.ss ? parseInt(params.ss, 10) : NaN;
    return !isNaN(ss) && ss >= 1 && ss <= MAX_SYSTEMS ? ss : state.coordinates[1];
  });
  const [debrisModal, setDebrisModal] = useState<{ pos: number; debris: DebrisField } | null>(null);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (params.g || params.ss) {
      const g = params.g ? parseInt(params.g, 10) : NaN;
      const ss = params.ss ? parseInt(params.ss, 10) : NaN;
      if (!isNaN(g) && g >= 1 && g <= MAX_GALAXIES) setViewGalaxy(g);
      if (!isNaN(ss) && ss >= 1 && ss <= MAX_SYSTEMS) setViewSystem(ss);
    }
  }, [params.g, params.ss]);

  const goHome = useCallback(() => {
    setViewGalaxy(state.coordinates[0]);
    setViewSystem(state.coordinates[1]);
  }, [state.coordinates]);

  const changeSystem = useCallback((delta: number) => {
    setViewSystem(prev => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > MAX_SYSTEMS) return MAX_SYSTEMS;
      return next;
    });
  }, []);

  const changeGalaxy = useCallback((delta: number) => {
    setViewGalaxy(prev => Math.max(1, Math.min(MAX_GALAXIES, prev + delta)));
    setViewSystem(1);
  }, []);

  const galaxyQuery = useQuery({
    queryKey: ['galaxy', viewGalaxy, viewSystem],
    queryFn: async () => {
      console.log('[Galaxy] Fetching planets for system', viewGalaxy, viewSystem);

      const { data: planetsData, error: planetsError } = await supabase
        .from('planets')
        .select('user_id, planet_name, coordinates, is_main')
        .filter('coordinates->>0', 'eq', String(viewGalaxy))
        .filter('coordinates->>1', 'eq', String(viewSystem));

      if (planetsError) {
        console.log('[Galaxy] Error fetching planets:', planetsError.message);
        throw planetsError;
      }

      const userIds = [...new Set((planetsData ?? []).map(p => p.user_id as string))];
      let playersMap = new Map<string, { username: string; email: string }>();

      if (userIds.length > 0) {
        const { data: playersData } = await supabase
          .from('players')
          .select('user_id, username, email')
          .in('user_id', userIds);

        for (const p of (playersData ?? [])) {
          playersMap.set(p.user_id as string, {
            username: (p.username as string) ?? '',
            email: (p.email as string) ?? '',
          });
        }
      }

      const results: GalaxyPlayer[] = (planetsData ?? []).map(planet => {
        const playerInfo = playersMap.get(planet.user_id as string);
        return {
          user_id: planet.user_id as string,
          email: playerInfo?.email ?? '',
          username: playerInfo?.username ?? '',
          planet_name: (planet.planet_name as string) ?? 'Inconnue',
          coordinates: planet.coordinates as [number, number, number],
          is_colony: !(planet.is_main as boolean),
        };
      });

      console.log('[Galaxy] Found', results.length, 'planets in system (from planets table)');
      return results;
    },
    refetchInterval: 30000,
  });

  const debrisQuery = useQuery({
    queryKey: ['debris_fields', viewGalaxy, viewSystem],
    queryFn: async () => {
      console.log('[Galaxy] Fetching debris fields for system', viewGalaxy, viewSystem);
      const { data, error } = await supabase
        .from('debris_fields')
        .select('id, coords, fer, silice')
        .eq('coords->>0', String(viewGalaxy))
        .eq('coords->>1', String(viewSystem));

      if (error) {
        console.log('[Galaxy] Error fetching debris:', error.message);
        return [];
      }
      return (data ?? []) as DebrisField[];
    },
    refetchInterval: 30000,
  });

  const debrisMap = useMemo(() => {
    const map = new Map<number, DebrisField>();
    for (const d of debrisQuery.data ?? []) {
      if (d.fer > 0 || d.silice > 0) {
        map.set(d.coords[2], d);
      }
    }
    return map;
  }, [debrisQuery.data]);

  const playerIds = useMemo(() => {
    const ids = (galaxyQuery.data ?? []).filter(p => p.user_id !== user?.id).map(p => p.user_id);
    return [...new Set(ids)];
  }, [galaxyQuery.data, user?.id]);

  const scoresQuery = useQuery({
    queryKey: ['player_scores_galaxy', user?.id, ...playerIds],
    queryFn: async () => {
      if (!user?.id || playerIds.length === 0) return { attackerPts: 0, defenderScores: new Map<string, number>(), shieldedPlayers: new Set<string>() };

      const { data: attackerData } = await supabase
        .from('player_scores')
        .select('total_points')
        .eq('player_id', user.id)
        .maybeSingle();
      const attackerPts = (attackerData?.total_points as number) ?? 0;

      const { data: defenderData } = await supabase
        .from('player_scores')
        .select('player_id, total_points')
        .in('player_id', playerIds);

      const defenderScores = new Map<string, number>();
      for (const d of (defenderData ?? []) as Array<{ player_id: string; total_points: number }>) {
        defenderScores.set(d.player_id, d.total_points ?? 0);
      }

      const shieldedPlayers = new Set<string>();
      const shieldExpiry = new Map<string, string>();
      const { data: shieldData } = await supabase
        .from('quantum_shields')
        .select('player_id, shield_active, shield_expires_at')
        .in('player_id', playerIds)
        .eq('shield_active', true);
      for (const s of (shieldData ?? []) as Array<{ player_id: string; shield_active: boolean; shield_expires_at: string | null }>) {
        if (s.shield_active && s.shield_expires_at && new Date(s.shield_expires_at) > new Date()) {
          shieldedPlayers.add(s.player_id);
          shieldExpiry.set(s.player_id, s.shield_expires_at);
        }
      }

      return { attackerPts, defenderScores, shieldedPlayers, shieldExpiry };
    },
    enabled: !!user?.id && playerIds.length > 0,
    staleTime: 30000,
  });

  const getAttackStatus = useCallback((defenderId: string): { canAttack: boolean; reason: AttackBlockReason | null } => {
    if (!scoresQuery.data) return { canAttack: true, reason: null };
    const { attackerPts, defenderScores, shieldedPlayers } = scoresQuery.data;
    const defenderPts = defenderScores.get(defenderId) ?? 0;

    if (shieldedPlayers.has(defenderId)) return { canAttack: false, reason: 'quantum_shield_defender' };
    if (attackerPts < 100) return { canAttack: false, reason: 'noob_shield_attacker' };
    if (defenderPts < 100) return { canAttack: false, reason: 'noob_shield_defender' };
    if (defenderPts <= attackerPts * 0.5) return { canAttack: false, reason: 'point_gap' };
    return { canAttack: true, reason: null };
  }, [scoresQuery.data]);

  const formatShieldRemaining = useCallback((expiresAt: string): string => {
    const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    if (remaining <= 0) return '';
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    return `${h}h${m.toString().padStart(2, '0')}`;
  }, []);

  const getAttackTooltip = useCallback((defenderId: string): string => {
    const { reason } = getAttackStatus(defenderId);
    if (!scoresQuery.data) return '';
    const { attackerPts, defenderScores, shieldExpiry } = scoresQuery.data;
    const defenderPts = defenderScores.get(defenderId) ?? 0;
    switch (reason) {
      case 'quantum_shield_defender': {
        const expiry = shieldExpiry?.get(defenderId);
        const remaining = expiry ? formatShieldRemaining(expiry) : '';
        return `Bouclier quantique actif${remaining ? ` (${remaining} restant)` : ''}`;
      }
      case 'noob_shield_attacker':
        return `Noob shield (${Math.floor(attackerPts)}/100 pts)`;
      case 'noob_shield_defender':
        return `Prot\u00e9g\u00e9 (${Math.floor(defenderPts)}/100 pts)`;
      case 'point_gap':
        return `\u00c9cart (${Math.floor(defenderPts)}/${Math.floor(attackerPts)} pts)`;
      default:
        return '';
    }
  }, [getAttackStatus, scoresQuery.data, formatShieldRemaining]);

  const myColoniesInSystem = useMemo(() => {
    const colonies = state.colonies ?? [];
    return colonies.filter(c =>
      c.coordinates[0] === viewGalaxy && c.coordinates[1] === viewSystem
    );
  }, [state.colonies, viewGalaxy, viewSystem]);

  const myColonyMap = useMemo(() => {
    const map = new Map<number, { planetName: string; colonyId: string }>();
    for (const c of myColoniesInSystem) {
      map.set(c.coordinates[2], { planetName: c.planetName, colonyId: c.id });
    }
    return map;
  }, [myColoniesInSystem]);

  const activeCoords = useMemo(() => {
    if (!activePlanetId) return state.coordinates;
    const colony = (state.colonies ?? []).find(c => c.id === activePlanetId);
    return colony ? colony.coordinates : state.coordinates;
  }, [activePlanetId, state.coordinates, state.colonies]);

  const positions = Array.from({ length: 15 }, (_, i) => {
    const pos = i + 1;
    const playerHere = galaxyQuery.data?.find(p => p.coordinates[2] === pos);
    const isYoursFromDB = playerHere?.user_id === user?.id;
    const isYourColonyFromDB = isYoursFromDB && playerHere?.is_colony;
    const isYours = isYoursFromDB && !isYourColonyFromDB;
    const myColony = myColonyMap.get(pos) ?? (isYourColonyFromDB ? { planetName: playerHere!.planet_name, colonyId: '' } : null);
    const isOtherPlayerColony = !!playerHere && !isYoursFromDB && playerHere.is_colony;
    const isOccupied = !!playerHere && !isYoursFromDB;
    const isEmpty = !playerHere && !myColony;
    const debris = debrisMap.get(pos) ?? null;
    const isActivePlanet = viewGalaxy === activeCoords[0] && viewSystem === activeCoords[1] && pos === activeCoords[2];
    const isOwnNotActive = (isYours || !!myColony) && !isActivePlanet;

    return { pos, playerHere, isYours, isOccupied, isEmpty, debris, myColony, isActivePlanet, isOwnNotActive, isOtherPlayerColony };
  });

  const isHome = viewGalaxy === state.coordinates[0] && viewSystem === state.coordinates[1];

  const handleSpy = useCallback((player: GalaxyPlayer, pos: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const probeCount = state.ships.spectreSonde ?? 0;
    if (probeCount <= 0) {
      showGameAlert('Pas de sondes', 'Construisez des Spectre Sondes dans le chantier spatial.');
      return;
    }
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: player.user_id,
        targetUsername: player.username || player.email.split('@')[0],
        targetPlanet: player.planet_name,
        defaultMission: 'espionage',
      },
    });
  }, [state.ships, viewGalaxy, viewSystem, router]);

  const handleAttack = useCallback((player: GalaxyPlayer, pos: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: player.user_id,
        targetUsername: player.username || player.email.split('@')[0],
        targetPlanet: player.planet_name,
        defaultMission: 'attack',
      },
    });
  }, [viewGalaxy, viewSystem, router]);

  const handleTransport = useCallback((player: GalaxyPlayer, pos: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: player.user_id,
        targetUsername: player.username || player.email.split('@')[0],
        targetPlanet: player.planet_name,
        defaultMission: 'transport',
      },
    });
  }, [viewGalaxy, viewSystem, router]);

  const openDebrisModal = useCallback((pos: number, debris: DebrisField) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDebrisModal({ pos, debris });
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const closeDebrisModal = useCallback(() => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setDebrisModal(null);
    });
  }, [fadeAnim]);

  const handleColonize = useCallback((pos: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: '',
        targetUsername: '',
        targetPlanet: 'Position vide',
        defaultMission: 'colonize',
      },
    });
  }, [viewGalaxy, viewSystem, router]);

  const handleStationOwn = useCallback((pos: number, planetName: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: user?.id ?? '',
        targetUsername: state.username ?? '',
        targetPlanet: planetName,
        defaultMission: 'station',
      },
    });
  }, [viewGalaxy, viewSystem, router, user?.id, state.username]);

  const handleTransportOwn = useCallback((pos: number, planetName: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/send-fleet',
      params: {
        targetGalaxy: String(viewGalaxy),
        targetSystem: String(viewSystem),
        targetPosition: String(pos),
        targetPlayerId: user?.id ?? '',
        targetUsername: state.username ?? '',
        targetPlanet: planetName,
        defaultMission: 'transport',
      },
    });
  }, [viewGalaxy, viewSystem, router, user?.id, state.username]);

  const handleRecycle = useCallback((pos: number) => {
    const mantaCount = state.ships.mantaRecup ?? 0;
    if (mantaCount <= 0) {
      closeDebrisModal();
      setTimeout(() => {
        showGameAlert('Pas de Manta Recup', 'Construisez des Manta Recup dans le chantier spatial pour récupérer les débris.');
      }, 200);
      return;
    }
    closeDebrisModal();
    setTimeout(() => {
      router.push({
        pathname: '/send-fleet',
        params: {
          targetGalaxy: String(viewGalaxy),
          targetSystem: String(viewSystem),
          targetPosition: String(pos),
          targetPlayerId: '',
          targetUsername: '',
          targetPlanet: 'Champ de débris',
          defaultMission: 'recycle',
        },
      });
    }, 200);
  }, [state.ships, viewGalaxy, viewSystem, router, closeDebrisModal]);

  return (
    <View style={styles.container}>
      <StarField starCount={120} height={2400} />
      <ResourceBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <StarField starCount={50} height={160} />
          <LinearGradient
            colors={['transparent', Colors.background]}
            style={styles.heroFade}
          />
          <View style={styles.heroContent}>
            <View style={styles.systemBadge}>
              <Navigation size={14} color={Colors.primary} />
              <Text style={styles.systemBadgeText}>Système solaire</Text>
            </View>
            <Text style={styles.systemCoordsHero}>
              [{viewGalaxy}:{viewSystem}]
            </Text>
          </View>
        </View>

        <View style={styles.navSection}>
          <View style={styles.navRow}>
            <Text style={styles.navLabel}>Galaxie</Text>
            <View style={styles.navControls}>
              <TouchableOpacity onPress={() => changeGalaxy(-1)} style={styles.navBtn} activeOpacity={0.6} disabled={viewGalaxy <= 1}>
                <ChevronsLeft size={16} color={viewGalaxy <= 1 ? Colors.textMuted : Colors.primary} />
              </TouchableOpacity>
              <View style={styles.navInputDisabled}>
                <Text style={styles.navInputText}>{viewGalaxy}</Text>
              </View>
              <TouchableOpacity onPress={() => changeGalaxy(1)} style={styles.navBtn} activeOpacity={0.6} disabled={viewGalaxy >= MAX_GALAXIES}>
                <ChevronsRight size={16} color={viewGalaxy >= MAX_GALAXIES ? Colors.textMuted : Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.navRow, { marginBottom: 0 }]}>
            <Text style={styles.navLabel}>Système</Text>
            <View style={styles.navControls}>
              <TouchableOpacity onPress={() => changeSystem(-10)} style={styles.navBtn} activeOpacity={0.6}>
                <ChevronsLeft size={16} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeSystem(-1)} style={styles.navBtn} activeOpacity={0.6}>
                <ChevronLeft size={16} color={Colors.primary} />
              </TouchableOpacity>
              <TextInput
                style={styles.navInput}
                value={String(viewSystem)}
                onChangeText={(text) => {
                  const num = parseInt(text, 10);
                  if (!text) setViewSystem(1);
                  else if (!isNaN(num)) setViewSystem(Math.max(1, Math.min(MAX_SYSTEMS, num)));
                }}
                keyboardType="number-pad"
                maxLength={3}
                selectTextOnFocus
                selectionColor={Colors.primary}
              />
              <TouchableOpacity onPress={() => changeSystem(1)} style={styles.navBtn} activeOpacity={0.6}>
                <ChevronRight size={16} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeSystem(10)} style={styles.navBtn} activeOpacity={0.6}>
                <ChevronsRight size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {!isHome && (
            <TouchableOpacity onPress={goHome} style={styles.homeBtn} activeOpacity={0.7}>
              <Globe size={14} color={Colors.primary} />
              <Text style={styles.homeBtnText}>Retour à ma planète</Text>
            </TouchableOpacity>
          )}
        </View>

        {galaxyQuery.isLoading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.loadingText}>Scan en cours...</Text>
          </View>
        )}

        <View style={styles.tableContainer}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.posCol]}>#</Text>
            <Text style={[styles.tableHeaderText, styles.planetCol]}>Planète</Text>
            <Text style={[styles.tableHeaderText, styles.playerCol]}>Joueur</Text>
            <Text style={[styles.tableHeaderText, styles.actionsCol]}>Actions</Text>
          </View>

        {positions.map(({ pos, playerHere, isYours, isOccupied, isEmpty, debris, myColony, isOwnNotActive, isOtherPlayerColony }) => (
          <View
            key={pos}
            style={[
              styles.row,
              isYours && styles.rowYours,
              myColony && !isYours && styles.rowColony,
              isEmpty && !debris && styles.rowEmpty,
            ]}
          >
            <View style={styles.posCol}>
              <Text style={[styles.posText, (isYours || myColony) && styles.posTextYours]}>
                {pos}
              </Text>
            </View>

            <View style={[styles.planetCol, styles.planetCell]}>
              {isYours ? (
                <>
                  <Globe size={14} color={Colors.primary} />
                  <Text style={styles.yourPlanet}>{state.planetName}</Text>
                </>
              ) : myColony ? (
                <>
                  <MapPin size={14} color={Colors.xenogas} />
                  <Text style={styles.colonyPlanet}>{myColony.planetName}</Text>
                </>
              ) : isOccupied && playerHere ? (
                <>
                  {isOtherPlayerColony ? (
                    <MapPin size={14} color={Colors.accent} />
                  ) : (
                    <CircleDot size={14} color={Colors.accent} />
                  )}
                  <Text style={styles.occupiedPlanet}>{playerHere.planet_name}</Text>
                </>
              ) : (
                <Text style={styles.emptyText}>—</Text>
              )}
              {debris && (
                <TouchableOpacity
                  onPress={() => openDebrisModal(pos, debris)}
                  style={styles.debrisIcon}
                  activeOpacity={0.6}
                >
                  <Sparkles size={12} color={Colors.warning} />
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.playerCol, styles.playerCell]}>
              {isYours ? (
                <>
                  <User size={12} color={Colors.primary} />
                  <Text style={styles.yourPlayer}>{state.username ?? 'Vous'}</Text>
                </>
              ) : myColony ? (
                <>
                  <User size={12} color={Colors.xenogas} />
                  <Text style={styles.colonyPlayer}>{state.username ?? 'Vous'}</Text>
                </>
              ) : isOccupied && playerHere ? (
                <Text style={styles.playerText}>
                  {playerHere.username || playerHere.email.split('@')[0]}
                </Text>
              ) : null}
            </View>

            <View style={[styles.actionsCol, styles.actionsCell]}>
              {isOccupied && !isYours && !myColony && playerHere && (() => {
                const { canAttack: canAtk, reason: atkReason } = getAttackStatus(playerHere.user_id);
                const tooltip = getAttackTooltip(playerHere.user_id);
                return (
                  <>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: Colors.silice + '15', borderColor: Colors.silice + '30' }]}
                      activeOpacity={0.6}
                      onPress={() => handleSpy(playerHere, pos)}
                    >
                      <ScanEye size={12} color={Colors.silice} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, {
                        backgroundColor: canAtk ? Colors.danger + '15' : Colors.surface,
                        borderColor: canAtk ? Colors.danger + '30' : Colors.border,
                        opacity: canAtk ? 1 : 0.4,
                      }]}
                      activeOpacity={0.6}
                      onPress={() => {
                        if (!canAtk && atkReason) {
                          showGameAlert('Attaque impossible', tooltip);
                          return;
                        }
                        handleAttack(playerHere, pos);
                      }}
                    >
                      <Crosshair size={12} color={canAtk ? Colors.danger : Colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: Colors.success + '15', borderColor: Colors.success + '30' }]}
                      activeOpacity={0.6}
                      onPress={() => handleTransport(playerHere, pos)}
                    >
                      <Truck size={12} color={Colors.success} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.msgBtn}
                      activeOpacity={0.6}
                      onPress={() => router.push({
                        pathname: '/compose-message',
                        params: {
                          receiverId: playerHere.user_id,
                          receiverUsername: playerHere.username || playerHere.email.split('@')[0],
                        },
                      })}
                    >
                      <Mail size={12} color={Colors.primary} />
                    </TouchableOpacity>
                  </>
                );
              })()}
              {isYours && isOwnNotActive && (
                <>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '30' }]}
                    activeOpacity={0.6}
                    onPress={() => handleStationOwn(pos, state.planetName)}
                  >
                    <Warehouse size={12} color={Colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: Colors.success + '15', borderColor: Colors.success + '30' }]}
                    activeOpacity={0.6}
                    onPress={() => handleTransportOwn(pos, state.planetName)}
                  >
                    <Truck size={12} color={Colors.success} />
                  </TouchableOpacity>
                </>
              )}
              {myColony && !isYours && isOwnNotActive && (
                <>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '30' }]}
                    activeOpacity={0.6}
                    onPress={() => handleStationOwn(pos, myColony.planetName)}
                  >
                    <Warehouse size={12} color={Colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: Colors.success + '15', borderColor: Colors.success + '30' }]}
                    activeOpacity={0.6}
                    onPress={() => handleTransportOwn(pos, myColony.planetName)}
                  >
                    <Truck size={12} color={Colors.success} />
                  </TouchableOpacity>
                </>
              )}
              {myColony && !isOwnNotActive && (
                <TouchableOpacity
                  style={styles.viewColonyBtn}
                  activeOpacity={0.6}
                  onPress={() => router.push({ pathname: '/colony-detail' as never, params: { colonyId: myColony.colonyId } })}
                >
                  <Text style={styles.viewColonyText}>Gérer</Text>
                </TouchableOpacity>
              )}
              {isEmpty && !isYours && !myColony && (
                <TouchableOpacity
                  style={styles.colonizeBtn}
                  activeOpacity={0.6}
                  onPress={() => handleColonize(pos)}
                >
                  <Flag size={11} color={Colors.xenogas} />
                  <Text style={styles.colonizeBtnText}>Coloniser</Text>
                </TouchableOpacity>
              )}
              {debris && !isOccupied && !isYours && !myColony && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '30' }]}
                  activeOpacity={0.6}
                  onPress={() => openDebrisModal(pos, debris)}
                >
                  <Recycle size={12} color={Colors.warning} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}

        </View>

        <View style={styles.legendSection}>
          <Text style={styles.legendTitle}>Légende</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
            <Text style={styles.legendText}>Votre planète</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: Colors.accent }]} />
            <Text style={styles.legendText}>Occupée</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: Colors.textMuted }]} />
            <Text style={styles.legendText}>Emplacement libre</Text>
          </View>
          <View style={styles.legendActions}>
            <View style={styles.legendActionRow}>
              <ScanEye size={12} color={Colors.silice} />
              <Text style={styles.legendText}>Espionner</Text>
            </View>
            <View style={styles.legendActionRow}>
              <Crosshair size={12} color={Colors.danger} />
              <Text style={styles.legendText}>Attaquer</Text>
            </View>
            <View style={styles.legendActionRow}>
              <Truck size={12} color={Colors.success} />
              <Text style={styles.legendText}>Transporter</Text>
            </View>
            <View style={styles.legendActionRow}>
              <Warehouse size={12} color={Colors.primary} />
              <Text style={styles.legendText}>Stationner</Text>
            </View>
            <View style={styles.legendActionRow}>
              <Flag size={12} color={Colors.xenogas} />
              <Text style={styles.legendText}>Coloniser</Text>
            </View>
            <View style={styles.legendActionRow}>
              <Sparkles size={12} color={Colors.warning} />
              <Text style={styles.legendText}>Champ de débris</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      <Modal
        visible={!!debrisModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeDebrisModal}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.debrisModalBox, { opacity: fadeAnim, transform: [{ scale: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
            <View style={styles.debrisModalAccent} />

            <TouchableOpacity style={styles.debrisModalClose} onPress={closeDebrisModal} activeOpacity={0.6}>
              <X size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.debrisModalContent}>
              <View style={styles.debrisModalIconWrap}>
                <Sparkles size={24} color={Colors.warning} />
              </View>
              <Text style={styles.debrisModalTitle}>Champ de débris</Text>
              <Text style={styles.debrisModalCoords}>
                [{viewGalaxy}:{viewSystem}:{debrisModal?.pos}]
              </Text>

              <View style={styles.debrisResRow}>
                {(debrisModal?.debris.fer ?? 0) > 0 && (
                  <View style={styles.debrisResItem}>
                    <View style={[styles.debrisResDot, { backgroundColor: Colors.fer }]} />
                    <Text style={styles.debrisResLabel}>Fer</Text>
                    <Text style={styles.debrisResValue}>{formatNumber(debrisModal?.debris.fer ?? 0)}</Text>
                  </View>
                )}
                {(debrisModal?.debris.silice ?? 0) > 0 && (
                  <View style={styles.debrisResItem}>
                    <View style={[styles.debrisResDot, { backgroundColor: Colors.silice }]} />
                    <Text style={styles.debrisResLabel}>Silice</Text>
                    <Text style={styles.debrisResValue}>{formatNumber(debrisModal?.debris.silice ?? 0)}</Text>
                  </View>
                )}
              </View>

              <Text style={styles.debrisHint}>
                Seule la capacité de cargo des Manta Recup est prise en compte pour la collecte.
              </Text>

              <View style={styles.debrisModalActions}>
                <TouchableOpacity style={styles.debrisCancelBtn} onPress={closeDebrisModal} activeOpacity={0.7}>
                  <Text style={styles.debrisCancelText}>Fermer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.debrisRecycleBtn}
                  onPress={() => debrisModal && handleRecycle(debrisModal.pos)}
                  activeOpacity={0.7}
                >
                  <Recycle size={16} color="#0A0A14" />
                  <Text style={styles.debrisRecycleText}>Envoyer Manta Recup</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    position: 'relative' as const,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  heroSection: {
    height: 130,
    marginBottom: 12,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  heroFade: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 50,
  },
  heroContent: {
    position: 'absolute' as const,
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
  },
  systemBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '25',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 6,
  },
  systemBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  systemCoordsHero: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: 2,
  },
  navSection: {
    backgroundColor: 'rgba(10, 18, 32, 0.75)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 168, 71, 0.12)',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  navLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    width: 70,
  },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(26, 37, 64, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInput: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    minWidth: 44,
    textAlign: 'center' as const,
    fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  navInputDisabled: {
    minWidth: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(26, 37, 64, 0.4)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  navInputText: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  homeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginTop: 4,
  },
  homeBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
  },

  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  tableContainer: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 168, 71, 0.15)',
    overflow: 'hidden' as const,
    marginBottom: 4,
    backgroundColor: 'rgba(5, 10, 20, 0.55)',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(212, 168, 71, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 168, 71, 0.12)',
  },
  tableHeaderText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  posCol: {
    width: 24,
  },
  planetCol: {
    flex: 2,
  },
  playerCol: {
    flex: 1.5,
  },
  actionsCol: {
    width: 120,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(26, 37, 64, 0.5)',
  },
  rowYours: {
    backgroundColor: 'rgba(212, 168, 71, 0.08)',
    borderLeftWidth: 2,
    borderLeftColor: Colors.primary,
    borderRadius: 4,
  },
  rowEmpty: {
    opacity: 0.55,
  },
  posText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  posTextYours: {
    color: Colors.primary,
  },
  planetCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  yourPlanet: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  occupiedPlanet: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  debrisIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.warning + '20',
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  playerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  yourPlayer: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '500' as const,
  },
  playerText: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  actionsCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  actionBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendSection: {
    marginTop: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 168, 71, 0.1)',
  },
  legendTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  legendActions: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 6,
  },
  legendActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 5, 10, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  debrisModalBox: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
    overflow: 'hidden',
  },
  debrisModalAccent: {
    height: 3,
    width: '100%',
    backgroundColor: Colors.warning,
  },
  debrisModalClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debrisModalContent: {
    padding: 24,
    alignItems: 'center',
  },
  debrisModalIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.warning + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  debrisModalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  debrisModalCoords: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
    letterSpacing: 1,
    marginBottom: 16,
  },
  debrisResRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  debrisResItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  debrisResDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginBottom: 4,
  },
  debrisResLabel: {
    color: Colors.textMuted,
    fontSize: 10,
  },
  debrisResValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  debrisHint: {
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 16,
  },
  debrisModalActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  debrisCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  debrisCancelText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  debrisRecycleBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.warning,
    gap: 6,
  },
  debrisRecycleText: {
    color: '#0A0A14',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  colonizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: Colors.xenogas + '15',
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
  },
  colonizeBtnText: {
    color: Colors.xenogas,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  rowColony: {
    backgroundColor: 'rgba(34, 211, 238, 0.06)',
    borderLeftWidth: 2,
    borderLeftColor: Colors.xenogas,
    borderRadius: 4,
  },
  colonyPlanet: {
    color: Colors.xenogas,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  colonyPlayer: {
    color: Colors.xenogas,
    fontSize: 11,
    fontWeight: '500' as const,
  },
  viewColonyBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: Colors.xenogas + '15',
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
  },
  viewColonyText: {
    color: Colors.xenogas,
    fontSize: 10,
    fontWeight: '600' as const,
  },
});
