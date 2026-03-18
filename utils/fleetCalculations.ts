import { SHIPS, DEFENSES } from '@/constants/gameData';
import { CombatUnit } from '@/types/fleet';
import { getCargoBoost, getBoostedShipStats, getBoostedDefenseStats } from '@/utils/gameCalculations';

const BASE_SHIP_DRIVE_TYPE: Record<string, 'chemical' | 'impulse' | 'void'> = {
  novaScout: 'chemical',
  ferDeLance: 'impulse',
  cyclone: 'impulse',
  bastion: 'void',
  pyro: 'impulse',
  nemesis: 'void',
  fulgurant: 'void',
  titanAstral: 'void',
  atlasCargo: 'chemical',
  atlasCargoXL: 'chemical',
  colonyShip: 'impulse',
  mantaRecup: 'chemical',
  spectreSonde: 'chemical',
  heliosRemorqueur: 'chemical',
};

export function getShipDriveType(shipId: string, research: Record<string, number>): 'chemical' | 'impulse' | 'void' {
  const impulseLevel = research.impulseReactor ?? 0;
  const voidLevel = research.voidDrive ?? 0;

  switch (shipId) {
    case 'mantaRecup':
      if (voidLevel >= 15) return 'void';
      if (impulseLevel >= 17) return 'impulse';
      return 'chemical';
    case 'pyro':
      if (voidLevel >= 8) return 'void';
      return 'impulse';
    case 'atlasCargo':
      if (impulseLevel >= 5) return 'impulse';
      return 'chemical';
    default:
      return BASE_SHIP_DRIVE_TYPE[shipId] ?? 'chemical';
  }
}

export const CHEMICAL_DRIVE_SHIPS = ['novaScout', 'atlasCargo', 'atlasCargoXL', 'mantaRecup', 'spectreSonde'];
export const IMPULSE_DRIVE_SHIPS = ['ferDeLance', 'cyclone', 'pyro', 'colonyShip'];
export const VOID_DRIVE_SHIPS = ['bastion', 'nemesis', 'fulgurant', 'titanAstral'];

export const DRIVE_UPGRADE_RULES: { shipId: string; fromDrive: string; toDrive: string; atLevel: number; researchId: string }[] = [
  { shipId: 'atlasCargo', fromDrive: 'Propulsion Chimique', toDrive: 'Réacteur à Impulsions', atLevel: 5, researchId: 'impulseReactor' },
  { shipId: 'mantaRecup', fromDrive: 'Propulsion Chimique', toDrive: 'Réacteur à Impulsions', atLevel: 17, researchId: 'impulseReactor' },
  { shipId: 'mantaRecup', fromDrive: 'Réacteur à Impulsions', toDrive: 'Voile Hyperspatial', atLevel: 15, researchId: 'voidDrive' },
  { shipId: 'pyro', fromDrive: 'Réacteur à Impulsions', toDrive: 'Voile Hyperspatial', atLevel: 8, researchId: 'voidDrive' },
];

export function getShipSpeed(shipId: string, research: Record<string, number>): number {
  const ship = SHIPS.find(s => s.id === shipId);
  if (!ship) return 0;

  const driveType = getShipDriveType(shipId, research);
  let bonus = 0;
  switch (driveType) {
    case 'chemical':
      bonus = (research.chemicalDrive ?? 0) * 0.10;
      break;
    case 'impulse':
      bonus = (research.impulseReactor ?? 0) * 0.20;
      break;
    case 'void':
      bonus = (research.voidDrive ?? 0) * 0.30;
      break;
  }

  return Math.floor(ship.stats.speed * (1 + bonus));
}

export function getSlowestSpeed(ships: Record<string, number>, research: Record<string, number>): number {
  let slowest = Infinity;
  for (const [shipId, count] of Object.entries(ships)) {
    if (count <= 0) continue;
    const speed = getShipSpeed(shipId, research);
    if (speed > 0 && speed < slowest) {
      slowest = speed;
    }
  }
  return slowest === Infinity ? 1000 : slowest;
}

