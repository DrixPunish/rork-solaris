import { supabase } from '@/backend/supabase';
import {
  processEspionage,
  simulateCombat,
  getDefenseRebuildCount,
  getMantaRecupCargoCapacity,
} from '@/utils/fleetCalculations';
import {
  calculateProduction,
  getResourceStorageCapacity,
} from '@/utils/gameCalculations';

interface TimerRow {
  id: string;
  user_id: string;
  planet_id: string | null;
  timer_type: string;
  target_id: string;
  target_level: number;
  start_time: number;
  end_time: number;
}

interface QueueRow {
  planet_id: string;
  item_id: string;
  item_type: string;
  total_quantity: number;
  remaining_quantity: number;
  build_time_per_unit: number;
  current_unit_start_time: number;
  current_unit_end_time: number;
}

interface PlanetRow {
  id: string;
  user_id: string;
  planet_name: string;
  coordinates: [number, number, number];
  is_main: boolean;
  last_update: number;
}

// ── Timer Processing ──

async function processExpiredTimers(): Promise<number> {
  const now = Date.now();

  const { data: expired, error } = await supabase
    .from('active_timers')
    .select('*')
    .lte('end_time', now);

  if (error) {
    console.log('[WorldTick] ERROR querying active_timers:', error.message, error.code, error.details);
    return 0;
  }

  console.log('[WorldTick] Expired query returned', expired?.length ?? 0, 'rows for now =', now);

  if (!expired?.length) {
    return 0;
  }

  console.log('[WorldTick] Found', expired.length, 'expired timers to process');

  let count = 0;
  for (const timer of expired as TimerRow[]) {
    console.log('[WorldTick] Processing timer:', timer.id, 'type:', timer.timer_type, 'target:', timer.target_id, 'lv:', timer.target_level, 'planet:', timer.planet_id, 'user:', timer.user_id, 'end_time:', timer.end_time, '(' + new Date(timer.end_time).toISOString() + ')');

    const { data: deleted, error: delErr } = await supabase
      .from('active_timers')
      .delete()
      .eq('id', timer.id)
      .select();

    if (delErr) {
      console.log('[WorldTick] ERROR deleting timer', timer.id, ':', delErr.message, delErr.code);
      continue;
    }
    if (!deleted?.length) {
      console.log('[WorldTick] Timer already claimed by another tick:', timer.id);
      continue;
    }

    if (timer.timer_type === 'building' && timer.planet_id) {
      const { data: beforeData } = await supabase
        .from('planet_buildings')
        .select('level')
        .eq('planet_id', timer.planet_id)
        .eq('building_id', timer.target_id)
        .maybeSingle();

      console.log('[WorldTick] Building before upsert:', timer.target_id, 'current level:', beforeData?.level ?? 0, '-> target level:', timer.target_level);

      const { error: upsertErr } = await supabase
        .from('planet_buildings')
        .upsert({
          planet_id: timer.planet_id,
          building_id: timer.target_id,
          level: timer.target_level,
        }, { onConflict: 'planet_id,building_id' });

      if (upsertErr) {
        console.log('[WorldTick] ERROR applying building:', upsertErr.message, upsertErr.code, upsertErr.details);
      } else {
        const { data: afterData } = await supabase
          .from('planet_buildings')
          .select('level')
          .eq('planet_id', timer.planet_id)
          .eq('building_id', timer.target_id)
          .maybeSingle();
        console.log('[WorldTick] Building completed:', timer.target_id, 'lv', timer.target_level, 'planet', timer.planet_id, '| verified level in DB:', afterData?.level);
      }
    } else if (timer.timer_type === 'research') {
      const { data: beforeData } = await supabase
        .from('player_research')
        .select('level')
        .eq('user_id', timer.user_id)
        .eq('research_id', timer.target_id)
        .maybeSingle();

      console.log('[WorldTick] Research before upsert:', timer.target_id, 'current level:', beforeData?.level ?? 0, '-> target level:', timer.target_level);

      const { error: upsertErr } = await supabase
        .from('player_research')
        .upsert({
          user_id: timer.user_id,
          research_id: timer.target_id,
          level: timer.target_level,
        }, { onConflict: 'user_id,research_id' });

      if (upsertErr) {
        console.log('[WorldTick] ERROR applying research:', upsertErr.message, upsertErr.code, upsertErr.details);
      } else {
        console.log('[WorldTick] Research completed:', timer.target_id, 'lv', timer.target_level, 'user', timer.user_id);
      }
    } else {
      console.log('[WorldTick] Unknown timer type:', timer.timer_type, 'for timer:', timer.id);
    }
    count++;
  }

  console.log('[WorldTick] Processed', count, 'expired timers out of', expired.length, 'found');
  return count;
}

// ── Shipyard Queue Processing ──

