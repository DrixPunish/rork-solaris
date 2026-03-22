import { Resources, Prerequisite, ProductionPercentages, DEFAULT_PRODUCTION_PERCENTAGES } from '@/types/game';

export function getStorageCapacity(storageLevel: number): number {
  return Math.max(10000, 5000 * Math.floor(2.5 * Math.exp(20 * storageLevel / 33)));
}

export function getResourceStorageCapacity(
  buildings: Record<string, number>,
): { fer: number; silice: number; xenogas: number } {
  const ferroStoreLevel = buildings.ferroStore ?? 0;
  const silicaStoreLevel = buildings.silicaStore ?? 0;
  const xenoStoreLevel = buildings.xenoStore ?? 0;
  return {
    fer: getStorageCapacity(ferroStoreLevel),
    silice: getStorageCapacity(silicaStoreLevel),
    xenogas: getStorageCapacity(xenoStoreLevel),
  };
}

export function getStorageFillPercent(
  resources: Resources,
  buildings: Record<string, number>,
): { fer: number; silice: number; xenogas: number } {
  const cap = getResourceStorageCapacity(buildings);
  return {
    fer: cap.fer > 0 ? resources.fer / cap.fer : 0,
    silice: cap.silice > 0 ? resources.silice / cap.silice : 0,
    xenogas: cap.xenogas > 0 ? resources.xenogas / cap.xenogas : 0,
  };
}

export function getPlasmaProductionBonus(plasmaLevel: number): { fer: number; silice: number; xenogas: number } {
  return {
    fer: plasmaLevel * 0.01,
    silice: plasmaLevel * 0.0066,
    xenogas: plasmaLevel * 0.0033,
  };
}

export function getEnergyTechBonus(quantumFluxLevel: number): number {
  return quantumFluxLevel * 0.05;
}

export function getCombatBoosts(research: Record<string, number>): { attack: number; shield: number; hull: number } {
  const weaponsLevel = research.weaponsTech ?? 0;
  const shieldLevel = research.shieldTech ?? 0;
  const armorLevel = research.armorTech ?? 0;
  return {
    attack: 1 + weaponsLevel * 0.10,
    shield: 1 + shieldLevel * 0.10,
    hull: 1 + armorLevel * 0.10,
  };
}

export function getCargoBoost(subspacialNodesLevel: number): number {
  return 1 + subspacialNodesLevel * 0.05;
}

export function getBoostedShipStats(
  baseStats: { attack: number; shield: number; hull: number; speed: number; cargo: number },
  research: Record<string, number>,
): { attack: number; shield: number; hull: number; speed: number; cargo: number } {
  const combat = getCombatBoosts(research);
  const cargoMult = getCargoBoost(research.subspacialNodes ?? 0);
  return {
    attack: Math.floor(baseStats.attack * combat.attack),
    shield: Math.floor(baseStats.shield * combat.shield),
    hull: Math.floor(baseStats.hull * combat.hull),
    speed: baseStats.speed,
    cargo: Math.floor(baseStats.cargo * cargoMult),
  };
}

export function getBoostedDefenseStats(
  baseStats: { attack: number; shield: number; hull: number },
  research: Record<string, number>,
): { attack: number; shield: number; hull: number } {
  const combat = getCombatBoosts(research);
  return {
    attack: Math.floor(baseStats.attack * combat.attack),
    shield: Math.floor(baseStats.shield * combat.shield),
    hull: Math.floor(baseStats.hull * combat.hull),
  };
}

export function calculateCost(baseCost: Partial<Resources>, costFactor: number, currentLevel: number): Resources {
  return {
    fer: Math.floor((baseCost.fer ?? 0) * Math.pow(costFactor, currentLevel)),
    silice: Math.floor((baseCost.silice ?? 0) * Math.pow(costFactor, currentLevel)),
    xenogas: Math.floor((baseCost.xenogas ?? 0) * Math.pow(costFactor, currentLevel)),
    energy: 0,
  };
}

export function calculateUpgradeTime(baseTime: number, timeFactor: number, currentLevel: number, roboticsLevel: number, naniteLevel?: number): number {
  const raw = Math.floor(baseTime * Math.pow(timeFactor, currentLevel));
  const roboticsReduction = 1 / (1 + roboticsLevel * 0.1);
  const naniteReduction = (naniteLevel && naniteLevel > 0) ? 1 / Math.pow(2, naniteLevel) : 1;
  return Math.max(5, Math.floor(raw * roboticsReduction * naniteReduction));
}

