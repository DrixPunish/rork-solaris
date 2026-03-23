import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Database, Shield, Rocket, Building2, FlaskConical, Zap, Package, Globe, Crown } from 'lucide-react-native';
import { useGame } from '@/contexts/GameContext';
import { formatNumber, getResourceStorageCapacity, calculateCost } from '@/utils/gameCalculations';
import { BUILDINGS, SHIPS, DEFENSES } from '@/constants/gameData';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

function sumResources(cost: { fer: number; silice: number; xenogas: number }): number {
  return cost.fer + cost.silice + cost.xenogas;
}

function localBuildingPoints(buildings: Record<string, number>): number {
  let total = 0;
  for (const building of BUILDINGS) {
    const level = buildings[building.id] ?? 0;
    for (let i = 0; i < level; i++) {
      total += sumResources(calculateCost(building.baseCost, building.costFactor, i));
    }
  }
  return total;
}

function localFleetPoints(ships: Record<string, number>): number {
  let total = 0;
  for (const ship of SHIPS) {
    const count = ships[ship.id] ?? 0;
    total += ((ship.cost.fer ?? 0) + (ship.cost.silice ?? 0) + (ship.cost.xenogas ?? 0)) * count;
  }
  return total;
}

function localDefensePoints(defenses: Record<string, number>): number {
  let total = 0;
  for (const def of DEFENSES) {
    const count = defenses[def.id] ?? 0;
    total += ((def.cost.fer ?? 0) + (def.cost.silice ?? 0) + (def.cost.xenogas ?? 0)) * count;
  }
  return total;
}