export function getMantaRecupCargoCapacity(mantaCount: number, research: Record<string, number>): number {
  const cargoMult = getCargoBoost(research.subspacialNodes ?? 0);
  const manta = SHIPS.find(s => s.id === 'mantaRecup');
  if (!manta || mantaCount <= 0) return 0;
  return Math.floor(manta.stats.cargo * cargoMult) * mantaCount;
}

export function getFleetCargoCapacity(ships: Record<string, number>, research: Record<string, number>): number {
  const cargoMult = getCargoBoost(research.subspacialNodes ?? 0);
  let total = 0;
  for (const [shipId, count] of Object.entries(ships)) {
    if (count <= 0) continue;
    const ship = SHIPS.find(s => s.id === shipId);
    if (ship) {
      total += Math.floor(ship.stats.cargo * cargoMult) * count;
    }
  }
  return total;
}

export function processEspionage(
  attackerEspionageLevel: number,
  defenderEspionageLevel: number,
  probesSent: number,
  defenderState: {
    resources: { fer: number; silice: number; xenogas: number };
    buildings: Record<string, number>;
    research: Record<string, number>;
    ships: Record<string, number>;
    defenses: Record<string, number>;
    planetName: string;
  },
): {
  resources: { fer: number; silice: number; xenogas: number } | null;
  buildings: Record<string, number> | null;
  research: Record<string, number> | null;
  ships: Record<string, number> | null;
  defenses: Record<string, number> | null;
  probesLost: number;
  planetName: string;
} {
  const techDiff = attackerEspionageLevel - defenderEspionageLevel;
  const rawInfoLevel = probesSent + techDiff * 2;
  const infoLevel = probesSent >= 1 ? Math.max(1, rawInfoLevel) : Math.max(0, rawInfoLevel);

  const detectionChancePerProbe = Math.max(0, (defenderEspionageLevel - attackerEspionageLevel) * 0.04 + 0.02);
  let probesLost = 0;
  for (let i = 0; i < probesSent; i++) {
    if (Math.random() < detectionChancePerProbe) {
      probesLost++;
    }
  }

  const resources = infoLevel >= 1 ? {
    fer: Math.floor(defenderState.resources.fer),
    silice: Math.floor(defenderState.resources.silice),
    xenogas: Math.floor(defenderState.resources.xenogas),
  } : null;

  const buildings = infoLevel >= 3 ? { ...defenderState.buildings } : null;
  const research = infoLevel >= 5 ? { ...defenderState.research } : null;
  const ships = infoLevel >= 7 ? { ...defenderState.ships } : null;
  const defenses = infoLevel >= 9 ? { ...defenderState.defenses } : null;

  return {
    resources,
    buildings,
    research,
    ships,
    defenses,
    probesLost,
    planetName: defenderState.planetName,
  };
}

function createAttackerUnits(
  ships: Record<string, number>,
  research: Record<string, number>,
): CombatUnit[] {
  const units: CombatUnit[] = [];
  for (const [shipId, count] of Object.entries(ships)) {
    if (count <= 0) continue;
    const shipDef = SHIPS.find(s => s.id === shipId);
    if (!shipDef) continue;
    const boosted = getBoostedShipStats(shipDef.stats, research);
    for (let i = 0; i < count; i++) {
      units.push({
        id: `${shipId}_${i}`,
        type: 'ship',
        attack: boosted.attack,
        shield: boosted.shield,
        maxShield: boosted.shield,
        hull: boosted.hull,
        maxHull: boosted.hull,
      });
    }
  }
  return units;
}