async function processExpiredShipyardQueues(): Promise<number> {
  const now = Date.now();
  const { data: items, error } = await supabase
    .from('shipyard_queue')
    .select('*')
    .lte('current_unit_end_time', now);

  if (error || !items?.length) return 0;

  let count = 0;
  for (const item of items as QueueRow[]) {
    let completed = 0;
    let endTime = item.current_unit_end_time;
    let remaining = item.remaining_quantity;

    while (now >= endTime && remaining > 0) {
      completed++;
      remaining--;
      if (remaining > 0) {
        endTime += item.build_time_per_unit * 1000;
      }
    }

    if (completed === 0) continue;

    if (remaining <= 0) {
      const { data: deleted } = await supabase
        .from('shipyard_queue')
        .delete()
        .eq('planet_id', item.planet_id)
        .eq('item_id', item.item_id)
        .eq('item_type', item.item_type)
        .eq('remaining_quantity', item.remaining_quantity)
        .select();

      if (!deleted?.length) continue;
    } else {
      const { data: updated } = await supabase
        .from('shipyard_queue')
        .update({
          remaining_quantity: remaining,
          current_unit_start_time: endTime - item.build_time_per_unit * 1000,
          current_unit_end_time: endTime,
        })
        .eq('planet_id', item.planet_id)
        .eq('item_id', item.item_id)
        .eq('item_type', item.item_type)
        .eq('remaining_quantity', item.remaining_quantity)
        .select();

      if (!updated?.length) continue;
    }

    if (item.item_type === 'ship') {
      const { data: existing } = await supabase
        .from('planet_ships')
        .select('quantity')
        .eq('planet_id', item.planet_id)
        .eq('ship_id', item.item_id)
        .single();

      await supabase.from('planet_ships').upsert({
        planet_id: item.planet_id,
        ship_id: item.item_id,
        quantity: (existing?.quantity ?? 0) + completed,
      }, { onConflict: 'planet_id,ship_id' });
    } else {
      const { data: existing } = await supabase
        .from('planet_defenses')
        .select('quantity')
        .eq('planet_id', item.planet_id)
        .eq('defense_id', item.item_id)
        .single();

      await supabase.from('planet_defenses').upsert({
        planet_id: item.planet_id,
        defense_id: item.item_id,
        quantity: (existing?.quantity ?? 0) + completed,
      }, { onConflict: 'planet_id,defense_id' });
    }

    console.log('[WorldTick] Built', completed, 'x', item.item_id, '(' + item.item_type + ') planet', item.planet_id);
    count++;
  }

  if (count > 0) console.log('[WorldTick] Processed', count, 'shipyard queue items');
  return count;
}

// ── Fleet Return Processing ──

async function processReturningFleets(): Promise<number> {
  const { data: result, error } = await supabase.rpc('rpc_process_fleet_returns');

  if (error) {
    console.log('[WorldTick] rpc_process_fleet_returns error:', error.message, error.code);
    return 0;
  }

  const res = result as { success?: boolean; processed?: number; errors?: string[] } | null;
  const count = res?.processed ?? 0;

  if (res?.errors && res.errors.length > 0) {
    console.log('[WorldTick] Fleet return errors:', JSON.stringify(res.errors));
  }

  if (count > 0) {
    console.log('[WorldTick] Processed', count, 'fleet returns via RPC');
  }

  return count;
}

// ── Fleet Arrival Processing ──

async function loadResearchFromDB(userId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('player_research')
    .select('research_id, level')
    .eq('user_id', userId);
  const research: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ research_id: string; level: number }>) {
    research[r.research_id] = r.level;
  }
  return research;
}

async function loadPlanetState(planetId: string, userId: string) {
  const [resRes, buildRes, shipsRes, defensesRes, planetRes] = await Promise.all([
    supabase.from('planet_resources').select('fer, silice, xenogas, energy').eq('planet_id', planetId).single(),
    supabase.from('planet_buildings').select('building_id, level').eq('planet_id', planetId),
    supabase.from('planet_ships').select('ship_id, quantity').eq('planet_id', planetId),
    supabase.from('planet_defenses').select('defense_id, quantity').eq('planet_id', planetId),
    supabase.from('planets').select('planet_name, coordinates, last_update').eq('id', planetId).single(),
  ]);

  const resData = resRes.data as { fer?: number; silice?: number; xenogas?: number; energy?: number } | null;
  const buildings: Record<string, number> = {};
  for (const r of (buildRes.data ?? []) as Array<{ building_id: string; level: number }>) {
    buildings[r.building_id] = r.level;
  }
  const ships: Record<string, number> = {};
  for (const r of (shipsRes.data ?? []) as Array<{ ship_id: string; quantity: number }>) {
    if (r.quantity > 0) ships[r.ship_id] = r.quantity;
  }
  const defenses: Record<string, number> = {};
  for (const r of (defensesRes.data ?? []) as Array<{ defense_id: string; quantity: number }>) {
    if (r.quantity > 0) defenses[r.defense_id] = r.quantity;
  }

  const research = await loadResearchFromDB(userId);

  const now = Date.now();
  const lastUpdate = (planetRes.data?.last_update as number) ?? now;
  const elapsed = (now - lastUpdate) / 1000;

  const production = calculateProduction(buildings, research, ships);
  const storageCap = getResourceStorageCapacity(buildings);

  const rawFer = resData?.fer ?? 0;
  const rawSilice = resData?.silice ?? 0;
  const rawXenogas = resData?.xenogas ?? 0;

  const { data: matResult } = await supabase.rpc('materialize_planet_resources', {
    p_planet_id: planetId,
    p_user_id: userId,
  });

  const matRes = matResult as { success?: boolean; fer?: number; silice?: number; xenogas?: number } | null;

  const resources = {
    fer: matRes?.fer ?? (rawFer >= storageCap.fer ? rawFer : Math.min(rawFer + (production.fer / 3600) * elapsed, storageCap.fer)),
    silice: matRes?.silice ?? (rawSilice >= storageCap.silice ? rawSilice : Math.min(rawSilice + (production.silice / 3600) * elapsed, storageCap.silice)),
    xenogas: matRes?.xenogas ?? (rawXenogas >= storageCap.xenogas ? rawXenogas : Math.min(rawXenogas + (production.xenogas / 3600) * elapsed, storageCap.xenogas)),
  };

  return {
    planetName: (planetRes.data?.planet_name as string) ?? 'Unknown',
    resources,
    buildings,
    research,
    ships,
    defenses,
  };
}

