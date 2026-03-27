import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Pressable, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, Pencil, X, Check, Hammer, Rocket, Shield,
  Minus, Plus, FlaskConical, Pickaxe, Gem, Droplets, Sun, Bot, Wrench, Atom, Warehouse,
  Database, Container, Cog, Zap, Target, Sword, ShieldCheck, Flame, Gauge, Eye, Cpu,
  Globe, Navigation, Brain, Orbit, Anchor, Crosshair, Ship, Bomb, Package, Truck, Home,
  SquareStack, ScanEye, Radio, CircleDot,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useGame } from '@/contexts/GameContext';
import { usePlanetActions } from '@/hooks/usePlanetActions';
import { BUILDINGS, RESEARCH, SHIPS, DEFENSES } from '@/constants/gameData';
import {
  calculateCost, canAfford, calculateUpgradeTime, calculateResearchTime, formatNumber, formatTime,
  checkPrerequisites, calculateProduction, getResourceStorageCapacity,
  getBuildingProductionAtLevel, getMineEnergyConsumption, getEnergyRatio,
  getSolarPlantProduction, getStorageCapacity, calculateEnergyProduced,
  calculateEnergyConsumption, formatSpeed, getBoostedShipStats, getBoostedDefenseStats,
  getNeuralMeshLabBonus,
} from '@/utils/gameCalculations';
import { getMissingPrereqLabels } from '@/utils/prereqLabels';
import { Resources, ShipDef, DefenseDef } from '@/types/game';
import Colors from '@/constants/colors';

import CollapsibleSection from '@/components/CollapsibleSection';
import GameCard from '@/components/GameCard';

type TabMode = 'buildings' | 'research' | 'shipyard';

const BUILDING_ICONS: Record<string, { icon: React.ComponentType<{ size: number; color: string }>; color: string }> = {
  ferMine: { icon: Pickaxe, color: Colors.fer },
  siliceMine: { icon: Gem, color: Colors.silice },
  xenogasRefinery: { icon: Droplets, color: Colors.xenogas },
  solarPlant: { icon: Sun, color: Colors.energy },
  ferroStore: { icon: Warehouse, color: Colors.fer },
  silicaStore: { icon: Database, color: Colors.silice },
  xenoStore: { icon: Container, color: Colors.xenogas },
  roboticsFactory: { icon: Bot, color: Colors.primary },
  shipyard: { icon: Wrench, color: Colors.accent },
  researchLab: { icon: FlaskConical, color: Colors.silice },
  naniteFactory: { icon: Atom, color: Colors.success },
  geoformEngine: { icon: Cog, color: Colors.energy },
};

const RESEARCH_ICONS: Record<string, { icon: React.ComponentType<{ size: number; color: string }>; color: string }> = {
  quantumFlux: { icon: Zap, color: Colors.energy },
  plasmaOverdrive: { icon: Atom, color: Colors.accent },
  particleBeam: { icon: Target, color: Colors.danger },
  ionicStream: { icon: Gauge, color: Colors.xenogas },
  weaponsTech: { icon: Sword, color: Colors.accent },
  shieldTech: { icon: Shield, color: Colors.primary },
  armorTech: { icon: ShieldCheck, color: Colors.fer },
  chemicalDrive: { icon: Flame, color: Colors.accent },
  impulseReactor: { icon: Navigation, color: Colors.xenogas },
  voidDrive: { icon: Orbit, color: Colors.silice },
  computerTech: { icon: Cpu, color: Colors.primary },
  espionageTech: { icon: Eye, color: Colors.silice },
  astrophysics: { icon: Globe, color: Colors.success },
  subspacialNodes: { icon: Brain, color: Colors.xenogas },
  neuralMesh: { icon: Brain, color: Colors.solar },
  gravitonTech: { icon: Zap, color: Colors.warning },
};

const SHIP_SPRITES: Record<string, string> = {
  novaScout: 'https://r2-pub.rork.com/generated-images/bba3836e-be8f-43ea-be8e-fad3165bab05.png',
  ferDeLance: 'https://r2-pub.rork.com/generated-images/f9c8f9a6-12f8-4782-9910-527d3b32fe56.png',
  cyclone: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/ret77c6q3zk3z3i90hkpf',
  bastion: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/1n7dke1zs8dqp5r2abjve',
  pyro: 'https://r2-pub.rork.com/generated-images/8ebc9e63-7776-47ae-ba50-af1d15803573.png',
  nemesis: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/h3k0ikgdmtrlcis9ub3un',
  fulgurant: 'https://r2-pub.rork.com/generated-images/05186ae9-ae3e-4440-9db0-b121a7ada672.png',
  titanAstral: 'https://r2-pub.rork.com/generated-images/e7cdcb99-c100-468a-b8a3-7bdfe5fae3d2.png',
};

