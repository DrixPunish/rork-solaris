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

async function findPlanetByCoords(userId: string, coords: number[]): Promise<string | null> {
  const { data } = await supabase
    .from('planets')
    .select('id')
    .eq('user_id', userId)
    .filter('coordinates->>0', 'eq', String(coords[0]))
    .filter('coordinates->>1', 'eq', String(coords[1]))
    .filter('coordinates->>2', 'eq', String(coords[2]))
    .single();
  return data?.id ?? null;
}

async function processReturningFleets(): Promise<number> {
  const now = Date.now();
  const { data: returning, error } = await supabase
    .from('fleet_missions')
    .select('*')
    .eq('status', 'returning')
    .not('return_time', 'is', null)
    .lte('return_time', now);

  if (error || !returning?.length) return 0;

  let count = 0;
  for (const mission of returning) {
    const { data: claimed } = await supabase
      .from('fleet_missions')
      .update({ status: 'completed' })
      .eq('id', mission.id)
      .eq('status', 'returning')
      .select();

    if (!claimed?.length) continue;

    const senderCoords = mission.sender_coords as number[];
    const senderPlanetId = await findPlanetByCoords(mission.sender_id, senderCoords);

    if (!senderPlanetId) {
      console.log('[WorldTick] Sender planet not found for return:', mission.id);
      continue;
    }

    const ships = (mission.ships ?? {}) as Record<string, number>;
    for (const [shipId, qty] of Object.entries(ships)) {
      if (typeof qty !== 'number' || qty <= 0) continue;
      const { data: existing } = await supabase
        .from('planet_ships')
        .select('quantity')
        .eq('planet_id', senderPlanetId)
        .eq('ship_id', shipId)
        .single();

      await supabase.from('planet_ships').upsert({
        planet_id: senderPlanetId,
        ship_id: shipId,
        quantity: (existing?.quantity ?? 0) + qty,
      }, { onConflict: 'planet_id,ship_id' });
    }

    const res = mission.resources as { fer?: number; silice?: number; xenogas?: number } | null;
    if (res && ((res.fer ?? 0) > 0 || (res.silice ?? 0) > 0 || (res.xenogas ?? 0) > 0)) {
      const { error: rpcErr } = await supabase.rpc('add_resources_to_planet', {
        p_planet_id: senderPlanetId,
        p_fer: res.fer ?? 0,
        p_silice: res.silice ?? 0,
        p_xenogas: res.xenogas ?? 0,
      });
      if (rpcErr) console.log('[WorldTick] Error adding return resources:', rpcErr.message);
    }

    console.log('[WorldTick] Fleet returned:', mission.id, 'ships:', JSON.stringify(ships));
    count++;
  }

  if (count > 0) console.log('[WorldTick] Processed', count, 'fleet returns');
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

  await supabase.from('fleet_missions').update({
    status: survivingProbes > 0 ? 'returning' : 'completed',
    processed: true,
    return_time: survivingProbes > 0 ? returnTime : null,
    ships: resultShips,
    result: { type: 'espionage', probes_sent: probesSent, probes_lost: espResult.probesLost },
  }).eq('id', mission.id);

  console.log('[WorldTick][Espionage] === DONE === mission', mission.id, 'survivingProbes:', survivingProbes, 'status:', survivingProbes > 0 ? 'returning' : 'completed');
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

  await supabase.from('fleet_missions').update({
    status: hasShips ? 'returning' : 'completed',
    processed: true,
    return_time: hasShips ? returnTime : null,
    ships: combatResult.attackerSurvivingShips,
    resources: combatResult.loot,
    result: { type: 'combat', outcome: combatResult.result, loot: combatResult.loot },
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
  const _targetPlayerId = mission.target_player_id as string | null;
  void _targetPlayerId;

  const { data: existingPlanets } = await supabase
    .from('planets')
    .select('id')
    .filter('coordinates->>0', 'eq', String(targetCoords[0]))
    .filter('coordinates->>1', 'eq', String(targetCoords[1]))
    .filter('coordinates->>2', 'eq', String(targetCoords[2]))
    .limit(1);

  const isOccupied = (existingPlanets?.length ?? 0) > 0;
  const travelTime = (mission.arrival_time as number) - (mission.departure_time as number);
  const returnTime = (mission.arrival_time as number) + travelTime;

  if (isOccupied) {
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Position déjà occupée' },
    }).eq('id', mission.id);
    console.log('[WorldTick] Colonize failed (occupied):', mission.id);
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
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Nombre maximum de colonies atteint' },
    }).eq('id', mission.id);
    console.log('[WorldTick] Colonize failed (max colonies):', mission.id);
    return;
  }

  const { data: newPlanet, error: insertErr } = await supabase.from('planets').insert({
    user_id: senderId,
    planet_name: `Colonie ${currentColonies + 1}`,
    coordinates: targetCoords,
    is_main: false,
    last_update: Date.now(),
  }).select('id').single();

  if (insertErr || !newPlanet) {
    console.log('[WorldTick] Error creating colony planet:', insertErr?.message);
    await supabase.from('fleet_missions').update({
      status: 'returning',
      processed: true,
      return_time: returnTime,
      ships,
      result: { type: 'colonize', success: false, reason: 'Erreur création colonie' },
    }).eq('id', mission.id);
    return;
  }

  await supabase.from('planet_resources').insert({
    planet_id: newPlanet.id,
    fer: 500,
    silice: 300,
    xenogas: 0,
    energy: 0,
  });

  const returningShips = { ...ships };
  const colonyShipCount = returningShips.colonyShip ?? 0;
  if (colonyShipCount > 1) {
    returningShips.colonyShip = colonyShipCount - 1;
  } else {
    delete returningShips.colonyShip;
  }

  const hasReturning = Object.values(returningShips).some(c => c > 0);

  await supabase.from('fleet_missions').update({
    status: hasReturning ? 'returning' : 'completed',
    processed: true,
    return_time: hasReturning ? returnTime : null,
    ships: returningShips,
    result: { type: 'colonize', success: true, colonyId: newPlanet.id },
  }).eq('id', mission.id);

  console.log('[WorldTick] Colony created:', newPlanet.id, 'at', targetCoords);
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
    result: { type: 'station', delivered_ships: ships, delivered_resources: resources },
  }).eq('id', mission.id);

  console.log('[WorldTick] Station mission completed:', mission.id);
}

async function processArrivedFleets(): Promise<number> {
  const now = Date.now();
  const { data: arrived, error } = await supabase
    .from('fleet_missions')
    .select('*')
    .eq('status', 'traveling')
    .eq('processed', false)
    .lte('arrival_time', now);

  if (error || !arrived?.length) return 0;

  let count = 0;
  for (const mission of arrived) {
    const { data: claimed } = await supabase
      .from('fleet_missions')
      .update({ processed: true })
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
      await supabase.from('fleet_missions').update({ processed: false }).eq('id', mission.id);
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

    const duration = Date.now() - start;
    lastTickDuration = duration;
    lastSuccessfulTickTime = Date.now();

    const total = timers + queues + arrivals + returns + resources;
    if (total > 0 || duration > 3000) {
      console.log(`[WorldTick] Tick complete in ${duration}ms: timers=${timers} queues=${queues} arrivals=${arrivals} returns=${returns} resources=${resources}${currentSkipped > 0 ? ` (after ${currentSkipped} skipped)` : ''}`);
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
