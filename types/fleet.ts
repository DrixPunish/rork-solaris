export type MissionType = 'attack' | 'transport' | 'espionage' | 'colonize' | 'recycle' | 'station';
export type FleetStatus = 'traveling' | 'returning' | 'arrived' | 'completed';
export type MissionPhase = 'en_route' | 'arrived' | 'returning' | 'completed';

export interface FleetMission {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_planet: string;
  sender_coords: [number, number, number];
  target_coords: [number, number, number];
  target_player_id: string | null;
  target_username: string | null;
  target_planet: string | null;
  mission_type: MissionType;
  ships: Record<string, number>;
  resources: { fer: number; silice: number; xenogas: number };
  departure_time: number;
  arrival_time: number;
  return_time: number | null;
  status: FleetStatus;
  processed: boolean;
  mission_phase: MissionPhase;
  completed_at: string | null;
  result: CombatResult | EspionageResult | TransportResult | ColonizeResult | null;
  created_at: string;
}

export interface EspionageResult {
  type: 'espionage';
  report_id: string;
  probes_lost: number;
  probes_sent: number;
}

export interface TransportResult {
  type: 'transport';
  delivered: { fer: number; silice: number; xenogas: number };
}

export interface CombatResult {
  type: 'combat';
  report_id: string;
  outcome: 'attacker_wins' | 'defender_wins' | 'draw';
  loot: { fer: number; silice: number; xenogas: number };
}

export interface ColonizeResult {
  type: 'colonize';
  success: boolean;
  colonyId?: string;
  reason?: string;
}

export interface EspionageReport {
  id: string;
  player_id: string;
  target_player_id: string | null;
  target_username: string | null;
  target_coords: [number, number, number];
  target_planet_name: string | null;
  resources: { fer: number; silice: number; xenogas: number } | null;
  buildings: Record<string, number> | null;
  research: Record<string, number> | null;
  ships: Record<string, number> | null;
  defenses: Record<string, number> | null;
  probes_sent: number;
  probes_lost: number;
  created_at: string;
}

export interface CombatUnit {
  id: string;
  type: 'ship' | 'defense';
  attack: number;
  shield: number;
  maxShield: number;
  hull: number;
  maxHull: number;
}

export interface CombatReport {
  id: string;
  attacker_id: string;
  defender_id: string | null;
  attacker_username: string | null;
  defender_username: string | null;
  attacker_coords: [number, number, number] | null;
  target_coords: [number, number, number];
  attacker_fleet: Record<string, number>;
  defender_fleet: Record<string, number> | null;
  defender_defenses_initial: Record<string, number> | null;
  rounds: number;
  result: 'attacker_wins' | 'defender_wins' | 'draw';
  attacker_losses: Record<string, number> | null;
  defender_losses: Record<string, number> | null;
  loot: { fer: number; silice: number; xenogas: number } | null;
  debris: { fer: number; silice: number } | null;
  created_at: string;
}

export interface TransportReport {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_coords: [number, number, number];
  target_coords: [number, number, number];
  target_player_id: string | null;
  target_username: string | null;
  target_planet: string | null;
  mission_type: 'transport' | 'recycle';
  ships: Record<string, number>;
  resources: { fer: number; silice: number; xenogas: number };
  arrival_time: number;
  result: {
    type: string;
    delivered?: { fer: number; silice: number; xenogas: number };
    collected?: { fer: number; silice: number };
  } | null;
  created_at: string;
}

export interface FleetComposition {
  [shipId: string]: number;
}

export type AttackBlockReason = 'noob_shield_attacker' | 'noob_shield_defender' | 'point_gap';

export interface AttackStatus {
  can_attack: boolean;
  reason: AttackBlockReason | null;
  attacker_pts: number;
  defender_pts: number;
}

export interface FleetDispatchParams {
  targetCoords: [number, number, number];
  targetPlayerId: string | null;
  targetUsername: string | null;
  targetPlanet: string | null;
  missionType: MissionType;
  ships: FleetComposition;
  resources?: { fer: number; silice: number; xenogas: number };
}