function createDefenderUnits(
  ships: Record<string, number>,
  defenses: Record<string, number>,
  research: Record<string, number>,
): CombatUnit[] {
  const units: CombatUnit[] = [];
  for (const [shipId, count] of Object.entries(ships)) {
    if (count <= 0) continue;
    const shipDef = SHIPS.find(s => s.id === shipId);
    if (!shipDef) continue;
    const boosted = getBoostedShipStats(shipDef.stats, research);
    for (let i = 0; i < count; i++) {
      units.push({
        id: `ship_${shipId}_${i}`,
        type: 'ship',
        attack: boosted.attack,
        shield: boosted.shield,
        maxShield: boosted.shield,
        hull: boosted.hull,
        maxHull: boosted.hull,
      });
    }
  }
  for (const [defId, count] of Object.entries(defenses)) {
    if (count <= 0) continue;
    const defDef = DEFENSES.find(d => d.id === defId);
    if (!defDef) continue;
    const boosted = getBoostedDefenseStats(defDef.stats, research);
    for (let i = 0; i < count; i++) {
      units.push({
        id: `def_${defId}_${i}`,
        type: 'defense',
        attack: boosted.attack,
        shield: boosted.shield,
        maxShield: boosted.shield,
        hull: boosted.hull,
        maxHull: boosted.hull,
      });
    }
  }
  return units;
}

function fireRound(attackers: CombatUnit[], defenders: CombatUnit[]): void {
  for (const unit of attackers) {
    if (unit.hull <= 0) continue;
    const aliveDefenders = defenders.filter(d => d.hull > 0);
    if (aliveDefenders.length === 0) break;
    const target = aliveDefenders[Math.floor(Math.random() * aliveDefenders.length)];
    let damage = unit.attack;
    if (target.shield > 0) {
      if (damage <= target.shield * 0.01) {
        continue;
      }
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed;
      damage -= absorbed;
    }
    if (damage > 0) {
      target.hull -= damage;
    }
  }

  for (const unit of defenders) {
    if (unit.hull <= 0) continue;
    const aliveAttackers = attackers.filter(a => a.hull > 0);
    if (aliveAttackers.length === 0) break;
    const target = aliveAttackers[Math.floor(Math.random() * aliveAttackers.length)];
    let damage = unit.attack;
    if (target.shield > 0) {
      if (damage <= target.shield * 0.01) {
        continue;
      }
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed;
      damage -= absorbed;
    }
    if (damage > 0) {
      target.hull -= damage;
    }
  }

  for (const unit of [...attackers, ...defenders]) {
    if (unit.hull > 0) {
      unit.shield = unit.maxShield;
    }
  }
}

function countLosses(
  originalShips: Record<string, number>,
  units: CombatUnit[],
  prefix: string,
): Record<string, number> {
  const surviving: Record<string, number> = {};
  for (const unit of units) {
    if (unit.hull <= 0) continue;
    const parts = unit.id.replace(prefix, '').split('_');
    const shipId = parts.slice(0, -1).join('_') || parts[0];
    surviving[shipId] = (surviving[shipId] ?? 0) + 1;
  }

  const losses: Record<string, number> = {};
  for (const [id, count] of Object.entries(originalShips)) {
    const survived = surviving[id] ?? 0;
    const lost = count - survived;
    if (lost > 0) {
      losses[id] = lost;
    }
  }
  return losses;
}

export interface CombatSimResult {
  result: 'attacker_wins' | 'defender_wins' | 'draw';
  rounds: number;
  attackerLosses: Record<string, number>;
  defenderShipLosses: Record<string, number>;
  defenderDefenseLosses: Record<string, number>;
  loot: { fer: number; silice: number; xenogas: number };
  debris: { fer: number; silice: number };
  attackerSurvivingShips: Record<string, number>;
}