const SHIP_ICONS: Record<string, { icon: React.ComponentType<{ size: number; color: string }>; color: string }> = {
  novaScout: { icon: Navigation, color: Colors.primary },
  ferDeLance: { icon: Sword, color: Colors.accent },
  cyclone: { icon: Ship, color: Colors.xenogas },
  bastion: { icon: Anchor, color: Colors.danger },
  pyro: { icon: Flame, color: Colors.warning },
  nemesis: { icon: Crosshair, color: Colors.silice },
  fulgurant: { icon: Bomb, color: Colors.warning },
  titanAstral: { icon: Zap, color: Colors.solar },
  atlasCargo: { icon: Package, color: Colors.fer },
  atlasCargoXL: { icon: Truck, color: Colors.energy },
  colonyShip: { icon: Home, color: Colors.success },
  mantaRecup: { icon: SquareStack, color: Colors.primaryDim },
  spectreSonde: { icon: ScanEye, color: Colors.silice },
  heliosRemorqueur: { icon: Sun, color: Colors.energy },
};

const DEFENSE_ICONS: Record<string, { icon: React.ComponentType<{ size: number; color: string }>; color: string }> = {
  kineticTurret: { icon: Target, color: Colors.fer },
  pulseCannon: { icon: Zap, color: Colors.primary },
  beamCannon: { icon: Radio, color: Colors.xenogas },
  massDriver: { icon: Crosshair, color: Colors.danger },
  ionProjector: { icon: CircleDot, color: Colors.silice },
  solarCannon: { icon: Sun, color: Colors.warning },
  smallShield: { icon: Shield, color: Colors.primaryDim },
  largeShield: { icon: Shield, color: Colors.solar },
};

const ENERGY_RESEARCH_IDS = ['quantumFlux', 'plasmaOverdrive'];
const COMBAT_RESEARCH_IDS = ['particleBeam', 'ionicStream', 'weaponsTech', 'shieldTech', 'armorTech'];
const PROPULSION_RESEARCH_IDS = ['chemicalDrive', 'impulseReactor', 'voidDrive'];
const ADVANCED_RESEARCH_IDS = ['computerTech', 'espionageTech', 'astrophysics', 'subspacialNodes', 'neuralMesh', 'gravitonTech'];
const COMBAT_SHIP_IDS = ['novaScout', 'ferDeLance', 'cyclone', 'bastion', 'pyro', 'nemesis', 'fulgurant', 'titanAstral'];
const UTILITY_SHIP_IDS = ['atlasCargo', 'atlasCargoXL', 'colonyShip', 'mantaRecup', 'spectreSonde', 'heliosRemorqueur'];

function ColonyResourceBar({ colonyId }: { colonyId: string }) {
  const { state } = useGame();
  const colony = useMemo(() => (state.colonies ?? []).find(c => c.id === colonyId), [state.colonies, colonyId]);
  if (!colony) return null;

  const colonyPct = colony.productionPercentages;
  const production = useMemo(() => calculateProduction(colony.buildings, state.research, colony.ships, colonyPct), [colony.buildings, state.research, colony.ships, colonyPct]);
  const storageCap = useMemo(() => getResourceStorageCapacity(colony.buildings), [colony.buildings]);
  const energyProduced = calculateEnergyProduced(colony.buildings, state.research, colony.ships, colonyPct);
  const energyConsumed = calculateEnergyConsumption(colony.buildings, colonyPct);
  const energyBalance = energyProduced - energyConsumed;
  const energyColor = energyBalance < 0 ? Colors.danger : Colors.energy;

  const storagePct = useMemo(() => ({
    fer: storageCap.fer > 0 ? colony.resources.fer / storageCap.fer : 0,
    silice: storageCap.silice > 0 ? colony.resources.silice / storageCap.silice : 0,
    xenogas: storageCap.xenogas > 0 ? colony.resources.xenogas / storageCap.xenogas : 0,
  }), [colony.resources, storageCap]);

  const getStorageColor = (percent: number): string => {
    if (percent >= 1) return Colors.danger;
    if (percent >= 0.8) return Colors.warning;
    return '';
  };

  const renderItem = (label: string, color: string, value: number, rate?: number, storagePctVal?: number) => {
    const storageColor = storagePctVal !== undefined ? getStorageColor(storagePctVal) : '';
    const valueColor = storageColor || Colors.text;
    return (
      <View style={resStyles.item} key={label}>
        <View style={[resStyles.dot, { backgroundColor: color }]} />
        <View style={resStyles.itemContent}>
          <Text style={resStyles.label}>{label}</Text>
          <Text style={[resStyles.value, { color: valueColor }]}>{formatNumber(value)}</Text>
          {storagePctVal !== undefined && (
            <View style={resStyles.storageBarOuter}>
              <View style={[resStyles.storageBarInner, { width: `${Math.min(100, Math.round(storagePctVal * 100))}%` as unknown as number, backgroundColor: storageColor || Colors.primary + '60' }]} />
            </View>
          )}
          {rate !== undefined && rate > 0 && storagePctVal !== undefined && storagePctVal >= 1 ? (
            <Text style={[resStyles.rate, { color: Colors.danger }]}>FULL</Text>
          ) : rate !== undefined && rate > 0 ? (
            <Text style={[resStyles.rate, { color }]}>+{formatNumber(rate)}/h</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={resStyles.container}>
      {renderItem('Fer', Colors.fer, colony.resources.fer, production.fer, storagePct.fer)}
      {renderItem('Silice', Colors.silice, colony.resources.silice, production.silice, storagePct.silice)}
      {renderItem('Xenogas', Colors.xenogas, colony.resources.xenogas, production.xenogas, storagePct.xenogas)}
      {renderItem('Énergie', energyColor, energyBalance)}
      {renderItem('Solar', Colors.solar, state.solar)}
    </View>
  );
}

const resStyles = StyleSheet.create({
  container: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  item: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  itemContent: { minWidth: 40 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: Colors.textMuted, fontSize: 8, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  value: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  storageBarOuter: { height: 3, backgroundColor: Colors.border, borderRadius: 2, marginTop: 2, overflow: 'hidden' as const },
  storageBarInner: { height: 3, borderRadius: 2 },
  rate: { fontSize: 9 },
});

function QuantitySelector({ quantity, maxQuantity, onChange }: { quantity: number; maxQuantity: number; onChange: (q: number) => void }) {
  return (
    <View style={qStyles.container}>
      <TouchableOpacity onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(Math.max(1, quantity - 1)); }} style={qStyles.btn} activeOpacity={0.6}>
        <Minus size={14} color={Colors.text} />
      </TouchableOpacity>
      <TextInput
        style={qStyles.input}
        value={String(quantity)}
        onChangeText={(text) => { const num = parseInt(text, 10); if (!isNaN(num) && num >= 1) onChange(Math.min(num, maxQuantity)); else if (text === '') onChange(1); }}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={5}
      />
      <TouchableOpacity onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(Math.min(maxQuantity, quantity + 1)); }} style={qStyles.btn} activeOpacity={0.6}>
        <Plus size={14} color={Colors.text} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(Math.max(1, maxQuantity)); }} style={qStyles.maxBtn} activeOpacity={0.6}>
        <Text style={qStyles.maxText}>MAX</Text>
      </TouchableOpacity>
    </View>
  );
}

