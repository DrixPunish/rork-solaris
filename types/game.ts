export interface Resources {
  fer: number;
  silice: number;
  xenogas: number;
  energy: number;
}

export interface Prerequisite {
  type: 'building' | 'research';
  id: string;
  level: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: 'resources' | 'facilities';
  baseCost: Partial<Resources>;
  costFactor: number;
  baseProduction?: Partial<Resources>;
  baseTime: number;
  timeFactor: number;
  prerequisites?: Prerequisite[];
}

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  baseCost: Partial<Resources>;
  costFactor: number;
  baseTime: number;
  timeFactor: number;
  prerequisites?: Prerequisite[];
}

export interface ShipDef {
  id: string;
  name: string;
  description: string;
  cost: Partial<Resources>;
  buildTime: number;
  baseFuelCost: number;
  stats: {
    attack: number;
    shield: number;
    hull: number;
    speed: number;
    cargo: number;
  };
  prerequisites?: Prerequisite[];
}

export interface DefenseDef {
  id: string;
  name: string;
  description: string;
  cost: Partial<Resources>;
  buildTime: number;
  stats: {
    attack: number;
    shield: number;
    hull: number;
  };
  prerequisites?: Prerequisite[];
}

export interface UpgradeTimer {
  id: string;
  type: 'building' | 'research';
  targetLevel: number;
  startTime: number;
  endTime: number;
}

export interface ShipyardQueueItem {
  id: string;
  type: 'ship' | 'defense';
  totalQuantity: number;
  remainingQuantity: number;
  buildTimePerUnit: number;
  currentUnitStartTime: number;
  currentUnitEndTime: number;
}

export interface Colony {
  id: string;
  planetName: string;
  coordinates: [number, number, number];
  buildings: Record<string, number>;
  ships: Record<string, number>;
  defenses: Record<string, number>;
  resources: Resources;
  activeTimers: UpgradeTimer[];
  shipyardQueue: ShipyardQueueItem[];
  lastUpdate: number;
  productionPercentages?: ProductionPercentages;
}

export interface ProductionPercentages {
  ferMine: number;
  siliceMine: number;
  xenogasRefinery: number;
  solarPlant: number;
  heliosRemorqueur: number;
}

export const DEFAULT_PRODUCTION_PERCENTAGES: ProductionPercentages = {
  ferMine: 100,
  siliceMine: 100,
  xenogasRefinery: 100,
  solarPlant: 100,
  heliosRemorqueur: 100,
};

export interface GameState {
  planetName: string;
  coordinates: [number, number, number];
  buildings: Record<string, number>;
  research: Record<string, number>;
  ships: Record<string, number>;
  defenses: Record<string, number>;
  resources: Resources;
  solar: number;
  lastUpdate: number;
  activeTimers: UpgradeTimer[];
  shipyardQueue: ShipyardQueueItem[];
  username?: string;
  _resetVersion?: number;
  colonies?: Colony[];
  processedIncomingAttacks?: string[];
  processedIncomingTransports?: string[];
  productionPercentages?: ProductionPercentages;
}

export interface GalaxyPosition {
  position: number;
  type: 'yours' | 'occupied' | 'empty';
  planet?: string;
  player?: string;
  alliance?: string | null;
}

export interface PlayerProfile {
  user_id: string;
  email: string;
  username: string;
  planet_name: string;
  coordinates: [number, number, number];
  updated_at?: string;
}