export function calculateResearchTime(baseTime: number, timeFactor: number, currentLevel: number, labLevel: number, naniteLevel?: number): number {
  const raw = Math.floor(baseTime * Math.pow(timeFactor, currentLevel));
  const labReduction = 1 / (1 + labLevel * 0.1);
  const naniteReduction = (naniteLevel && naniteLevel > 0) ? 1 / Math.pow(2, naniteLevel) : 1;
  return Math.max(5, Math.floor(raw * labReduction * naniteReduction));
}

export function getNeuralMeshLabBonus(
  neuralMeshLevel: number,
  mainLabLevel: number,
  colonies?: { buildings: Record<string, number> }[],
): number {
  if (neuralMeshLevel <= 0 || !colonies || colonies.length === 0) return mainLabLevel;
  const colonyLabLevels = colonies
    .map(c => c.buildings.researchLab ?? 0)
    .filter(l => l > 0)
    .sort((a, b) => b - a);
  let totalLab = mainLabLevel;
  for (let i = 0; i < Math.min(neuralMeshLevel, colonyLabLevels.length); i++) {
    totalLab += colonyLabLevels[i];
  }
  return totalLab;
}

export function getShipyardSpeedBonus(shipyardLevel: number): number {
  if (shipyardLevel <= 1) return 0;
  return (shipyardLevel - 1) * 10;
}

export function calculateShipBuildTime(baseBuildTime: number, shipyardLevel: number, naniteLevel?: number): number {
  const shipyardReduction = 1 / (1 + (shipyardLevel - 1) * 0.1);
  const naniteReduction = (naniteLevel && naniteLevel > 0) ? 1 / Math.pow(2, naniteLevel) : 1;
  return Math.max(5, Math.floor(baseBuildTime * shipyardReduction * naniteReduction));
}

export function calculateEnergyConsumption(buildings: Record<string, number>, percentages?: ProductionPercentages): number {
  const pct = percentages ?? DEFAULT_PRODUCTION_PERCENTAGES;
  const ferLevel = buildings.ferMine ?? 0;
  const siliceLevel = buildings.siliceMine ?? 0;
  const xenogasLevel = buildings.xenogasRefinery ?? 0;

  const ferConsumption = ferLevel > 0 ? Math.floor(10 * ferLevel * Math.pow(1.1, ferLevel) * (pct.ferMine / 100)) : 0;
  const siliceConsumption = siliceLevel > 0 ? Math.floor(10 * siliceLevel * Math.pow(1.1, siliceLevel) * (pct.siliceMine / 100)) : 0;
  const xenogasConsumption = xenogasLevel > 0 ? Math.floor(20 * xenogasLevel * Math.pow(1.1, xenogasLevel) * (pct.xenogasRefinery / 100)) : 0;

  return ferConsumption + siliceConsumption + xenogasConsumption;
}

export const HELIOS_ENERGY_PER_UNIT = 30;

export function calculateEnergyProduced(buildings: Record<string, number>, research?: Record<string, number>, ships?: Record<string, number>, percentages?: ProductionPercentages): number {
  const pct = percentages ?? DEFAULT_PRODUCTION_PERCENTAGES;
  const solarLevel = buildings.solarPlant ?? 0;
  const quantumFluxLevel = research?.quantumFlux ?? 0;
  const techBonus = 1 + getEnergyTechBonus(quantumFluxLevel);
  const solarPlantEnergy = Math.floor(20 * solarLevel * Math.pow(1.1, solarLevel) * techBonus * (pct.solarPlant / 100));
  const heliosCount = ships?.heliosRemorqueur ?? 0;
  const heliosEnergy = Math.floor(heliosCount * HELIOS_ENERGY_PER_UNIT * (pct.heliosRemorqueur / 100));
  return solarPlantEnergy + heliosEnergy;
}

export function getEnergyRatio(buildings: Record<string, number>, research?: Record<string, number>, ships?: Record<string, number>, percentages?: ProductionPercentages): number {
  const consumed = calculateEnergyConsumption(buildings, percentages);
  if (consumed === 0) return 1;
  const produced = calculateEnergyProduced(buildings, research, ships, percentages);
  return Math.min(1, produced / consumed);
}

export function getSolarPlantProduction(level: number, quantumFluxLevel?: number): number {
  if (level <= 0) return 0;
  const techBonus = 1 + getEnergyTechBonus(quantumFluxLevel ?? 0);
  return Math.floor(20 * level * Math.pow(1.1, level) * techBonus);
}

