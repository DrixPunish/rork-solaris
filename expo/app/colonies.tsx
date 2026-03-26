import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Globe, ChevronRight, Trash2, MapPin } from 'lucide-react-native';
import { useGame } from '@/contexts/GameContext';
import { calculateProduction, formatNumber } from '@/utils/gameCalculations';
import Colors from '@/constants/colors';
import { showGameAlert } from '@/components/GameAlert';
import ClickableCoords from '@/components/ClickableCoords';

export default function ColoniesScreen() {
  const router = useRouter();
  const { state, maxColonies, removeColony, activePlanetId, setActivePlanetId } = useGame();
  const colonies = state.colonies ?? [];
  const astroLevel = state.research.astrophysics ?? 0;

  const pendingDeleteRef = React.useRef<string | null>(null);
  const deleteTapRef = React.useRef(false);

  const handleDeleteColony = useCallback((colonyId: string, colonyName: string) => {
    deleteTapRef.current = true;
    setTimeout(() => { deleteTapRef.current = false; }, 400);
    showGameAlert(
      'Abandonner la colonie',
      `Êtes-vous sûr de vouloir abandonner ${colonyName} ? Toutes les ressources, bâtiments et vaisseaux seront perdus.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Abandonner',
          style: 'destructive',
          onPress: () => {
            pendingDeleteRef.current = colonyId;
            setTimeout(() => {
              if (pendingDeleteRef.current) {
                console.log('[Colonies] Removing colony (deferred)', pendingDeleteRef.current);
                removeColony(pendingDeleteRef.current);
                pendingDeleteRef.current = null;
              }
            }, 300);
          },
        },
      ],
      'confirm',
    );
  }, [removeColony]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Colonies</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Globe size={18} color={Colors.xenogas} />
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Gestion des Colonies</Text>
                <Text style={styles.infoDesc}>
                  Envoyez une Barge Coloniale vers une position vide pour fonder une colonie. La recherche Xéno-Cartographie augmente le nombre de colonies possibles.
                </Text>
              </View>
            </View>
            <View style={styles.slotsRow}>
              <Text style={styles.slotsLabel}>Emplacements</Text>
              <Text style={[styles.slotsValue, colonies.length >= maxColonies && { color: Colors.danger }]}>
                {colonies.length} / {maxColonies}
              </Text>
            </View>
            <View style={styles.reqRow}>
              <Text style={styles.reqLabel}>Xéno-Cartographie</Text>
              <Text style={[styles.reqValue, astroLevel === 0 && { color: Colors.danger }]}>Nv. {astroLevel}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.homeworldCard, !activePlanetId && styles.activePlanetCard]}
            onPress={() => {
              setActivePlanetId(null);
              router.back();
            }}
            activeOpacity={0.7}
          >
            <View style={styles.planetIcon}>
              <Globe size={22} color={Colors.primary} />
            </View>
            <View style={styles.planetInfo}>
              <View style={styles.planetNameRow}>
                <Text style={styles.planetName}>{state.planetName}</Text>
                <View style={styles.homeBadge}>
                  <Text style={styles.homeBadgeText}>Monde Natal</Text>
                </View>
                {!activePlanetId && (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Actif</Text>
                  </View>
                )}
              </View>
              <ClickableCoords coords={state.coordinates} style={styles.coordsText} />
            </View>
            <ChevronRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>

          {colonies.length > 0 && (
            <Text style={styles.sectionTitle}>Vos colonies</Text>
          )}

          {colonies.map(colony => {
            const _prod = calculateProduction(colony.buildings, state.research, colony.ships);
            const totalBuildings = Object.values(colony.buildings).reduce((s, l) => s + l, 0);
            const totalShips = Object.values(colony.ships).reduce((s, c) => s + c, 0);
            const activeTimerCount = colony.activeTimers.length;

            return (
              <TouchableOpacity
                key={colony.id}
                style={[styles.colonyCard, activePlanetId === colony.id && styles.activePlanetCard]}
                onPress={() => {
                  if (deleteTapRef.current) return;
                  setActivePlanetId(colony.id);
                  router.back();
                }}
                activeOpacity={0.7}
              >
                <View style={styles.colonyIconWrap}>
                  <MapPin size={20} color={Colors.xenogas} />
                </View>
                <View style={styles.colonyInfo}>
                  <View style={styles.colonyNameRow}>
                    <Text style={styles.colonyName}>{colony.planetName}</Text>
                    {activePlanetId === colony.id && (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText}>Actif</Text>
                      </View>
                    )}
                  </View>
                  <ClickableCoords coords={colony.coordinates} style={styles.colonyCoords} />
                  <View style={styles.colonyStatsRow}>
                    <Text style={styles.colonyStat}>
                      <Text style={{ color: Colors.fer }}>{formatNumber(Math.floor(colony.resources.fer))}</Text>
                      {' / '}
                      <Text style={{ color: Colors.silice }}>{formatNumber(Math.floor(colony.resources.silice))}</Text>
                      {' / '}
                      <Text style={{ color: Colors.xenogas }}>{formatNumber(Math.floor(colony.resources.xenogas))}</Text>
                    </Text>
                  </View>
                  <View style={styles.colonyMiniStats}>
                    <Text style={styles.miniStat}>{totalBuildings} bâtiments</Text>
                    <Text style={styles.miniDot}>·</Text>
                    <Text style={styles.miniStat}>{totalShips} vaisseaux</Text>
                    {activeTimerCount > 0 && (
                      <>
                        <Text style={styles.miniDot}>·</Text>
                        <Text style={[styles.miniStat, { color: Colors.primary }]}>{activeTimerCount} en cours</Text>
                      </>
                    )}
                  </View>
                </View>
                <View style={styles.colonyActions}>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => {
                      handleDeleteColony(colony.id, colony.planetName);
                    }}
                    hitSlop={8}
                  >
                    <Trash2 size={14} color={Colors.danger} />
                  </TouchableOpacity>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </View>
              </TouchableOpacity>
            );
          })}

          {colonies.length === 0 && (
            <View style={styles.emptyState}>
              <Globe size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucune colonie</Text>
              <Text style={styles.emptyDesc}>
                Construisez une Barge Coloniale dans votre chantier spatial, puis envoyez-la vers une position vide dans l{"'"}atlas galactique pour fonder votre première colonie.
              </Text>
              {astroLevel === 0 && (
                <View style={styles.requirementBanner}>
                  <Text style={styles.requirementText}>
                    Recherchez d{"'"}abord la Xéno-Cartographie pour débloquer la colonisation.
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.card, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: Colors.border },
  headerTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  infoCard: {
    backgroundColor: Colors.xenogas + '08',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.xenogas + '20',
    marginBottom: 16,
  },
  infoRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 12 },
  infoText: { flex: 1 },
  infoTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  infoDesc: { color: Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  slotsRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  slotsLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  slotsValue: { color: Colors.xenogas, fontSize: 14, fontWeight: '700' as const },
  reqRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginTop: 6 },
  reqLabel: { color: Colors.textMuted, fontSize: 11 },
  reqValue: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  homeworldCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginBottom: 16,
    gap: 12,
  },
  planetIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  planetInfo: { flex: 1 },
  planetNameRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  planetName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  homeBadge: { backgroundColor: Colors.primary + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  homeBadgeText: { color: Colors.primary, fontSize: 10, fontWeight: '700' as const },
  coordsText: { color: Colors.primary, fontSize: 12, fontWeight: '500' as const, marginTop: 2, letterSpacing: 1 },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  colonyCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    gap: 12,
  },
  activePlanetCard: {
    borderColor: Colors.primary + '60',
    backgroundColor: Colors.primary + '08',
  },
  activeBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  activeBadgeText: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '700' as const,
  },
  colonyNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  colonyIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.xenogas + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  colonyInfo: { flex: 1 },
  colonyName: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  colonyCoords: { color: Colors.xenogas, fontSize: 11, fontWeight: '500' as const, marginTop: 2, letterSpacing: 1 },
  colonyStatsRow: { marginTop: 4 },
  colonyStat: { fontSize: 11 },
  colonyMiniStats: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginTop: 3 },
  miniStat: { color: Colors.textMuted, fontSize: 10 },
  miniDot: { color: Colors.textMuted, fontSize: 10 },
  colonyActions: { alignItems: 'center' as const, gap: 10 },
  deleteBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.danger + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  emptyState: { alignItems: 'center' as const, paddingVertical: 40 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginTop: 12 },
  emptyDesc: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' as const, lineHeight: 19, marginTop: 8, paddingHorizontal: 20 },
  requirementBanner: {
    marginTop: 16,
    backgroundColor: Colors.danger + '12',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.danger + '25',
  },
  requirementText: { color: Colors.danger, fontSize: 12, textAlign: 'center' as const },
});