function ProductionBar({ label, value, maxValue, color }: { label: string; value: number; maxValue: number; color: string }) {
  const ratio = maxValue > 0 ? Math.min(1, value / maxValue) : 0;
  return (
    <View style={prodStyles.row}>
      <View style={prodStyles.labelRow}>
        <View style={[prodStyles.dot, { backgroundColor: color }]} />
        <Text style={prodStyles.label}>{label}</Text>
        <Text style={[prodStyles.value, { color }]}>{formatNumber(value)}/h</Text>
      </View>
      <View style={prodStyles.barBg}>
        <View style={[prodStyles.barFill, { width: `${Math.max(2, ratio * 100)}%` as unknown as number, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function StorageBar({ label, current, max, color }: { label: string; current: number; max: number; color: string }) {
  const ratio = max > 0 ? Math.min(1, current / max) : 0;
  const isFull = ratio >= 0.99;
  return (
    <View style={storStyles.row}>
      <View style={storStyles.labelRow}>
        <View style={[storStyles.dot, { backgroundColor: color }]} />
        <Text style={storStyles.label}>{label}</Text>
        <Text style={[storStyles.value, isFull && { color: Colors.danger }]}>
          {formatNumber(Math.floor(current))} / {formatNumber(max)}
        </Text>
      </View>
      <View style={storStyles.barBg}>
        <View style={[storStyles.barFill, { width: `${Math.max(1, ratio * 100)}%` as unknown as number, backgroundColor: isFull ? Colors.danger : color }]} />
      </View>
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <View style={[cardStyles.card, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={[cardStyles.iconWrap, { backgroundColor: color + '15' }]}>
        <Text>{icon}</Text>
      </View>
      <View style={cardStyles.textWrap}>
        <Text style={cardStyles.label}>{label}</Text>
        <Text style={cardStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

type TabId = 'overview' | 'planets';

interface PlanetScoreData {
  id: string;
  name: string;
  coordinates: [number, number, number];
  isMain: boolean;
  building: number;
  fleet: number;
  defense: number;
  total: number;
}

function PlanetScoreCard({ planet, maxTotal }: { planet: PlanetScoreData; maxTotal: number }) {
  const totalPts = Math.floor(planet.total / 1000);
  const buildPts = Math.floor(planet.building / 1000);
  const fleetPts = Math.floor(planet.fleet / 1000);
  const defPts = Math.floor(planet.defense / 1000);
  const ratio = maxTotal > 0 ? Math.min(1, planet.total / maxTotal) : 0;

  const categories = [
    { label: 'Bâtiments', pts: buildPts, raw: planet.building, color: Colors.primary, icon: <Building2 size={12} color={Colors.primary} /> },
    { label: 'Flotte', pts: fleetPts, raw: planet.fleet, color: Colors.accent, icon: <Rocket size={12} color={Colors.accent} /> },
    { label: 'Défense', pts: defPts, raw: planet.defense, color: Colors.success, icon: <Shield size={12} color={Colors.success} /> },
  ];
  const maxCat = Math.max(planet.building, planet.fleet, planet.defense, 1);

  return (
    <View style={planetStyles.card}>
      <View style={planetStyles.cardHeader}>
        <View style={planetStyles.nameRow}>
          {planet.isMain ? (
            <Crown size={14} color={Colors.primary} />
          ) : (
            <Globe size={14} color={Colors.xenogas} />
          )}
          <Text style={planetStyles.planetName}>{planet.name}</Text>
          {planet.isMain && <View style={planetStyles.mainBadge}><Text style={planetStyles.mainBadgeText}>Principal</Text></View>}
        </View>
        <Text style={planetStyles.coords}>[{planet.coordinates.join(':')}]</Text>
      </View>

      <View style={planetStyles.totalRow}>
        <Text style={planetStyles.totalLabel}>Score total</Text>
        <Text style={planetStyles.totalValue}>{formatNumber(totalPts)} pts</Text>
      </View>
      <View style={planetStyles.totalBarBg}>
        <View style={[planetStyles.totalBarFill, { width: `${Math.max(2, ratio * 100)}%` as unknown as number }]} />
      </View>

      <View style={planetStyles.breakdown}>
        {categories.map(cat => {
          const catRatio = maxCat > 0 ? Math.min(1, cat.raw / maxCat) : 0;
          return (
            <View key={cat.label} style={planetStyles.catRow}>
              <View style={planetStyles.catLabelRow}>
                {cat.icon}
                <Text style={planetStyles.catLabel}>{cat.label}</Text>
                <Text style={[planetStyles.catValue, { color: cat.color }]}>{formatNumber(cat.pts)}</Text>
              </View>
              <View style={planetStyles.catBarBg}>
                <View style={[planetStyles.catBarFill, { width: `${Math.max(2, catRatio * 100)}%` as unknown as number, backgroundColor: cat.color }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function StatisticsScreen() {
  const router = useRouter();
  const { state, production } = useGame();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const storageCap = useMemo(() => getResourceStorageCapacity(state.buildings), [state.buildings]);

  const maxProd = useMemo(() => Math.max(production.fer, production.silice, production.xenogas, 1), [production]);

  const { userId } = useGame();

  const playerScoreQuery = trpc.world.getPlayerScore.useQuery(
    { userId: userId ?? '' },
    { enabled: !!userId, refetchInterval: 30000 },
  );

  const serverScore = playerScoreQuery.data?.score;

  const scores = useMemo(() => ({
    building: serverScore?.building_points ?? 0,
    research: serverScore?.research_points ?? 0,
    fleet: serverScore?.fleet_points ?? 0,
    defense: serverScore?.defense_points ?? 0,
  }), [serverScore]);

  const totalScore = useMemo(() =>
    serverScore?.total_points ?? (scores.building + scores.research + scores.fleet + scores.defense),
    [serverScore, scores],
  );
  const maxScore = useMemo(() => Math.max(scores.building, scores.research, scores.fleet, scores.defense, 1), [scores]);

  const totalShips = useMemo(() => Object.values(state.ships).reduce((s, c) => s + c, 0), [state.ships]);
  const totalDefenses = useMemo(() => Object.values(state.defenses).reduce((s, c) => s + c, 0), [state.defenses]);
  const totalBuildings = useMemo(() => Object.values(state.buildings).reduce((s, l) => s + l, 0), [state.buildings]);
  const totalResearch = useMemo(() => Object.values(state.research).reduce((s, l) => s + l, 0), [state.research]);

  const colonyCount = state.colonies?.length ?? 0;

  const dailyProduction = useMemo(() => ({
    fer: production.fer * 24,
    silice: production.silice * 24,
    xenogas: production.xenogas * 24,
  }), [production]);

  const planetScores = useMemo<PlanetScoreData[]>(() => {
    const planets: PlanetScoreData[] = [];

    const mainBuild = localBuildingPoints(state.buildings);
    const mainFleet = localFleetPoints(state.ships);
    const mainDef = localDefensePoints(state.defenses);
    planets.push({
      id: 'main',
      name: state.planetName,
      coordinates: state.coordinates,
      isMain: true,
      building: mainBuild,
      fleet: mainFleet,
      defense: mainDef,
      total: mainBuild + mainFleet + mainDef,
    });

    for (const colony of (state.colonies ?? [])) {
      const bPts = localBuildingPoints(colony.buildings);
      const fPts = localFleetPoints(colony.ships);
      const dPts = localDefensePoints(colony.defenses);
      planets.push({
        id: colony.id,
        name: colony.planetName,
        coordinates: colony.coordinates,
        isMain: false,
        building: bPts,
        fleet: fPts,
        defense: dPts,
        total: bPts + fPts + dPts,
      });
    }

    return planets.sort((a, b) => b.total - a.total);
  }, [state.planetName, state.coordinates, state.buildings, state.ships, state.defenses, state.colonies]);

  const maxPlanetTotal = useMemo(() => Math.max(...planetScores.map(p => p.total), 1), [planetScores]);

  const researchPts = useMemo(() => scores.research, [scores.research]);

  const handleTabPress = useCallback((tab: TabId) => { setActiveTab(tab); }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Statistiques</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={tabStyles.tabBar}>
          <TouchableOpacity
            style={[tabStyles.tab, activeTab === 'overview' && tabStyles.tabActive]}
            onPress={() => handleTabPress('overview')}
            activeOpacity={0.7}
          >
            <Text style={[tabStyles.tabText, activeTab === 'overview' && tabStyles.tabTextActive]}>Vue générale</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[tabStyles.tab, activeTab === 'planets' && tabStyles.tabActive]}
            onPress={() => handleTabPress('planets')}
            activeOpacity={0.7}
          >
            <Text style={[tabStyles.tabText, activeTab === 'planets' && tabStyles.tabTextActive]}>Par planète</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.scoreHeader}>
            <Text style={styles.scoreLabel}>Score Total</Text>
            {playerScoreQuery.isLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={styles.scoreValue}>{formatNumber(totalScore)}</Text>
            )}
            <Text style={styles.scoreUnit}>points</Text>
          </View>

          {activeTab === 'planets' ? (
            <>
              <View style={planetStyles.researchGlobal}>
                <FlaskConical size={14} color={Colors.silice} />
                <Text style={planetStyles.researchLabel}>Recherche (global)</Text>
                <Text style={planetStyles.researchValue}>{formatNumber(researchPts)} pts</Text>
              </View>

              {planetScores.map(planet => (
                <PlanetScoreCard key={planet.id} planet={planet} maxTotal={maxPlanetTotal} />
              ))}

              {planetScores.length === 1 && (
                <View style={planetStyles.emptyHint}>
                  <Globe size={20} color={Colors.textMuted} />
                  <Text style={planetStyles.emptyText}>Colonisez d'autres planètes pour voir la comparaison</Text>
                </View>
              )}

              <View style={{ height: 40 }} />
            </>
          ) : (
            <>

          <Text style={styles.sectionTitle}>Production par heure</Text>
          <View style={styles.section}>
            <ProductionBar
              label="Fer"
              value={production.fer}
              maxValue={maxProd}
              color={Colors.fer}
            />
            <ProductionBar
              label="Silice"
              value={production.silice}
              maxValue={maxProd}
              color={Colors.silice}
            />
            <ProductionBar
              label="Xenogas"
              value={production.xenogas}
              maxValue={maxProd}
              color={Colors.xenogas}
            />
            <View style={prodStyles.energyRow}>
              <Zap size={14} color={Colors.energy} />
              <Text style={prodStyles.energyLabel}>Énergie nette</Text>
              <Text style={[prodStyles.energyValue, production.energy < 0 && { color: Colors.danger }]}>
                {production.energy >= 0 ? '+' : ''}{formatNumber(production.energy)}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Production journalière estimée</Text>
          <View style={styles.dailyRow}>
            <View style={styles.dailyCard}>
              <View style={[styles.dailyDot, { backgroundColor: Colors.fer }]} />
              <Text style={styles.dailyValue}>{formatNumber(Math.floor(dailyProduction.fer))}</Text>
              <Text style={styles.dailyLabel}>Fer/jour</Text>
            </View>
            <View style={styles.dailyCard}>
              <View style={[styles.dailyDot, { backgroundColor: Colors.silice }]} />
              <Text style={styles.dailyValue}>{formatNumber(Math.floor(dailyProduction.silice))}</Text>
              <Text style={styles.dailyLabel}>Silice/jour</Text>
            </View>
            <View style={styles.dailyCard}>
              <View style={[styles.dailyDot, { backgroundColor: Colors.xenogas }]} />
              <Text style={styles.dailyValue}>{formatNumber(Math.floor(dailyProduction.xenogas))}</Text>
              <Text style={styles.dailyLabel}>Xeno/jour</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Stockage</Text>
          <View style={styles.section}>
            <StorageBar label="Fer" current={state.resources.fer} max={storageCap.fer} color={Colors.fer} />
            <StorageBar label="Silice" current={state.resources.silice} max={storageCap.silice} color={Colors.silice} />
            <StorageBar label="Xenogas" current={state.resources.xenogas} max={storageCap.xenogas} color={Colors.xenogas} />
          </View>

          <Text style={styles.sectionTitle}>Répartition du score</Text>
          <View style={styles.section}>
            {[
              { label: 'Bâtiments', pts: scores.building, icon: <Building2 size={16} color={Colors.primary} />, color: Colors.primary },
              { label: 'Recherche', pts: scores.research, icon: <FlaskConical size={16} color={Colors.silice} />, color: Colors.silice },
              { label: 'Flotte', pts: scores.fleet, icon: <Rocket size={16} color={Colors.accent} />, color: Colors.accent },
              { label: 'Défense', pts: scores.defense, icon: <Shield size={16} color={Colors.success} />, color: Colors.success },
            ].map(item => {
              const ratio = maxScore > 0 ? Math.min(1, item.pts / maxScore) : 0;
              return (
                <View key={item.label} style={scoreStyles.row}>
                  <View style={scoreStyles.labelRow}>
                    {item.icon}
                    <Text style={scoreStyles.label}>{item.label}</Text>
                    <Text style={[scoreStyles.value, { color: item.color }]}>{formatNumber(item.pts)} pts</Text>
                  </View>
                  <View style={scoreStyles.barBg}>
                    <View style={[scoreStyles.barFill, { width: `${Math.max(2, ratio * 100)}%` as unknown as number, backgroundColor: item.color }]} />
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Empire</Text>
          <View style={styles.empireGrid}>
            <StatCard icon={<Building2 size={18} color={Colors.primary} />} label="Bâtiments" value={String(totalBuildings)} color={Colors.primary} />
            <StatCard icon={<FlaskConical size={18} color={Colors.silice} />} label="Recherches" value={String(totalResearch)} color={Colors.silice} />
            <StatCard icon={<Rocket size={18} color={Colors.accent} />} label="Vaisseaux" value={String(totalShips)} color={Colors.accent} />
            <StatCard icon={<Shield size={18} color={Colors.success} />} label="Défenses" value={String(totalDefenses)} color={Colors.success} />
            <StatCard icon={<Database size={18} color={Colors.xenogas} />} label="Colonies" value={String(colonyCount)} color={Colors.xenogas} />
            <StatCard icon={<Package size={18} color={Colors.energy} />} label="Colonies" value={String(colonyCount)} color={Colors.energy} />
          </View>

          <Text style={styles.sectionTitle}>Flotte détaillée</Text>
          <View style={styles.section}>
            {SHIPS.filter(s => (state.ships[s.id] ?? 0) > 0).map(ship => (
              <View key={ship.id} style={fleetStyles.row}>
                <Rocket size={14} color={Colors.primary} />
                <Text style={fleetStyles.name}>{ship.name}</Text>
                <Text style={fleetStyles.count}>x{state.ships[ship.id]}</Text>
              </View>
            ))}
            {DEFENSES.filter(d => (state.defenses[d.id] ?? 0) > 0).map(def => (
              <View key={def.id} style={fleetStyles.row}>
                <Shield size={14} color={Colors.success} />
                <Text style={fleetStyles.name}>{def.name}</Text>
                <Text style={fleetStyles.count}>x{state.defenses[def.id]}</Text>
              </View>
            ))}
            {totalShips === 0 && totalDefenses === 0 && (
              <Text style={combatStyles.noData}>Aucun vaisseau ou défense</Text>
            )}
          </View>

          <View style={{ height: 40 }} />
            </>
          )}
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
  scoreHeader: {
    alignItems: 'center' as const,
    paddingVertical: 20,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginBottom: 20,
  },
  scoreLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 1 },
  scoreValue: { color: Colors.primary, fontSize: 36, fontWeight: '800' as const, marginTop: 4 },
  scoreUnit: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 8,
  },
  section: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  dailyRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 16 },
  dailyCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dailyDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 6 },
  dailyValue: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  dailyLabel: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  empireGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 16 },
});

const prodStyles = StyleSheet.create({
  row: { marginBottom: 12 },
  labelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: Colors.text, fontSize: 13, fontWeight: '500' as const, flex: 1 },
  value: { fontSize: 13, fontWeight: '700' as const },
  barBg: { height: 6, backgroundColor: Colors.surface, borderRadius: 3, overflow: 'hidden' as const },
  barFill: { height: 6, borderRadius: 3 },
  energyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  energyLabel: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  energyValue: { color: Colors.energy, fontSize: 13, fontWeight: '700' as const },
});

const storStyles = StyleSheet.create({
  row: { marginBottom: 12 },
  labelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: Colors.text, fontSize: 13, fontWeight: '500' as const, flex: 1 },
  value: { color: Colors.textSecondary, fontSize: 11 },
  barBg: { height: 8, backgroundColor: Colors.surface, borderRadius: 4, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
});

const scoreStyles = StyleSheet.create({
  row: { marginBottom: 12 },
  labelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 6 },
  label: { color: Colors.text, fontSize: 13, fontWeight: '500' as const, flex: 1 },
  value: { fontSize: 12, fontWeight: '700' as const },
  barBg: { height: 6, backgroundColor: Colors.surface, borderRadius: 3, overflow: 'hidden' as const },
  barFill: { height: 6, borderRadius: 3 },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    width: '48%' as unknown as number,
    flexGrow: 1,
    flexBasis: '45%' as unknown as number,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
  textWrap: { flex: 1 },
  label: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' as const },
  value: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
});

const combatStyles = StyleSheet.create({
  noData: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' as const, paddingVertical: 12 },
});

const fleetStyles = StyleSheet.create({
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  name: { color: Colors.text, fontSize: 13, flex: 1 },
  count: { color: Colors.primary, fontSize: 13, fontWeight: '700' as const },
});

const tabStyles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary + '50',
  },
  tabText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  tabTextActive: {
    color: Colors.primary,
  },
});

const planetStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  planetName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  mainBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  mainBadgeText: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  coords: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500' as const,
  },
  totalRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
  },
  totalLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  totalValue: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  totalBarBg: {
    height: 5,
    backgroundColor: Colors.surface,
    borderRadius: 3,
    overflow: 'hidden' as const,
    marginBottom: 12,
  },
  totalBarFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  breakdown: {
    gap: 8,
  },
  catRow: {},
  catLabelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  catLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500' as const,
    flex: 1,
  },
  catValue: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  catBarBg: {
    height: 4,
    backgroundColor: Colors.surface,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  catBarFill: {
    height: 4,
    borderRadius: 2,
  },
  researchGlobal: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.silice + '30',
    marginBottom: 16,
  },
  researchLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500' as const,
    flex: 1,
  },
  researchValue: {
    color: Colors.silice,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  emptyHint: {
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 24,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center' as const,
  },
});