export function simulateCombat(
  attackerShips: Record<string, number>,
  attackerResearch: Record<string, number>,
  defenderShips: Record<string, number>,
  defenderDefenses: Record<string, number>,
  defenderResearch: Record<string, number>,
  defenderResources: { fer: number; silice: number; xenogas: number },
): CombatSimResult {
  const attackerUnits = createAttackerUnits(attackerShips, attackerResearch);
  const defenderUnits = createDefenderUnits(defenderShips, defenderDefenses, defenderResearch);

  const MAX_ROUNDS = 6;
  let roundCount = 0;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    roundCount++;
    fireRound(attackerUnits, defenderUnits);

    const attackerAlive = attackerUnits.filter(u => u.hull > 0).length;
    const defenderAlive = defenderUnits.filter(u => u.hull > 0).length;

    if (attackerAlive === 0 || defenderAlive === 0) break;
  }

  const attackerAlive = attackerUnits.filter(u => u.hull > 0).length;
  const defenderAlive = defenderUnits.filter(u => u.hull > 0).length;

  let result: 'attacker_wins' | 'defender_wins' | 'draw';
  if (attackerAlive === 0 && defenderAlive === 0) result = 'draw';
  else if (attackerAlive === 0) result = 'defender_wins';
  else if (defenderAlive === 0) result = 'attacker_wins';
  else result = 'draw';

  const attackerLosses = countLosses(attackerShips, attackerUnits, '');
  const defenderShipLosses = countLosses(defenderShips, defenderUnits.filter(u => u.type === 'ship'), 'ship_');
  const defenderDefenseLosses = countLosses(defenderDefenses, defenderUnits.filter(u => u.type === 'defense'), 'def_');

  let debrisFer = 0;
  let debrisSilice = 0;
  for (const [shipId, lost] of Object.entries(attackerLosses)) {
    const ship = SHIPS.find(s => s.id === shipId);
    if (ship) {
      debrisFer += Math.floor((ship.cost.fer ?? 0) * lost * 0.3);
      debrisSilice += Math.floor((ship.cost.silice ?? 0) * lost * 0.3);
    }
  }
  for (const [shipId, lost] of Object.entries(defenderShipLosses)) {
    const ship = SHIPS.find(s => s.id === shipId);
    if (ship) {
      debrisFer += Math.floor((ship.cost.fer ?? 0) * lost * 0.3);
      debrisSilice += Math.floor((ship.cost.silice ?? 0) * lost * 0.3);
    }
  }

  const attackerSurvivingShips: Record<string, number> = {};
  for (const [id, count] of Object.entries(attackerShips)) {
    const lost = attackerLosses[id] ?? 0;
    const remaining = count - lost;
    if (remaining > 0) {
      attackerSurvivingShips[id] = remaining;
    }
  }

  let loot = { fer: 0, silice: 0, xenogas: 0 };
  if (result === 'attacker_wins') {
    const cargoCapacity = getFleetCargoCapacity(attackerSurvivingShips, attackerResearch);
    const maxLootFer = Math.floor(defenderResources.fer * 0.5);
    const maxLootSilice = Math.floor(defenderResources.silice * 0.5);
    const maxLootXenogas = Math.floor(defenderResources.xenogas * 0.5);
    const totalAvailable = maxLootFer + maxLootSilice + maxLootXenogas;

    if (totalAvailable <= cargoCapacity) {
      loot = { fer: maxLootFer, silice: maxLootSilice, xenogas: maxLootXenogas };
    } else {
      const ratio = cargoCapacity / totalAvailable;
      loot = {
        fer: Math.floor(maxLootFer * ratio),
        silice: Math.floor(maxLootSilice * ratio),
        xenogas: Math.floor(maxLootXenogas * ratio),
      };
    }
  }

  return {
    result,
    rounds: roundCount,
    attackerLosses,
    defenderShipLosses,
    defenderDefenseLosses,
    loot,
    debris: { fer: debrisFer, silice: debrisSilice },
    attackerSurvivingShips,
  };
}

export function getDefenseRebuildCount(lost: number): number {
  let rebuilt = 0;
  for (let i = 0; i < lost; i++) {
    if (Math.random() < 0.7) rebuilt++;
  }
  return rebuilt;
}