export function getMineEnergyConsumption(buildingId: string, level: number): number {
  if (level <= 0) return 0;
  switch (buildingId) {
    case 'ferMine':
      return Math.floor(10 * level * Math.pow(1.1, level));
    case 'siliceMine':
      return Math.floor(10 * level * Math.pow(1.1, level));
    case 'xenogasRefinery':
      return Math.floor(20 * level * Math.pow(1.1, level));
    default:
      return 0;
  }
}

export function calculateProduction(buildings: Record<string, number>, research?: Record<string, number>, ships?: Record<string, number>, percentages?: ProductionPercentages): Resources {
  const pct = percentages ?? DEFAULT_PRODUCTION_PERCENTAGES;
  const ferLevel = buildings.ferMine ?? 0;
  const siliceLevel = buildings.siliceMine ?? 0;
  const xenogasLevel = buildings.xenogasRefinery ?? 0;

  const energyProduced = calculateEnergyProduced(buildings, research, ships, pct);
  const energyConsumed = calculateEnergyConsumption(buildings, pct);
  const ratio = energyConsumed > 0 ? Math.min(1, energyProduced / energyConsumed) : 1;

  const plasmaLevel = research?.plasmaOverdrive ?? 0;
  const plasmaBonus = getPlasmaProductionBonus(plasmaLevel);

  return {
    fer: 10 + Math.floor(30 * ferLevel * Math.pow(1.1, ferLevel) * ratio * (pct.ferMine / 100) * (1 + plasmaBonus.fer)),
    silice: 5 + Math.floor(20 * siliceLevel * Math.pow(1.1, siliceLevel) * ratio * (pct.siliceMine / 100) * (1 + plasmaBonus.silice)),
    xenogas: Math.floor(10 * xenogasLevel * Math.pow(1.1, xenogasLevel) * ratio * (pct.xenogasRefinery / 100) * (1 + plasmaBonus.xenogas)),
    energy: energyProduced - energyConsumed,
  };
}

export function getBuildingProductionAtLevel(buildingId: string, level: number, buildings?: Record<string, number>, research?: Record<string, number>, ships?: Record<string, number>, percentages?: ProductionPercentages): string {
  if (level === 0) return '';
  const ratio = buildings ? getEnergyRatio(buildings, research, ships, percentages) : 1;
  const plasmaLevel = research?.plasmaOverdrive ?? 0;
  const plasmaBonus = getPlasmaProductionBonus(plasmaLevel);
  const quantumFluxLevel = research?.quantumFlux ?? 0;
  switch (buildingId) {
    case 'ferMine':
      return `${10 + Math.floor(30 * level * Math.pow(1.1, level) * ratio * (1 + plasmaBonus.fer))}/h`;
    case 'siliceMine':
      return `${5 + Math.floor(20 * level * Math.pow(1.1, level) * ratio * (1 + plasmaBonus.silice))}/h`;
    case 'xenogasRefinery':
      return `${Math.floor(10 * level * Math.pow(1.1, level) * ratio * (1 + plasmaBonus.xenogas))}/h`;
    case 'solarPlant':
      return `+${getSolarPlantProduction(level, quantumFluxLevel)} énergie`;
    case 'ferroStore':
      return `Capacité: ${formatNumber(getStorageCapacity(level))}`;
    case 'silicaStore':
      return `Capacité: ${formatNumber(getStorageCapacity(level))}`;
    case 'xenoStore':
      return `Capacité: ${formatNumber(getStorageCapacity(level))}`;
    default:
      return '';
  }
}

export function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.fer >= cost.fer &&
    resources.silice >= cost.silice &&
    resources.xenogas >= cost.xenogas
  );
}

export function checkPrerequisites(
  prerequisites: Prerequisite[] | undefined,
  buildings: Record<string, number>,
  research: Record<string, number>,
): { met: boolean; missing: string[] } {
  if (!prerequisites || prerequisites.length === 0) return { met: true, missing: [] };
  const missing: string[] = [];
  for (const prereq of prerequisites) {
    const currentLevel = prereq.type === 'building'
      ? (buildings[prereq.id] ?? 0)
      : (research[prereq.id] ?? 0);
    if (currentLevel < prereq.level) {
      missing.push(`${prereq.id} Nv.${prereq.level}`);
    }
  }
  return { met: missing.length === 0, missing };
}

export function formatNumber(n: number): string {
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  const floored = Math.floor(n);
  return floored.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatSpeed(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toString();
}

export function calculateSolarCost(remainingSeconds: number): number {
  if (remainingSeconds <= 0) return 0;
  return Math.max(1, Math.ceil(remainingSeconds / 30));
}

export function formatTime(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