async function getPlanetIdByCoords(coords: number[]): Promise<{ planetId: string; userId: string } | null> {
  const { data } = await supabase
    .from('planets')
    .select('id, user_id')
    .filter('coordinates->>0', 'eq', String(coords[0]))
    .filter('coordinates->>1', 'eq', String(coords[1]))
    .filter('coordinates->>2', 'eq', String(coords[2]))
    .single();
  if (!data) return null;
  return { planetId: data.id as string, userId: data.user_id as string };
}

async function processEspionageMission(mission: Record<string, unknown>): Promise<void> {
  const senderId = mission.sender_id as string;
  let targetPlayerId = mission.target_player_id as string | null;
  const targetCoords = mission.target_coords as number[];
  const ships = mission.ships as Record<string, number>;

  console.log('[WorldTick][Espionage] === START === mission', mission.id, 'sender:', senderId, 'targetCoords:', JSON.stringify(targetCoords), 'targetPlayerId:', targetPlayerId, 'ships:', JSON.stringify(ships));

  const targetPlanetInfo = await getPlanetIdByCoords(targetCoords);
  console.log('[WorldTick][Espionage] Target planet lookup:', targetPlanetInfo ? `planetId=${targetPlanetInfo.planetId}, userId=${targetPlanetInfo.userId}` : 'NOT FOUND');

  if (!targetPlanetInfo) {
    console.log('[WorldTick][Espionage] Target planet not found at coords', JSON.stringify(targetCoords), '- aborting, returning probes');
    const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      mission_phase: 'returning',
      return_time: (mission.arrival_time as number) + travelTime,
      result: { type: 'espionage', probes_sent: ships.spectreSonde ?? 1, probes_lost: 0 },
    }).eq('id', mission.id);
    return;
  }

  if (!targetPlayerId) {
    targetPlayerId = targetPlanetInfo.userId;
    console.log('[WorldTick][Espionage] targetPlayerId resolved from coords:', targetPlayerId);
  }

  const senderResearch = await loadResearchFromDB(senderId);
  console.log('[WorldTick][Espionage] Sender espionageTech:', senderResearch.espionageTech ?? 0);

  let targetState: Awaited<ReturnType<typeof loadPlanetState>> | null = null;
  try {
    targetState = await loadPlanetState(targetPlanetInfo.planetId, targetPlanetInfo.userId);
    console.log('[WorldTick][Espionage] Target state loaded: resources=', JSON.stringify(targetState.resources), 'buildings=', Object.keys(targetState.buildings).length, 'ships=', Object.keys(targetState.ships).length, 'defenses=', Object.keys(targetState.defenses).length, 'planetName=', targetState.planetName);
  } catch (e) {
    console.log('[WorldTick][Espionage] ERROR loading target state:', e);
  }

  const probesSent = ships.spectreSonde ?? 1;
  const attackerEspionage = senderResearch.espionageTech ?? 0;
  const defenderEspionage = targetState?.research?.espionageTech ?? 0;

  console.log('[WorldTick][Espionage] probesSent:', probesSent, 'attackerEsp:', attackerEspionage, 'defenderEsp:', defenderEspionage);

  const espResult = processEspionage(
    attackerEspionage,
    defenderEspionage,
    probesSent,
    {
      resources: targetState?.resources ?? { fer: 0, silice: 0, xenogas: 0 },
      buildings: targetState?.buildings ?? {},
      research: targetState?.research ?? {},
      ships: targetState?.ships ?? {},
      defenses: targetState?.defenses ?? {},
      planetName: targetState?.planetName ?? 'Inconnue',
    },
  );

  const allProbesLost = espResult.probesLost >= probesSent;
  console.log('[WorldTick][Espionage] espResult: probesLost=', espResult.probesLost, '/', probesSent, 'allLost=', allProbesLost, 'resources=', espResult.resources !== null ? 'present' : 'NULL', 'buildings=', espResult.buildings !== null ? 'present' : 'NULL', 'research=', espResult.research !== null ? 'present' : 'NULL', 'ships=', espResult.ships !== null ? 'present' : 'NULL', 'defenses=', espResult.defenses !== null ? 'present' : 'NULL');

  const targetPlanetName = espResult.planetName || targetState?.planetName || 'Inconnue';

  if (!allProbesLost) {
    console.log('[WorldTick][Espionage] Inserting ATTACKER report for', senderId, 'planetName=', targetPlanetName);
    const { error: attackerReportErr } = await supabase.from('espionage_reports').insert({
      player_id: senderId,
      target_player_id: targetPlayerId,
      target_username: (mission.target_username as string) ?? null,
      target_coords: targetCoords,
      target_planet_id: targetPlanetInfo.planetId,
      target_planet_name: targetPlanetName,
      resources: espResult.resources,
      buildings: espResult.buildings,
      research: espResult.research,
      ships: espResult.ships,
      defenses: espResult.defenses,
      probes_sent: probesSent,
      probes_lost: espResult.probesLost,
    });

    if (attackerReportErr) {
      console.log('[WorldTick][Espionage] ERROR inserting attacker report:', attackerReportErr.message, attackerReportErr.code, attackerReportErr.details);
    } else {
      console.log('[WorldTick][Espionage] Attacker report inserted OK');
    }
  } else {
    console.log('[WorldTick][Espionage] All probes destroyed - NO attacker report');
  }

  if (targetPlayerId && targetPlayerId !== senderId) {
    console.log('[WorldTick][Espionage] Inserting VICTIM alert for', targetPlayerId, 'planet=', targetPlanetName, 'coords=', JSON.stringify(targetCoords));
    const { error: victimReportErr } = await supabase.from('espionage_reports').insert({
      player_id: targetPlayerId,
      target_player_id: senderId,
      target_username: null,
      target_coords: targetCoords,
      target_planet_id: targetPlanetInfo.planetId,
      target_planet_name: targetPlanetName,
      resources: null,
      buildings: null,
      research: null,
      ships: null,
      defenses: null,
      probes_sent: 0,
      probes_lost: 0,
    });

    if (victimReportErr) {
      console.log('[WorldTick][Espionage] ERROR inserting victim report:', victimReportErr.message, victimReportErr.code, victimReportErr.details);
    } else {
      console.log('[WorldTick][Espionage] Victim alert inserted OK for:', targetPlayerId);
    }
  } else {
    console.log('[WorldTick][Espionage] No victim report: targetPlayerId=', targetPlayerId, 'senderId=', senderId);
  }

  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;
  const survivingProbes = probesSent - espResult.probesLost;
  const resultShips = survivingProbes > 0 ? { spectreSonde: survivingProbes } : {};

  const finalStatus = survivingProbes > 0 ? 'returning' : 'completed';
  const finalPhase = survivingProbes > 0 ? 'returning' : 'completed';

  await supabase.from('fleet_missions').update({
    status: finalStatus,
    processed: true,
    mission_phase: finalPhase,
    return_time: survivingProbes > 0 ? returnTime : null,
    ships: resultShips,
    result: { type: 'espionage', probes_sent: probesSent, probes_lost: espResult.probesLost },
    ...(finalPhase === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', mission.id);

  console.log('[WorldTick][Espionage] === DONE === mission', mission.id, 'survivingProbes:', survivingProbes, 'status:', finalStatus);
}

async function processAttackMission(mission: Record<string, unknown>): Promise<void> {
  const senderId = mission.sender_id as string;
  const targetPlayerId = mission.target_player_id as string | null;
  const targetCoords = mission.target_coords as number[];
  const attackerShips = mission.ships as Record<string, number>;

  const senderResearch = await loadResearchFromDB(senderId);

  let targetState: Awaited<ReturnType<typeof loadPlanetState>> | null = null;
  let _targetPlanetId: string | null = null;

  if (targetPlayerId) {
    const planetInfo = await getPlanetIdByCoords(targetCoords);
    if (planetInfo) {
      _targetPlanetId = planetInfo.planetId;
      targetState = await loadPlanetState(planetInfo.planetId, targetPlayerId);
    }
  }

  if (!targetState || !targetPlayerId) {
    const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      mission_phase: 'returning',
      return_time: (mission.arrival_time as number) + travelTime,
      result: { type: 'combat', outcome: 'draw', loot: { fer: 0, silice: 0, xenogas: 0 } },
    }).eq('id', mission.id);
    return;
  }

  const combatResult = simulateCombat(
    attackerShips,
    senderResearch,
    targetState.ships ?? {},
    targetState.defenses ?? {},
    targetState.research ?? {},
    targetState.resources,
  );

  await supabase.from('combat_reports').insert({
    attacker_id: senderId,
    defender_id: targetPlayerId,
    attacker_username: mission.sender_username,
    defender_username: mission.target_username,
    attacker_coords: mission.sender_coords,
    target_coords: targetCoords,
    attacker_fleet: attackerShips,
    defender_fleet: targetState.ships,
    defender_defenses_initial: targetState.defenses,
    rounds: combatResult.rounds,
    result: combatResult.result,
    attacker_losses: combatResult.attackerLosses,
    defender_losses: { ...combatResult.defenderShipLosses, ...combatResult.defenderDefenseLosses },
    loot: combatResult.loot,
    debris: combatResult.debris,
  });

  if (_targetPlanetId) {
    const { error: rpcError } = await supabase.rpc('apply_attack_loot', {
      p_planet_id: _targetPlanetId,
      p_loot_fer: combatResult.loot.fer,
      p_loot_silice: combatResult.loot.silice,
      p_loot_xenogas: combatResult.loot.xenogas,
      p_ship_losses: combatResult.defenderShipLosses,
      p_defense_losses: combatResult.defenderDefenseLosses,
      p_defense_rebuilds: Object.fromEntries(
        Object.entries(combatResult.defenderDefenseLosses).map(([id, count]) => [id, getDefenseRebuildCount(count)])
      ),
    });
    if (rpcError) console.log('[WorldTick] RPC apply_attack_loot error:', rpcError.message);
  }

  if (combatResult.debris && (combatResult.debris.fer > 0 || combatResult.debris.silice > 0)) {
    const { data: existing } = await supabase
      .from('debris_fields')
      .select('id, fer, silice')
      .eq('coords->>0', String(targetCoords[0]))
      .eq('coords->>1', String(targetCoords[1]))
      .eq('coords->>2', String(targetCoords[2]))
      .single();

    if (existing) {
      await supabase.from('debris_fields').update({
        fer: (existing.fer ?? 0) + combatResult.debris.fer,
        silice: (existing.silice ?? 0) + combatResult.debris.silice,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('debris_fields').insert({
        coords: targetCoords,
        fer: combatResult.debris.fer,
        silice: combatResult.debris.silice,
      });
    }
  }

  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;
  const hasShips = Object.values(combatResult.attackerSurvivingShips).some(c => c > 0);

  const attackFinalPhase = hasShips ? 'returning' : 'completed';
  await supabase.from('fleet_missions').update({
    status: hasShips ? 'returning' : 'completed',
    processed: true,
    mission_phase: attackFinalPhase,
    return_time: hasShips ? returnTime : null,
    ships: combatResult.attackerSurvivingShips,
    resources: combatResult.loot,
    result: { type: 'combat', outcome: combatResult.result, loot: combatResult.loot },
    ...(attackFinalPhase === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', mission.id);

  console.log('[WorldTick] Attack processed:', mission.id, 'result:', combatResult.result);
}

async function processTransportMission(mission: Record<string, unknown>): Promise<void> {
  const _targetPlayerId = mission.target_player_id as string | null;
  void _targetPlayerId;
  const targetCoords = mission.target_coords as number[];
  const resources = mission.resources as { fer?: number; silice?: number; xenogas?: number } | null;

  const deliveredResources = {
    fer: resources?.fer ?? 0,
    silice: resources?.silice ?? 0,
    xenogas: resources?.xenogas ?? 0,
  };

  const targetPlanetInfo = await getPlanetIdByCoords(targetCoords);
  if (targetPlanetInfo && (deliveredResources.fer > 0 || deliveredResources.silice > 0 || deliveredResources.xenogas > 0)) {
    const { error: rpcErr } = await supabase.rpc('add_resources_to_planet', {
      p_planet_id: targetPlanetInfo.planetId,
      p_fer: deliveredResources.fer,
      p_silice: deliveredResources.silice,
      p_xenogas: deliveredResources.xenogas,
    });
    if (rpcErr) {
      console.log('[WorldTick] Error adding transport resources:', rpcErr.message);
    } else {
      await supabase.from('planets').update({ last_update: Date.now() }).eq('id', targetPlanetInfo.planetId);
    }
  }

  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;

  await supabase.from('fleet_missions').update({
    status: 'returning',
    processed: true,
    mission_phase: 'returning',
    return_time: returnTime,
    resources: { fer: 0, silice: 0, xenogas: 0 },
    result: { type: 'transport', delivered: resources },
  }).eq('id', mission.id);

  console.log('[WorldTick] Transport processed:', mission.id, 'to', targetCoords);
}

async function processRecycleMission(mission: Record<string, unknown>): Promise<void> {
  const senderId = mission.sender_id as string;
  const coords = mission.target_coords as number[];
  const ships = mission.ships as Record<string, number>;

  const { data: debrisRow } = await supabase
    .from('debris_fields')
    .select('*')
    .eq('coords->>0', String(coords[0]))
    .eq('coords->>1', String(coords[1]))
    .eq('coords->>2', String(coords[2]))
    .single();

  const debrisFer = debrisRow?.fer ?? 0;
  const debrisSilice = debrisRow?.silice ?? 0;

  const senderResearch = await loadResearchFromDB(senderId);
  const mantaCount = ships.mantaRecup ?? 0;
  const mantaCargo = getMantaRecupCargoCapacity(mantaCount, senderResearch);

  const totalDebris = debrisFer + debrisSilice;
  let collectedFer = 0;
  let collectedSilice = 0;

  if (totalDebris > 0 && mantaCargo > 0) {
    const ratio = Math.min(1, mantaCargo / totalDebris);
    collectedFer = Math.floor(debrisFer * ratio);
    collectedSilice = Math.floor(debrisSilice * ratio);
  }

  const remainingFer = debrisFer - collectedFer;
  const remainingSilice = debrisSilice - collectedSilice;

  if (remainingFer <= 0 && remainingSilice <= 0) {
    await supabase.from('debris_fields').delete()
      .eq('coords->>0', String(coords[0]))
      .eq('coords->>1', String(coords[1]))
      .eq('coords->>2', String(coords[2]));
  } else if (debrisRow) {
    await supabase.from('debris_fields').update({
      fer: remainingFer,
      silice: remainingSilice,
      updated_at: new Date().toISOString(),
    }).eq('id', debrisRow.id);
  }

  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;

  await supabase.from('fleet_missions').update({
    status: 'returning',
    processed: true,
    mission_phase: 'returning',
    return_time: returnTime,
    resources: { fer: collectedFer, silice: collectedSilice, xenogas: 0 },
    result: { type: 'recycle', collected: { fer: collectedFer, silice: collectedSilice } },
  }).eq('id', mission.id);

  console.log('[WorldTick] Recycled:', collectedFer, 'fer,', collectedSilice, 'silice');
}

async function processColonizeMission(mission: Record<string, unknown>): Promise<void> {
  const senderId = mission.sender_id as string;
  const targetCoords = mission.target_coords as [number, number, number];
  const ships = mission.ships as Record<string, number>;

  const missionResources = mission.resources as { fer?: number; silice?: number; xenogas?: number } | null;
  const cargoFer = missionResources?.fer ?? 0;
  const cargoSilice = missionResources?.silice ?? 0;
  const cargoXenogas = missionResources?.xenogas ?? 0;

  console.log('[WorldTick][Colonize] START mission', mission.id, 'sender:', senderId, 'coords:', JSON.stringify(targetCoords), 'cargo:', JSON.stringify({ fer: cargoFer, silice: cargoSilice, xenogas: cargoXenogas }), 'mission.resources raw:', JSON.stringify(mission.resources));

  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;

  const { data: existingPlanets } = await supabase
    .from('planets')
    .select('id, user_id, last_update')
    .filter('coordinates->>0', 'eq', String(targetCoords[0]))
    .filter('coordinates->>1', 'eq', String(targetCoords[1]))
    .filter('coordinates->>2', 'eq', String(targetCoords[2]))
    .limit(1);

  const existingPlanet = existingPlanets?.[0] as { id: string; user_id: string; last_update: number } | undefined;

  if (existingPlanet && existingPlanet.user_id === senderId) {
    console.log('[WorldTick][Colonize] Position occupied by SAME player (retry case). Planet:', existingPlanet.id, 'Transferring cargo directly.');

    if (cargoFer > 0 || cargoSilice > 0 || cargoXenogas > 0) {
      const { error: addErr } = await supabase.rpc('add_resources_to_planet', {
        p_planet_id: existingPlanet.id,
        p_fer: cargoFer,
        p_silice: cargoSilice,
        p_xenogas: cargoXenogas,
      });
      if (addErr) {
        console.log('[WorldTick][Colonize] ERROR adding cargo to existing colony:', addErr.message, '- trying direct upsert');
        await supabase.from('planet_resources').upsert({
          planet_id: existingPlanet.id,
          fer: 500 + cargoFer,
          silice: 300 + cargoSilice,
          xenogas: cargoXenogas,
          energy: 0,
        }, { onConflict: 'planet_id' });
      } else {
        console.log('[WorldTick][Colonize] Cargo added to existing colony OK:', { fer: cargoFer, silice: cargoSilice, xenogas: cargoXenogas });
      }
    }

    const returningShips = { ...ships };
    const colonyShipCount = returningShips.colonyShip ?? 0;
    if (colonyShipCount > 1) {
      returningShips.colonyShip = colonyShipCount - 1;
    } else {
      delete returningShips.colonyShip;
    }
    const hasReturning = Object.values(returningShips).some(c => c > 0);
    const finalPhase = hasReturning ? 'returning' : 'completed';

    await supabase.from('fleet_missions').update({
      status: hasReturning ? 'returning' : 'completed',
      processed: true,
      mission_phase: finalPhase,
      return_time: hasReturning ? returnTime : null,
      ships: returningShips,
      resources: { fer: 0, silice: 0, xenogas: 0 },
      result: { type: 'colonize', success: true, colonyId: existingPlanet.id, cargo: { fer: cargoFer, silice: cargoSilice, xenogas: cargoXenogas }, retry: true },
      ...(finalPhase === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', mission.id);

    console.log('[WorldTick][Colonize] Retry colonize completed for planet:', existingPlanet.id);
    return;
  }

  if (existingPlanet) {
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      mission_phase: 'returning',
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Position déjà occupée' },
    }).eq('id', mission.id);
    console.log('[WorldTick][Colonize] Failed (occupied by another player):', mission.id);
    return;
  }

  const { data: playerColonies } = await supabase
    .from('planets')
    .select('id')
    .eq('user_id', senderId)
    .eq('is_main', false);

  const senderResearch = await loadResearchFromDB(senderId);
  const astroLevel = senderResearch.astrophysics ?? 0;
  const maxColonies = 1 + Math.floor(astroLevel / 2);
  const currentColonies = playerColonies?.length ?? 0;

  if (currentColonies >= maxColonies) {
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      mission_phase: 'returning',
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Nombre maximum de colonies atteint' },
    }).eq('id', mission.id);
    console.log('[WorldTick][Colonize] Failed (max colonies):', mission.id);
    return;
  }

  const { data: colonyResult, error: colonyErr } = await supabase.rpc('rpc_create_colony_atomic', {
    p_user_id: senderId,
    p_planet_name: `Colonie ${currentColonies + 1}`,
    p_coordinates: targetCoords,
    p_cargo_fer: cargoFer,
    p_cargo_silice: cargoSilice,
    p_cargo_xenogas: cargoXenogas,
  });

  const colonyData = colonyResult as { success?: boolean; planet_id?: string; error?: string; fer?: number; silice?: number; xenogas?: number; protected_until?: number } | null;

  if (colonyErr || !colonyData?.success || !colonyData?.planet_id) {
    const errMsg = colonyErr?.message ?? colonyData?.error ?? 'Unknown error';
    console.log('[WorldTick][Colonize] ERROR rpc_create_colony_atomic:', errMsg);
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      mission_phase: 'returning',
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Erreur création colonie: ' + errMsg },
    }).eq('id', mission.id);
    return;
  }

  const newPlanetId = colonyData.planet_id;
  console.log('[WorldTick][Colonize] ATOMIC colony CONFIRMED:', newPlanetId, 'cargo:', { fer: cargoFer, silice: cargoSilice, xenogas: cargoXenogas }, 'rpc returned:', { fer: colonyData.fer, silice: colonyData.silice, xenogas: colonyData.xenogas }, 'protected_until:', colonyData.protected_until);

  const returningShips = { ...ships };
  const colonyShipCount = returningShips.colonyShip ?? 0;
  if (colonyShipCount > 1) {
    returningShips.colonyShip = colonyShipCount - 1;
  } else {
    delete returningShips.colonyShip;
  }

  const hasReturning = Object.values(returningShips).some(c => c > 0);

  const colonizeFinalPhase = hasReturning ? 'returning' : 'completed';
  await supabase.from('fleet_missions').update({
    status: hasReturning ? 'returning' : 'completed',
    processed: true,
    mission_phase: colonizeFinalPhase,
    return_time: hasReturning ? returnTime : null,
    ships: returningShips,
    resources: { fer: 0, silice: 0, xenogas: 0 },
    result: { type: 'colonize', success: true, colonyId: newPlanetId, cargo: { fer: cargoFer, silice: cargoSilice, xenogas: cargoXenogas } },
    ...(colonizeFinalPhase === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', mission.id);

  console.log('[WorldTick][Colonize] DONE colony:', newPlanetId, 'at', targetCoords, 'resources:', { fer: 500 + cargoFer, silice: 300 + cargoSilice, xenogas: cargoXenogas });
}

async function processStationMission(mission: Record<string, unknown>): Promise<void> {
  const targetCoords = mission.target_coords as number[];
  const ships = mission.ships as Record<string, number>;
  const resources = mission.resources as { fer?: number; silice?: number; xenogas?: number } | null;

  const targetPlanetInfo = await getPlanetIdByCoords(targetCoords);
  if (targetPlanetInfo) {
    for (const [shipId, qty] of Object.entries(ships)) {
      if (qty <= 0) continue;
      const { data: existing } = await supabase
        .from('planet_ships')
        .select('quantity')
        .eq('planet_id', targetPlanetInfo.planetId)
        .eq('ship_id', shipId)
        .single();

      await supabase.from('planet_ships').upsert({
        planet_id: targetPlanetInfo.planetId,
        ship_id: shipId,
        quantity: (existing?.quantity ?? 0) + qty,
      }, { onConflict: 'planet_id,ship_id' });
    }

    if (resources && ((resources.fer ?? 0) > 0 || (resources.silice ?? 0) > 0 || (resources.xenogas ?? 0) > 0)) {
      await supabase.rpc('add_resources_to_planet', {
        p_planet_id: targetPlanetInfo.planetId,
        p_fer: resources.fer ?? 0,
        p_silice: resources.silice ?? 0,
        p_xenogas: resources.xenogas ?? 0,
      });
    }
  }

  await supabase.from('fleet_missions').update({
    status: 'completed',
    processed: true,
    mission_phase: 'completed',
    completed_at: new Date().toISOString(),
    result: { type: 'station', delivered_ships: ships, delivered_resources: resources },
  }).eq('id', mission.id);

  console.log('[WorldTick] Station mission completed:', mission.id);
}

async function processArrivedFleets(): Promise<number> {
  const now = Date.now();
  const { data: arrived, error } = await supabase
    .from('fleet_missions')
    .select('*')
    .eq('mission_phase', 'en_route')
    .eq('processed', false)
    .lte('arrival_time', now);

  if (error || !arrived?.length) return 0;

  let count = 0;
  for (const mission of arrived) {
    const { data: claimed } = await supabase
      .from('fleet_missions')
      .update({ processed: true, mission_phase: 'arrived' })
      .eq('id', mission.id)
      .eq('processed', false)
      .select();

    if (!claimed?.length) {
      console.log('[WorldTick] Mission already claimed:', mission.id);
      continue;
    }

    try {
      const missionType = mission.mission_type as string;
      if (missionType === 'espionage') {
        await processEspionageMission(mission);
      } else if (missionType === 'attack') {
        await processAttackMission(mission);
      } else if (missionType === 'transport') {
        await processTransportMission(mission);
      } else if (missionType === 'recycle') {
        await processRecycleMission(mission);
      } else if (missionType === 'colonize') {
        await processColonizeMission(mission);
      } else if (missionType === 'station') {
        await processStationMission(mission);
      } else {
        console.log('[WorldTick] Unknown mission type:', missionType);
      }
      count++;
    } catch (e) {
      console.log('[WorldTick] Error processing mission', mission.id, ':', e);
      await supabase.from('fleet_missions').update({ processed: false, mission_phase: 'en_route' }).eq('id', mission.id);
    }
  }

  if (count > 0) console.log('[WorldTick] Processed', count, 'arrived fleets');
  return count;
}

// ── Resource Production Update ──

const BATCH_SIZE = 5;

async function updateSinglePlanetResources(
  planet: PlanetRow,
  _now: number,
  _researchCache: Map<string, Record<string, number>>,
): Promise<boolean> {
  const lastUpdate = planet.last_update ?? _now;
  const elapsed = (_now - lastUpdate) / 1000;
  if (elapsed < 30) return false;

  const { data: result, error: rpcErr } = await supabase.rpc('materialize_planet_resources', {
    p_planet_id: planet.id,
    p_user_id: planet.user_id,
  });

  if (rpcErr) {
    console.log('[WorldTick] materialize_planet_resources error for planet', planet.id, ':', rpcErr.message);
    return false;
  }

  const matResult = result as { success?: boolean; skipped?: boolean; created?: boolean } | null;
  if (matResult?.skipped) return false;

  return true;
}

async function updateAllPlanetResources(): Promise<number> {
  const now = Date.now();
  const staleThreshold = now - 60_000;

  const { data: planets, error } = await supabase
    .from('planets')
    .select('id, user_id, last_update')
    .lt('last_update', staleThreshold)
    .limit(100);

  if (error) {
    console.log('[WorldTick] Error fetching stale planets:', error.message);
    return 0;
  }
  if (!planets?.length) return 0;

  console.log('[WorldTick] Found', planets.length, 'stale planets to update');

  const researchCache = new Map<string, Record<string, number>>();
  let count = 0;

  for (let i = 0; i < planets.length; i += BATCH_SIZE) {
    const batch = (planets as PlanetRow[]).slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(planet => updateSinglePlanetResources(planet, now, researchCache).catch(e => {
        console.log('[WorldTick] Error updating planet', planet.id, ':', e);
        return false;
      }))
    );
    count += results.filter(Boolean).length;
  }

  if (count > 0) console.log('[WorldTick] Updated resources for', count, 'planets');
  return count;
}

// ── Score Recalculation ──

let lastScoreRecalcTime = 0;
const SCORE_RECALC_INTERVAL = 60_000;

async function recalcAllScores(): Promise<number> {
  const now = Date.now();
  if (now - lastScoreRecalcTime < SCORE_RECALC_INTERVAL) return 0;

  lastScoreRecalcTime = now;

  const { data, error } = await supabase.rpc('recalc_all_player_scores');

  if (error) {
    console.log('[WorldTick] recalc_all_player_scores error:', error.message);
    return 0;
  }

  const res = data as { success?: boolean; players_updated?: number } | null;
  const count = res?.players_updated ?? 0;

  if (count > 0) {
    console.log('[WorldTick] Recalculated scores for', count, 'players');
  }

  return count;
}

// ── Main Tick ──

let isRunning = false;
let skippedTicks = 0;
let lastTickDuration = 0;
let lastSuccessfulTickTime = Date.now();

export async function runWorldTick(): Promise<{
  timers: number;
  queues: number;
  arrivals: number;
  returns: number;
  resources: number;
}> {
  if (isRunning) {
    skippedTicks++;
    const timeSinceLastTick = Date.now() - lastSuccessfulTickTime;
    console.log(`[WorldTick] Already running, skipping (skipped=${skippedTicks}, lastDuration=${lastTickDuration}ms, timeSinceLastSuccess=${timeSinceLastTick}ms)`);
    return { timers: 0, queues: 0, arrivals: 0, returns: 0, resources: 0 };
  }

  isRunning = true;
  const start = Date.now();
  const currentSkipped = skippedTicks;
  skippedTicks = 0;

  try {
    if (currentSkipped > 0) {
      console.log(`[WorldTick] Resuming after ${currentSkipped} skipped ticks`);
    }

    const [timers, queues, arrivals, returns] = await Promise.all([
      processExpiredTimers().catch(e => { console.log('[WorldTick] Timer error:', e); return 0; }),
      processExpiredShipyardQueues().catch(e => { console.log('[WorldTick] Queue error:', e); return 0; }),
      processArrivedFleets().catch(e => { console.log('[WorldTick] Fleet arrival error:', e); return 0; }),
      processReturningFleets().catch(e => { console.log('[WorldTick] Fleet return error:', e); return 0; }),
    ]);

    const resources = await updateAllPlanetResources().catch(e => { console.log('[WorldTick] Resource error:', e); return 0; });

    const scores = await recalcAllScores().catch(e => { console.log('[WorldTick] Score recalc error:', e); return 0; });

    const duration = Date.now() - start;
    lastTickDuration = duration;
    lastSuccessfulTickTime = Date.now();

    const total = timers + queues + arrivals + returns + resources + scores;
    if (total > 0 || duration > 3000) {
      console.log(`[WorldTick] Tick complete in ${duration}ms: timers=${timers} queues=${queues} arrivals=${arrivals} returns=${returns} resources=${resources} scores=${scores}${currentSkipped > 0 ? ` (after ${currentSkipped} skipped)` : ''}`);
    }

    if (duration > 4000) {
      console.log(`[WorldTick] WARNING: Tick took ${duration}ms, exceeding safe threshold. Consider scaling.`);
    }

    return { timers, queues, arrivals, returns, resources };
  } catch (e) {
    console.log('[WorldTick] Critical tick error:', e);
    return { timers: 0, queues: 0, arrivals: 0, returns: 0, resources: 0 };
  } finally {
    isRunning = false;
  }
}

// ── Auto-Scheduler ──

let tickInterval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let lastHeartbeat = Date.now();

export function startWorldTickLoop(intervalMs: number = 5000): void {
  if (tickInterval) {
    console.log('[WorldTick] Loop already running');
    return;
  }

  console.log(`[WorldTick] Starting world tick loop every ${intervalMs}ms`);
  tickInterval = setInterval(() => {
    tickCount++;
    const now = Date.now();
    if (now - lastHeartbeat >= 300_000) {
      console.log(`[WorldTick] ♥ Heartbeat: ${tickCount} ticks executed, skipped=${skippedTicks}, lastDuration=${lastTickDuration}ms, uptime ${Math.round((now - startedAt) / 60_000)}min`);
      lastHeartbeat = now;
    }
    void runWorldTick();
  }, intervalMs);

  void runWorldTick();
}

const startedAt = Date.now();

export function stopWorldTickLoop(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log('[WorldTick] Loop stopped');
  }
}