const qStyles = StyleSheet.create({
  container: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 8 },
  btn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const, justifyContent: 'center' as const },
  input: { width: 54, height: 32, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, color: Colors.text, fontSize: 14, fontWeight: '700' as const, textAlign: 'center' as const, paddingVertical: 0 },
  maxBtn: { height: 32, paddingHorizontal: 12, borderRadius: 8, backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary + '40', alignItems: 'center' as const, justifyContent: 'center' as const },
  maxText: { color: Colors.primary, fontSize: 11, fontWeight: '700' as const },
});

export default function ColonyDetailScreen() {
  const { colonyId } = useLocalSearchParams<{ colonyId: string }>();
  const router = useRouter();
  const { state } = useGame();
  const {
    renamePlanet,
    upgradeBuilding,
    upgradeResearch,
    buildShipQueue,
    buildDefenseQueue,
    rushWithSolar,
    cancelUpgrade,
    rushShipyardWithSolar,
    cancelShipyardQueue,
    getMaxBuildableQuantity,
  } = usePlanetActions(colonyId ?? null);

  const colony = useMemo(() => (state.colonies ?? []).find(c => c.id === colonyId), [state.colonies, colonyId]);

  const [renameVisible, setRenameVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeTab, setActiveTab] = useState<TabMode>('buildings');
  const [shipyardSubTab, setShipyardSubTab] = useState<'ships' | 'defenses'>('ships');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const getQuantity = useCallback((id: string) => quantities[id] ?? 1, [quantities]);
  const setQuantity = useCallback((id: string, q: number) => {
    setQuantities(prev => ({ ...prev, [id]: q }));
  }, []);

  const openRenameModal = useCallback(() => {
    if (colony) {
      setNewName(colony.planetName);
    }
    setRenameVisible(true);
  }, [colony]);

  const handleRename = useCallback(() => {
    if (!colonyId) return;
    const trimmed = newName.trim();
    if (trimmed && trimmed.length <= 24) {
      renamePlanet(trimmed);
    }
    setRenameVisible(false);
  }, [colonyId, newName, renamePlanet]);

  const renderBuilding = useCallback(
    (building: typeof BUILDINGS[0]) => {
      if (!colony || !colonyId) return null;
      const level = colony.buildings[building.id] ?? 0;
      const cost = calculateCost(building.baseCost, building.costFactor, level);
      const affordable = canAfford(colony.resources, cost);
      const iconDef = BUILDING_ICONS[building.id];
      const IconComponent = iconDef?.icon ?? Bot;
      const iconColor = iconDef?.color ?? Colors.primary;
      const colonyPct = colony.productionPercentages;
      const prodText = getBuildingProductionAtLevel(building.id, level, colony.buildings, state.research, colony.ships, colonyPct);
      const energyCost = getMineEnergyConsumption(building.id, level);
      const energyRatio = getEnergyRatio(colony.buildings, state.research, colony.ships, colonyPct);

      const timer = colony.activeTimers.find(t => t.id === building.id && t.type === 'building');
      const isCurrentlyUpgrading = !!timer;

      const { met: prereqsMet } = checkPrerequisites(building.prerequisites, colony.buildings, state.research);
      const missingPrereqs = getMissingPrereqLabels(building.prerequisites, colony.buildings, state.research);

      const roboticsLevel = colony.buildings.roboticsFactory ?? 0;
      const upgradeDuration = calculateUpgradeTime(building.baseTime, building.timeFactor, level, roboticsLevel);

      const costs = [];
      if (cost.fer > 0) costs.push({ label: 'Fer', value: formatNumber(cost.fer), affordable: colony.resources.fer >= cost.fer });
      if (cost.silice > 0) costs.push({ label: 'Silice', value: formatNumber(cost.silice), affordable: colony.resources.silice >= cost.silice });
      if (cost.xenogas > 0) costs.push({ label: 'Xenogas', value: formatNumber(cost.xenogas), affordable: colony.resources.xenogas >= cost.xenogas });

      const nextProd: { label: string; value: string; positive: boolean }[] = [];
      const nextLevelEnergy = getMineEnergyConsumption(building.id, level + 1);
      const currentLevelEnergy = getMineEnergyConsumption(building.id, level);
      const extraEnergy = nextLevelEnergy - currentLevelEnergy;
      const nextProdText = getBuildingProductionAtLevel(building.id, level + 1, colony.buildings, state.research, colony.ships, colonyPct);
      if (building.id === 'ferMine' && nextProdText) nextProd.push({ label: 'Fer', value: `+${nextProdText} Fer`, positive: true });
      else if (building.id === 'siliceMine' && nextProdText) nextProd.push({ label: 'Silice', value: `+${nextProdText} Silice`, positive: true });
      else if (building.id === 'xenogasRefinery' && nextProdText) nextProd.push({ label: 'Xenogas', value: `+${nextProdText} Xenogas`, positive: true });
      if (extraEnergy > 0) nextProd.push({ label: 'Énergie', value: `-${formatNumber(extraEnergy)} ⚡`, positive: false });
      if (building.id === 'solarPlant') {
        const quantumFluxLevel = state.research?.quantumFlux ?? 0;
        const nextSolarProd = getSolarPlantProduction(level + 1, quantumFluxLevel);
        const currentSolarProd = getSolarPlantProduction(level, quantumFluxLevel);
        nextProd.push({ label: 'Énergie', value: `+${formatNumber(nextSolarProd - currentSolarProd)} ⚡`, positive: true });
      }
      if (['ferroStore', 'silicaStore', 'xenoStore'].includes(building.id)) {
        const nextCap = getStorageCapacity(level + 1);
        const currentCap = getStorageCapacity(level);
        nextProd.push({ label: 'Stockage', value: `+${formatNumber(nextCap - currentCap)} capacité`, positive: true });
      }

      let subtitleText = prodText ? `Produit ${prodText}` : undefined;
      if (energyCost > 0) {
        const consumeStr = `Consomme ${formatNumber(energyCost)} énergie`;
        subtitleText = subtitleText ? `${subtitleText} | ${consumeStr}` : consumeStr;
        if (energyRatio < 1) subtitleText += ` (⚠ ${Math.round(energyRatio * 100)}%)`;
      }

      const disabledReason = isCurrentlyUpgrading ? 'En cours...' : !prereqsMet ? `Requis: ${missingPrereqs[0]}` : 'Ressources insuffisantes';

      return (
        <GameCard
          key={building.id}
          icon={<IconComponent size={22} color={iconColor} />}
          iconColor={iconColor}
          title={building.name}
          level={level}
          subtitle={subtitleText}
          description={building.description}
          costs={costs}
          nextProduction={nextProd.length > 0 ? nextProd : undefined}
          actionLabel={level === 0 ? `Construire (${formatTime(upgradeDuration)})` : `Améliorer Nv.${level + 1} (${formatTime(upgradeDuration)})`}
          actionDisabled={!affordable || isCurrentlyUpgrading || !prereqsMet}
          disabledReason={disabledReason}
          timerStartTime={timer?.startTime}
          timerEndTime={timer?.endTime}
          timerTargetLevel={timer?.targetLevel}
          solarBalance={state.solar}
          onAction={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); upgradeBuilding(building.id); }}
          onRush={() => rushWithSolar(building.id, 'building')}
          onCancel={isCurrentlyUpgrading ? () => cancelUpgrade(building.id, 'building') : undefined}
        />
      );
    },
    [cancelUpgrade, colony, colonyId, rushWithSolar, state.research, state.solar, upgradeBuilding],
  );

  const renderResearch = useCallback(
    (research: typeof RESEARCH[0]) => {
      if (!colony || !colonyId) return null;
      const level = state.research[research.id] ?? 0;
      const cost = calculateCost(research.baseCost, research.costFactor, level);
      const affordable = canAfford(colony.resources, cost);
      const iconDef = RESEARCH_ICONS[research.id];
      const IconComponent = iconDef?.icon ?? Zap;
      const iconColor = iconDef?.color ?? Colors.primary;

      const timer = colony.activeTimers.find(t => t.id === research.id && t.type === 'research');
      const globalTimer = state.activeTimers.find(t => t.id === research.id && t.type === 'research');
      const otherColonyTimer = (state.colonies ?? []).some(c => c.id !== colonyId && c.activeTimers.some(t => t.id === research.id && t.type === 'research'));
      const isCurrentlyResearching = !!timer || !!globalTimer || otherColonyTimer;
      const activeTimer = timer || globalTimer;

      const { met: prereqsMet } = checkPrerequisites(research.prerequisites, colony.buildings, state.research);
      const missingPrereqs = getMissingPrereqLabels(research.prerequisites, colony.buildings, state.research);

      const colLabLevel = colony.buildings.researchLab ?? 0;
      const colNaniteLevel = colony.buildings.naniteFactory ?? 0;
      const neuralMeshLvl = state.research.neuralMesh ?? 0;
      const otherSources = (state.colonies ?? []).filter(c => c.id !== colonyId).map(c => ({ buildings: c.buildings }));
      const allSources = [{ buildings: state.buildings }, ...otherSources];
      const effectiveLab = getNeuralMeshLabBonus(neuralMeshLvl, colLabLevel, allSources);
      const upgradeDuration = calculateResearchTime(research.baseTime, research.timeFactor, level, effectiveLab, colNaniteLevel);

      const labLevel = colony.buildings.researchLab ?? 0;
      const hasLab = labLevel >= 1;

      const costs = [];
      if (cost.fer > 0) costs.push({ label: 'Fer', value: formatNumber(cost.fer), affordable: colony.resources.fer >= cost.fer });
      if (cost.silice > 0) costs.push({ label: 'Silice', value: formatNumber(cost.silice), affordable: colony.resources.silice >= cost.silice });
      if (cost.xenogas > 0) costs.push({ label: 'Xenogas', value: formatNumber(cost.xenogas), affordable: colony.resources.xenogas >= cost.xenogas });

      const disabledReason = isCurrentlyResearching
        ? (globalTimer || otherColonyTimer) ? 'Recherche en cours ailleurs' : 'En cours...'
        : !prereqsMet ? `Requis: ${missingPrereqs[0]}`
        : !hasLab ? 'Construire un Labo'
        : 'Ressources insuffisantes';

      return (
        <GameCard
          key={research.id}
          icon={<IconComponent size={22} color={iconColor} />}
          iconColor={iconColor}
          title={research.name}
          level={level}
          description={research.description}
          costs={costs}
          actionLabel={level === 0 ? `Rechercher (${formatTime(upgradeDuration)})` : `Améliorer Nv.${level + 1} (${formatTime(upgradeDuration)})`}
          actionDisabled={!hasLab || !affordable || isCurrentlyResearching || !prereqsMet}
          disabledReason={disabledReason}
          missingPrereqs={!prereqsMet ? missingPrereqs : undefined}
          timerStartTime={activeTimer?.startTime}
          timerEndTime={activeTimer?.endTime}
          timerTargetLevel={activeTimer?.targetLevel}
          solarBalance={state.solar}
          onAction={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); upgradeResearch(research.id); }}
          onRush={timer ? () => rushWithSolar(research.id, 'research') : undefined}
          onCancel={timer ? () => cancelUpgrade(research.id, 'research') : undefined}
        />
      );
    },
    [cancelUpgrade, colony, colonyId, rushWithSolar, state.activeTimers, state.buildings, state.colonies, state.research, state.solar, upgradeResearch],
  );

  const renderShip = useCallback(
    (ship: ShipDef) => {
      if (!colony || !colonyId) return null;
      const count = colony.ships[ship.id] ?? 0;
      const qty = getQuantity(ship.id);
      const unitCost: Resources = { fer: ship.cost.fer ?? 0, silice: ship.cost.silice ?? 0, xenogas: ship.cost.xenogas ?? 0, energy: 0 };
      const totalCost: Resources = { fer: unitCost.fer * qty, silice: unitCost.silice * qty, xenogas: unitCost.xenogas * qty, energy: 0 };
      const affordable = canAfford(colony.resources, totalCost);
      const maxBuildable = getMaxBuildableQuantity(ship.cost);
      const spriteUrl = SHIP_SPRITES[ship.id];
      const iconDef = SHIP_ICONS[ship.id];
      const IconComponent = iconDef?.icon ?? Rocket;
      const iconColor = iconDef?.color ?? Colors.primary;
      const queueItem = colony.shipyardQueue.find(q => q.id === ship.id && q.type === 'ship');
      const shipyardLevel = colony.buildings.shipyard ?? 0;
      const hasShipyard = shipyardLevel >= 1;

      const { met: prereqsMet } = checkPrerequisites(ship.prerequisites, colony.buildings, state.research);
      const missingPrereqs = getMissingPrereqLabels(ship.prerequisites, colony.buildings, state.research);

      const costs = [];
      if (totalCost.fer > 0) costs.push({ label: 'Fer', value: formatNumber(totalCost.fer), affordable: colony.resources.fer >= totalCost.fer });
      if (totalCost.silice > 0) costs.push({ label: 'Silice', value: formatNumber(totalCost.silice), affordable: colony.resources.silice >= totalCost.silice });
      if (totalCost.xenogas > 0) costs.push({ label: 'Xenogas', value: formatNumber(totalCost.xenogas), affordable: colony.resources.xenogas >= totalCost.xenogas });

      const boosted = getBoostedShipStats(ship.stats, state.research);
      const stats = [
        { label: 'ATK', value: formatNumber(boosted.attack) },
        { label: 'SHD', value: formatNumber(boosted.shield) },
        { label: 'HULL', value: formatNumber(boosted.hull) },
        { label: 'SPD', value: formatSpeed(boosted.speed) },
        { label: 'CARGO', value: formatNumber(boosted.cargo) },
      ];

      const buildTimePerUnit = Math.max(5, Math.floor(ship.buildTime / (1 + (shipyardLevel - 1) * 0.1)));

      return (
        <View key={ship.id}>
          <GameCard
            icon={spriteUrl ? <Image source={{ uri: spriteUrl }} style={styles.shipSprite} /> : <IconComponent size={22} color={iconColor} />}
            iconColor={iconColor}
            title={ship.name}
            count={count}
            subtitle={`Temps/unité: ${formatTime(buildTimePerUnit)}`}
            description={ship.description}
            stats={stats}
            costs={!queueItem ? costs : undefined}
            queueInfo={queueItem ? {
              remainingQuantity: queueItem.remainingQuantity,
              totalQuantity: queueItem.totalQuantity,
              currentUnitStartTime: queueItem.currentUnitStartTime,
              currentUnitEndTime: queueItem.currentUnitEndTime,
              buildTimePerUnit: queueItem.buildTimePerUnit,
            } : undefined}
            solarBalance={state.solar}
            actionLabel={`Construire x${qty}`}
            actionDisabled={!hasShipyard || !affordable || !prereqsMet}
            disabledReason={!prereqsMet ? `Requis: ${missingPrereqs[0]}` : !hasShipyard ? 'Construire un Chantier Spatial' : 'Ressources insuffisantes'}
            missingPrereqs={!prereqsMet ? missingPrereqs : undefined}
            onAction={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); buildShipQueue(ship.id, qty); setQuantities(prev => ({ ...prev, [ship.id]: 1 })); }}
            onRush={queueItem ? () => rushShipyardWithSolar(ship.id, 'ship') : undefined}
            onCancel={queueItem ? () => cancelShipyardQueue(ship.id, 'ship') : undefined}
            cancelRefundInfo={queueItem ? `Seules les ${queueItem.remainingQuantity} unité(s) restante(s) seront annulées. 80% des ressources remboursées.` : undefined}
          />
          {!queueItem && hasShipyard && prereqsMet && (
            <View style={styles.quantityRow}>
              <QuantitySelector quantity={qty} maxQuantity={maxBuildable} onChange={(q) => setQuantity(ship.id, q)} />
            </View>
          )}
        </View>
      );
    },
    [buildShipQueue, cancelShipyardQueue, colony, colonyId, getMaxBuildableQuantity, getQuantity, rushShipyardWithSolar, setQuantity, state.research, state.solar],
  );

  const renderDefense = useCallback(
    (defense: DefenseDef) => {
      if (!colony || !colonyId) return null;
      const count = colony.defenses[defense.id] ?? 0;
      const qty = getQuantity(defense.id);
      const unitCost: Resources = { fer: defense.cost.fer ?? 0, silice: defense.cost.silice ?? 0, xenogas: defense.cost.xenogas ?? 0, energy: 0 };
      const totalCost: Resources = { fer: unitCost.fer * qty, silice: unitCost.silice * qty, xenogas: unitCost.xenogas * qty, energy: 0 };
      const affordable = canAfford(colony.resources, totalCost);
      const maxBuildable = getMaxBuildableQuantity(defense.cost);
      const iconDef = DEFENSE_ICONS[defense.id];
      const IconComponent = iconDef?.icon ?? Shield;
      const iconColor = iconDef?.color ?? Colors.primary;
      const queueItem = colony.shipyardQueue.find(q => q.id === defense.id && q.type === 'defense');
      const shipyardLevel = colony.buildings.shipyard ?? 0;
      const hasShipyard = shipyardLevel >= 1;

      const { met: prereqsMet } = checkPrerequisites(defense.prerequisites, colony.buildings, state.research);
      const missingPrereqs = getMissingPrereqLabels(defense.prerequisites, colony.buildings, state.research);

      const costs = [];
      if (totalCost.fer > 0) costs.push({ label: 'Fer', value: formatNumber(totalCost.fer), affordable: colony.resources.fer >= totalCost.fer });
      if (totalCost.silice > 0) costs.push({ label: 'Silice', value: formatNumber(totalCost.silice), affordable: colony.resources.silice >= totalCost.silice });
      if (totalCost.xenogas > 0) costs.push({ label: 'Xenogas', value: formatNumber(totalCost.xenogas), affordable: colony.resources.xenogas >= totalCost.xenogas });

      const boostedDef = getBoostedDefenseStats(defense.stats, state.research);
      const stats = [
        { label: 'ATK', value: formatNumber(boostedDef.attack) },
        { label: 'SHD', value: formatNumber(boostedDef.shield) },
        { label: 'HULL', value: formatNumber(boostedDef.hull) },
      ];

      const buildTimePerUnit = Math.max(5, Math.floor(defense.buildTime / (1 + (shipyardLevel - 1) * 0.1)));

      return (
        <View key={defense.id}>
          <GameCard
            icon={<IconComponent size={22} color={iconColor} />}
            iconColor={iconColor}
            title={defense.name}
            count={count}
            subtitle={`Temps/unité: ${formatTime(buildTimePerUnit)}`}
            description={defense.description}
            stats={stats}
            costs={!queueItem ? costs : undefined}
            queueInfo={queueItem ? {
              remainingQuantity: queueItem.remainingQuantity,
              totalQuantity: queueItem.totalQuantity,
              currentUnitStartTime: queueItem.currentUnitStartTime,
              currentUnitEndTime: queueItem.currentUnitEndTime,
              buildTimePerUnit: queueItem.buildTimePerUnit,
            } : undefined}
            solarBalance={state.solar}
            actionLabel={`Construire x${qty}`}
            actionDisabled={!hasShipyard || !affordable || !prereqsMet}
            disabledReason={!prereqsMet ? `Requis: ${missingPrereqs[0]}` : !hasShipyard ? 'Construire un Chantier Spatial' : 'Ressources insuffisantes'}
            missingPrereqs={!prereqsMet ? missingPrereqs : undefined}
            onAction={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); buildDefenseQueue(defense.id, qty); setQuantities(prev => ({ ...prev, [defense.id]: 1 })); }}
            onRush={queueItem ? () => rushShipyardWithSolar(defense.id, 'defense') : undefined}
            onCancel={queueItem ? () => cancelShipyardQueue(defense.id, 'defense') : undefined}
            cancelRefundInfo={queueItem ? `Seules les ${queueItem.remainingQuantity} unité(s) restante(s) seront annulées. 80% des ressources remboursées.` : undefined}
          />
          {!queueItem && hasShipyard && prereqsMet && (
            <View style={styles.quantityRow}>
              <QuantitySelector quantity={qty} maxQuantity={maxBuildable} onChange={(q) => setQuantity(defense.id, q)} />
            </View>
          )}
        </View>
      );
    },
    [buildDefenseQueue, cancelShipyardQueue, colony, colonyId, getMaxBuildableQuantity, getQuantity, rushShipyardWithSolar, setQuantity, state.research, state.solar],
  );

  const resourceBuildings = useMemo(() => BUILDINGS.filter(b => b.category === 'resources'), []);
  const facilityBuildings = useMemo(() => BUILDINGS.filter(b => b.category === 'facilities'), []);
  const combatShips = useMemo(() => SHIPS.filter(s => COMBAT_SHIP_IDS.includes(s.id)), []);
  const utilityShips = useMemo(() => SHIPS.filter(s => UTILITY_SHIP_IDS.includes(s.id)), []);

  if (!colony) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <ArrowLeft size={20} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Colonie introuvable</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Cette colonie n{"'"}existe plus.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const labLevel = colony.buildings.researchLab ?? 0;
  const hasLab = labLevel >= 1;
  const shipyardLevel = colony.buildings.shipyard ?? 0;
  const hasShipyard = shipyardLevel >= 1;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <TouchableOpacity onPress={openRenameModal} style={styles.nameRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{colony.planetName}</Text>
              <Pencil size={12} color={Colors.textMuted} />
            </TouchableOpacity>
            <Text style={styles.headerCoords}>[{colony.coordinates[0]}:{colony.coordinates[1]}:{colony.coordinates[2]}]</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ColonyResourceBar colonyId={colonyId ?? ''} />

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'buildings' && styles.tabButtonActive]}
            onPress={() => setActiveTab('buildings')}
            activeOpacity={0.7}
          >
            <Hammer size={14} color={activeTab === 'buildings' ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabLabel, activeTab === 'buildings' && styles.tabLabelActive]}>Bâtiments</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'research' && styles.tabButtonActive]}
            onPress={() => setActiveTab('research')}
            activeOpacity={0.7}
          >
            <FlaskConical size={14} color={activeTab === 'research' ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabLabel, activeTab === 'research' && styles.tabLabelActive]}>Recherche</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'shipyard' && styles.tabButtonActive]}
            onPress={() => setActiveTab('shipyard')}
            activeOpacity={0.7}
          >
            <Rocket size={14} color={activeTab === 'shipyard' ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabLabel, activeTab === 'shipyard' && styles.tabLabelActive]}>Chantier</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === 'buildings' && (
            <>
              <CollapsibleSection title="Ressources">
                {resourceBuildings.map(renderBuilding)}
              </CollapsibleSection>
              <CollapsibleSection title="Installations">
                {facilityBuildings.map(renderBuilding)}
              </CollapsibleSection>
            </>
          )}

          {activeTab === 'research' && (
            <>
              {!hasLab && (
                <View style={styles.warningCard}>
                  <Text style={styles.warningText}>
                    Construisez un Laboratoire de Recherche (Nv. 1) sur cette colonie pour débloquer la recherche.
                  </Text>
                </View>
              )}
              <CollapsibleSection title="Énergie & Production">
                {RESEARCH.filter(r => ENERGY_RESEARCH_IDS.includes(r.id)).map(renderResearch)}
              </CollapsibleSection>
              <CollapsibleSection title="Armement & Défense">
                {RESEARCH.filter(r => COMBAT_RESEARCH_IDS.includes(r.id)).map(renderResearch)}
              </CollapsibleSection>
              <CollapsibleSection title="Propulsion">
                {RESEARCH.filter(r => PROPULSION_RESEARCH_IDS.includes(r.id)).map(renderResearch)}
              </CollapsibleSection>
              <CollapsibleSection title="Intelligence & Exploration">
                {RESEARCH.filter(r => ADVANCED_RESEARCH_IDS.includes(r.id)).map(renderResearch)}
              </CollapsibleSection>
            </>
          )}

          {activeTab === 'shipyard' && (
            <>
              {!hasShipyard && (
                <View style={styles.warningCard}>
                  <Text style={styles.warningText}>
                    Construisez un Chantier Spatial (Nv. 1) sur cette colonie pour débloquer cette section.
                  </Text>
                </View>
              )}

              <View style={styles.subTabRow}>
                <TouchableOpacity
                  style={[styles.subTabButton, shipyardSubTab === 'ships' && styles.subTabButtonActive]}
                  onPress={() => setShipyardSubTab('ships')}
                  activeOpacity={0.7}
                >
                  <Rocket size={14} color={shipyardSubTab === 'ships' ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.subTabLabel, shipyardSubTab === 'ships' && styles.subTabLabelActive]}>Vaisseaux</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.subTabButton, shipyardSubTab === 'defenses' && styles.subTabButtonActive]}
                  onPress={() => setShipyardSubTab('defenses')}
                  activeOpacity={0.7}
                >
                  <Shield size={14} color={shipyardSubTab === 'defenses' ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.subTabLabel, shipyardSubTab === 'defenses' && styles.subTabLabelActive]}>Défenses</Text>
                </TouchableOpacity>
              </View>

              {shipyardSubTab === 'ships' && (
                <>
                  <CollapsibleSection title="Vaisseaux de Combat">
                    {combatShips.map(renderShip)}
                  </CollapsibleSection>
                  <CollapsibleSection title="Vaisseaux Utilitaires">
                    {utilityShips.map(renderShip)}
                  </CollapsibleSection>
                </>
              )}

              {shipyardSubTab === 'defenses' && (
                <>
                  <CollapsibleSection title="Tourelles & Canons">
                    {DEFENSES.filter(d => !['smallShield', 'largeShield'].includes(d.id)).map(renderDefense)}
                  </CollapsibleSection>
                  <CollapsibleSection title="Boucliers Planétaires">
                    {DEFENSES.filter(d => ['smallShield', 'largeShield'].includes(d.id)).map(renderDefense)}
                  </CollapsibleSection>
                </>
              )}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <Pressable style={styles.modalOverlay} onPress={() => setRenameVisible(false)}>
              <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Renommer la colonie</Text>
                  <Pressable onPress={() => setRenameVisible(false)} hitSlop={8}>
                    <X size={20} color={Colors.textMuted} />
                  </Pressable>
                </View>
                <TextInput
                  style={styles.modalInput}
                  value={newName}
                  onChangeText={setNewName}
                  maxLength={24}
                  autoFocus
                  placeholderTextColor={Colors.textMuted}
                  placeholder="Nom de la colonie"
                  selectionColor={Colors.primary}
                />
                <Text style={styles.charCount}>{newName.length}/24</Text>
                <Pressable
                  style={[styles.confirmBtn, !newName.trim() && { opacity: 0.4 }]}
                  onPress={handleRename}
                  disabled={!newName.trim()}
                >
                  <Check size={16} color="#fff" />
                  <Text style={styles.confirmBtnText}>Confirmer</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.card, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: Colors.border },
  headerCenter: { flex: 1, alignItems: 'center' as const },
  nameRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  headerCoords: { color: Colors.xenogas, fontSize: 11, fontWeight: '500' as const, letterSpacing: 1, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  emptyState: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingTop: 80 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  tabRow: {
    flexDirection: 'row' as const,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 5,
  },
  tabButtonActive: {
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  tabLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  tabLabelActive: {
    color: Colors.primary,
  },
  subTabRow: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  subTabButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 5,
  },
  subTabButtonActive: {
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  subTabLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  subTabLabelActive: {
    color: Colors.primary,
  },
  warningCard: {
    backgroundColor: Colors.warning + '12',
    borderWidth: 1,
    borderColor: Colors.warning + '30',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  warningText: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
  },
  quantityRow: {
    marginTop: -6,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  shipSprite: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center' as const, alignItems: 'center' as const },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 16, padding: 20, width: '85%' as unknown as number, maxWidth: 340, borderWidth: 1, borderColor: Colors.border },
  modalHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  modalInput: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, color: Colors.text, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  charCount: { color: Colors.textMuted, fontSize: 11, textAlign: 'right' as const, marginTop: 6 },
  confirmBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  confirmBtnText: { color: '#0A0A14', fontSize: 14, fontWeight: '700' as const },
});
