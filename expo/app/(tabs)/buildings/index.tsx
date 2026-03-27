import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Pickaxe, Gem, Droplets, Sun, Bot, Wrench, FlaskConical, Atom, Warehouse, Database, Container, Cog } from 'lucide-react-native';
import CollapsibleSection from '@/components/CollapsibleSection';
import { useGame } from '@/contexts/GameContext';
import { calculateCost, canAfford, formatNumber, getBuildingProductionAtLevel, calculateUpgradeTime, formatTime, checkPrerequisites, getMineEnergyConsumption, getEnergyRatio, getSolarPlantProduction, getStorageCapacity } from '@/utils/gameCalculations';
import { getMissingPrereqLabels } from '@/utils/prereqLabels';
import { BUILDINGS } from '@/constants/gameData';
import ResourceBar from '@/components/ResourceBar';
import GameCard from '@/components/GameCard';
import InfoDetailModal from '@/components/InfoDetailModal';
import PrereqTree from '@/components/PrereqTree';
import SolarConfirmModal from '@/components/SolarConfirmModal';
import Colors from '@/constants/colors';
import { calculateSolarCost } from '@/utils/gameCalculations';

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

export default function BuildingsScreen() {
  const { state, activePlanet, activeUpgradeBuilding, activeRushWithSolar, activeCancelUpgrade, getSolarCooldownEnd, activeProductionPercentages } = useGame();
  const { scrollTo, _t } = useLocalSearchParams<{ scrollTo?: string; _t?: string }>();
  const [infoModal, setInfoModal] = useState<{ id: string; level: number } | null>(null);
  const [prereqModal, setPrereqModal] = useState<string | null>(null);
  const [solarConfirm, setSolarConfirm] = useState<{ id: string; cost: number; name: string } | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const itemLayouts = useRef<Record<string, number>>({});
  const sectionLayouts = useRef<Record<string, number>>({});
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const resourceBuildings = useMemo(
    () => BUILDINGS.filter(b => b.category === 'resources'),
    [],
  );

  const facilityBuildings = useMemo(
    () => BUILDINGS.filter(b => b.category === 'facilities'),
    [],
  );

  useEffect(() => {
    if (scrollTo) {
      setScrollTarget(scrollTo);
    }
  }, [scrollTo, _t]);

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      const itemY = itemLayouts.current[scrollTarget];
      if (itemY === undefined || !scrollViewRef.current) {
        setScrollTarget(null);
        return;
      }
      const isResource = resourceBuildings.some(b => b.id === scrollTarget);
      const sectionId = isResource ? 'resources' : 'facilities';
      const sectionY = sectionLayouts.current[sectionId] ?? 0;
      const SECTION_HEADER_HEIGHT = 42;
      const totalY = sectionY + SECTION_HEADER_HEIGHT + itemY;
      scrollViewRef.current.scrollTo({ y: Math.max(0, totalY - 10), animated: true });
      setScrollTarget(null);
    }, 400);
    return () => clearTimeout(timer);
  }, [scrollTarget, resourceBuildings]);

  const handleItemLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    itemLayouts.current[id] = e.nativeEvent.layout.y;
  }, []);

  const handleSectionLayout = useCallback((sectionId: string, e: LayoutChangeEvent) => {
    sectionLayouts.current[sectionId] = e.nativeEvent.layout.y;
  }, []);

  const shouldForceOpen = useCallback((buildingIds: string[]) => {
    return !!scrollTarget && buildingIds.some(id => id === scrollTarget);
  }, [scrollTarget]);

  const handleRush = useCallback((buildingId: string) => {
    const timer = activePlanet.activeTimers.find(t => t.id === buildingId && t.type === 'building');
    if (!timer) return;
    const remainingSeconds = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
    const cost = calculateSolarCost(remainingSeconds);
    const building = BUILDINGS.find(b => b.id === buildingId);
    setSolarConfirm({ id: buildingId, cost, name: building?.name ?? buildingId });
  }, [activePlanet.activeTimers]);

  const handleSolarConfirm = useCallback(() => {
    if (solarConfirm) {
      activeRushWithSolar(solarConfirm.id, 'building');
      setSolarConfirm(null);
    }
  }, [solarConfirm, activeRushWithSolar]);

  const renderBuilding = useCallback(
    (building: typeof BUILDINGS[0]) => {
      const level = activePlanet.buildings[building.id] ?? 0;
      const cost = calculateCost(building.baseCost, building.costFactor, level);
      const affordable = canAfford(activePlanet.resources, cost);
      const iconDef = BUILDING_ICONS[building.id];
      const IconComponent = iconDef?.icon ?? Bot;
      const iconColor = iconDef?.color ?? Colors.primary;
      const prodText = getBuildingProductionAtLevel(building.id, level, activePlanet.buildings, state.research, activePlanet.ships, activeProductionPercentages);
      const energyCost = getMineEnergyConsumption(building.id, level);
      const energyRatio = getEnergyRatio(activePlanet.buildings, state.research, activePlanet.ships, activeProductionPercentages);

      const timer = activePlanet.activeTimers.find(t => t.id === building.id && t.type === 'building');
      const isCurrentlyUpgrading = !!timer;

      const { met: prereqsMet } = checkPrerequisites(building.prerequisites, activePlanet.buildings, state.research);
      const missingPrereqs = getMissingPrereqLabels(building.prerequisites, activePlanet.buildings, state.research);

      const roboticsLevel = activePlanet.buildings.roboticsFactory ?? 0;
      const naniteLevel = activePlanet.buildings.naniteFactory ?? 0;
      const upgradeDuration = calculateUpgradeTime(building.baseTime, building.timeFactor, level, roboticsLevel, naniteLevel);

      const costs = [];
      if (cost.fer > 0) costs.push({ label: 'Fer', value: formatNumber(cost.fer), affordable: activePlanet.resources.fer >= cost.fer });
      if (cost.silice > 0) costs.push({ label: 'Silice', value: formatNumber(cost.silice), affordable: activePlanet.resources.silice >= cost.silice });
      if (cost.xenogas > 0) costs.push({ label: 'Xenogas', value: formatNumber(cost.xenogas), affordable: activePlanet.resources.xenogas >= cost.xenogas });

      const nextProd: { label: string; value: string; positive: boolean }[] = [];

      const nextLevelEnergy = getMineEnergyConsumption(building.id, level + 1);
      const currentLevelEnergy = getMineEnergyConsumption(building.id, level);
      const extraEnergy = nextLevelEnergy - currentLevelEnergy;

      const nextProdText = getBuildingProductionAtLevel(building.id, level + 1, activePlanet.buildings, state.research, activePlanet.ships, activeProductionPercentages);
      if (building.id === 'ferMine' && nextProdText) {
        nextProd.push({ label: 'Fer', value: `+${nextProdText} Fer`, positive: true });
      } else if (building.id === 'siliceMine' && nextProdText) {
        nextProd.push({ label: 'Silice', value: `+${nextProdText} Silice`, positive: true });
      } else if (building.id === 'xenogasRefinery' && nextProdText) {
        nextProd.push({ label: 'Xenogas', value: `+${nextProdText} Xenogas`, positive: true });
      }

      if (extraEnergy > 0) {
        nextProd.push({ label: 'Énergie', value: `-${formatNumber(extraEnergy)} ⚡`, positive: false });
      }

      if (building.id === 'solarPlant') {
        const quantumFluxLevel = state.research?.quantumFlux ?? 0;
        const nextSolarProd = getSolarPlantProduction(level + 1, quantumFluxLevel);
        const currentSolarProd = getSolarPlantProduction(level, quantumFluxLevel);
        const extraSolarProd = nextSolarProd - currentSolarProd;
        nextProd.push({ label: 'Énergie', value: `+${formatNumber(extraSolarProd)} ⚡`, positive: true });
      }

      if (['ferroStore', 'silicaStore', 'xenoStore'].includes(building.id)) {
        const currentCap = getStorageCapacity(level);
        const nextCap = getStorageCapacity(level + 1);
        const extraCap = nextCap - currentCap;
        nextProd.push({ label: 'Stockage', value: `+${formatNumber(extraCap)} capacité`, positive: true });
      }

      if (building.id === 'naniteFactory') {
        const nextBonus = Math.pow(2, level + 1);
        nextProd.push({ label: 'Temps', value: `÷${nextBonus} temps construction`, positive: true });
      }
      if (building.id === 'shipyard') {
        nextProd.push({ label: 'Vitesse', value: `-${level * 10}% temps unités`, positive: true });
      }
      if (building.id === 'researchLab') {
        const nextReduction = Math.round((1 - 1 / (1 + (level + 1) * 0.1)) * 100);
        nextProd.push({ label: 'Recherche', value: `-${nextReduction}% temps recherche`, positive: true });
      }

      let subtitleText = prodText ? `Produit ${prodText}` : undefined;
      if (energyCost > 0) {
        const consumeStr = `Consomme ${formatNumber(energyCost)} énergie`;
        subtitleText = subtitleText ? `${subtitleText} | ${consumeStr}` : consumeStr;
        if (energyRatio < 1) {
          subtitleText += ` (⚠ ${Math.round(energyRatio * 100)}%)`;
        }
      }
      if (building.id === 'naniteFactory' && level > 0) {
        const bonus = `÷${Math.pow(2, level)} temps`;
        subtitleText = subtitleText ? `${subtitleText} | ${bonus}` : bonus;
      }
      if (building.id === 'shipyard' && level > 0) {
        const bonus = `-${(level - 1) * 10}% temps unités`;
        subtitleText = subtitleText ? `${subtitleText} | ${bonus}` : bonus;
      }
      if (building.id === 'researchLab' && level > 0) {
        const reductionPct = Math.round((1 - 1 / (1 + level * 0.1)) * 100);
        const bonus = `-${reductionPct}% temps recherche`;
        subtitleText = subtitleText ? `${subtitleText} | ${bonus}` : bonus;
      }
      if (building.id === 'roboticsFactory' && level > 0) {
        const bonus = `-${level * 10}% temps bâtiments`;
        subtitleText = subtitleText ? `${subtitleText} | ${bonus}` : bonus;
      }

      const disabledReason = isCurrentlyUpgrading
        ? 'En cours...'
        : !prereqsMet
          ? `Requis: ${missingPrereqs[0]}`
          : 'Ressources insuffisantes';

      return (
        <GameCard
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
          missingPrereqs={!prereqsMet ? missingPrereqs : undefined}
          onAction={() => activeUpgradeBuilding(building.id)}
          onRush={isCurrentlyUpgrading ? () => handleRush(building.id) : undefined}
          rushCooldownEnd={isCurrentlyUpgrading ? getSolarCooldownEnd(building.id, 'building') : undefined}
          onCancel={isCurrentlyUpgrading ? () => activeCancelUpgrade(building.id, 'building') : undefined}
          onInfo={() => setInfoModal({ id: building.id, level })}
          onPrereqTree={!prereqsMet ? () => setPrereqModal(building.id) : undefined}
        />
      );
    },
    [activePlanet, state.research, state.solar, activeUpgradeBuilding, handleRush, activeCancelUpgrade, getSolarCooldownEnd, activeProductionPercentages],
  );

  return (
    <View style={styles.container}>
      <ResourceBar />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View onLayout={(e) => handleSectionLayout('resources', e)}>
          <CollapsibleSection title="Ressources" forceOpen={shouldForceOpen(resourceBuildings.map(b => b.id))}>
            {resourceBuildings.map(b => (
              <View key={b.id} onLayout={(e) => handleItemLayout(b.id, e)}>
                {renderBuilding(b)}
              </View>
            ))}
          </CollapsibleSection>
        </View>

        <View onLayout={(e) => handleSectionLayout('facilities', e)}>
          <CollapsibleSection title="Installations" forceOpen={shouldForceOpen(facilityBuildings.map(b => b.id))}>
            {facilityBuildings.map(b => (
              <View key={b.id} onLayout={(e) => handleItemLayout(b.id, e)}>
                {renderBuilding(b)}
              </View>
            ))}
          </CollapsibleSection>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {infoModal && (
        <InfoDetailModal
          visible={!!infoModal}
          onClose={() => setInfoModal(null)}
          itemId={infoModal.id}
          itemType="building"
          currentLevel={infoModal.level}
          buildings={activePlanet.buildings}
          research={state.research}
          ships={activePlanet.ships}
          colonies={state.colonies}
        />
      )}

      {prereqModal && (
        <PrereqTree
          visible={!!prereqModal}
          onClose={() => setPrereqModal(null)}
          itemId={prereqModal}
          itemType="building"
          buildings={activePlanet.buildings}
          research={state.research}
        />
      )}

      {solarConfirm && (
        <SolarConfirmModal
          visible={!!solarConfirm}
          solarCost={solarConfirm.cost}
          solarBalance={state.solar}
          actionDescription={`terminer ${solarConfirm.name}`}
          onConfirm={handleSolarConfirm}
          onCancel={() => setSolarConfirm(null)}
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
