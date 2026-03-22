import { supabase } from './supabase';
import { GameState, Colony, ShipyardQueueItem, UpgradeTimer } from '@/types/game';
import { calculateProduction, getResourceStorageCapacity } from './gameCalculations';

export async function getMainPlanetId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('planets')
    .select('id')
    .eq('user_id', userId)
    .eq('is_main', true)
    .single();
  return data?.id ?? null;
}

interface TimerRow {
  id: string;
  planet_id: string | null;
  timer_type: string;
  target_id: string;
  target_level: number;
  start_time: number;
  end_time: number;
}

interface QueueRow {
  planet_id?: string;
  item_id: string;
  item_type: string;
  total_quantity: number;
  remaining_quantity: number;
  build_time_per_unit: number;
  current_unit_start_time: number;
  current_unit_end_time: number;
}

function parseBuildingsFromRows(rows: Array<{ building_id: string; level: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const r of rows) result[r.building_id] = r.level;
  return result;
}

function parseShipsFromRows(rows: Array<{ ship_id: string; quantity: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const r of rows) if (r.quantity > 0) result[r.ship_id] = r.quantity;
  return result;
}

function parseDefensesFromRows(rows: Array<{ defense_id: string; quantity: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const r of rows) if (r.quantity > 0) result[r.defense_id] = r.quantity;
  return result;
}

function parseTimersForPlanet(allTimers: TimerRow[], planetId: string): UpgradeTimer[] {
  return allTimers
    .filter(r => r.planet_id === planetId || (!r.planet_id && r.timer_type === 'research'))
    .map(r => ({
      id: r.target_id,
      type: r.timer_type as 'building' | 'research',
      targetLevel: r.target_level,
      startTime: r.start_time,
      endTime: r.end_time,
    }));
}

function parseQueueForPlanet(allQueue: QueueRow[], planetId: string): ShipyardQueueItem[] {
  return allQueue
    .filter(r => r.planet_id === planetId)
    .map(r => ({
      id: r.item_id,
      type: r.item_type as 'ship' | 'defense',
      totalQuantity: r.total_quantity,
      remainingQuantity: r.remaining_quantity,
      buildTimePerUnit: r.build_time_per_unit,
      currentUnitStartTime: r.current_unit_start_time,
      currentUnitEndTime: r.current_unit_end_time,
    }));
}

function parseCoords(raw: unknown): [number, number, number] {
  if (Array.isArray(raw)) return [raw[0] ?? 1, raw[1] ?? 1, raw[2] ?? 1];
  return [1, 1, 1];
}

export async function loadStateFromTables(targetUserId: string): Promise<{ state: GameState; planetId: string } | null> {
  console.log('[tableSync] Loading state from tables for', targetUserId);

  const { data: planet } = await supabase
    .from('planets')
    .select('id, planet_name, coordinates, last_update')
    .eq('user_id', targetUserId)
    .eq('is_main', true)
    .single();

  if (!planet) {
    console.log('[tableSync] No main planet found');
    return null;
  }

  const planetId = planet.id as string;

  const [resRes, buildRes, researchRes, shipsRes, defensesRes, timersRes, queueRes, playerRes] = await Promise.all([
    supabase.from('planet_resources').select('fer, silice, xenogas, energy').eq('planet_id', planetId).single(),
    supabase.from('planet_buildings').select('building_id, level').eq('planet_id', planetId),
    supabase.from('player_research').select('research_id, level').eq('user_id', targetUserId),
    supabase.from('planet_ships').select('ship_id, quantity').eq('planet_id', planetId),
    supabase.from('planet_defenses').select('defense_id, quantity').eq('planet_id', planetId),
    supabase.from('active_timers').select('id, planet_id, timer_type, target_id, target_level, start_time, end_time').eq('user_id', targetUserId),
    supabase.from('shipyard_queue').select('planet_id, item_id, item_type, total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time').eq('planet_id', planetId),
    supabase.from('players').select('username, solar').eq('user_id', targetUserId).single(),
  ]);

  const buildings = parseBuildingsFromRows((buildRes.data ?? []) as Array<{ building_id: string; level: number }>);
  const research: Record<string, number> = {};
  for (const r of (researchRes.data ?? []) as Array<{ research_id: string; level: number }>) {
    research[r.research_id] = r.level;
  }
  const ships = parseShipsFromRows((shipsRes.data ?? []) as Array<{ ship_id: string; quantity: number }>);
  const defenses = parseDefensesFromRows((defensesRes.data ?? []) as Array<{ defense_id: string; quantity: number }>);
  const activeTimers = parseTimersForPlanet((timersRes.data ?? []) as TimerRow[], planetId);
  const shipyardQueue = parseQueueForPlanet((queueRes.data ?? []) as QueueRow[], planetId);

  const resData = resRes.data as { fer?: number; silice?: number; xenogas?: number; energy?: number } | null;
  const plData = playerRes.data as { username?: string; solar?: number } | null;

  const state: GameState = {
    planetName: (planet.planet_name as string) ?? 'Homeworld',
    coordinates: parseCoords(planet.coordinates),
    buildings,
    research,
    ships,
    defenses,
    resources: {
      fer: resData?.fer ?? 0,
      silice: resData?.silice ?? 0,
      xenogas: resData?.xenogas ?? 0,
      energy: resData?.energy ?? 0,
    },
    solar: plData?.solar ?? 500,
    lastUpdate: (planet.last_update as number) ?? Date.now(),
    activeTimers,
    shipyardQueue,
    username: plData?.username ?? '',
  };

  console.log('[tableSync] Loaded. Resources:', {
    fer: Math.floor(state.resources.fer),
    silice: Math.floor(state.resources.silice),
    xenogas: Math.floor(state.resources.xenogas),
  });

  return { state, planetId };
}

function recalcPlanetResources(
  rawRes: { fer: number; silice: number; xenogas: number; energy: number },
  buildings: Record<string, number>,
  research: Record<string, number>,
  ships: Record<string, number>,
  lastUpdate: number,
  now: number,
): { fer: number; silice: number; xenogas: number; energy: number } {
  const elapsed = Math.max(0, (now - lastUpdate) / 1000);
  if (elapsed < 2) return rawRes;

  const prod = calculateProduction(buildings, research, ships);
  const storage = getResourceStorageCapacity(buildings);

  return {
    fer: rawRes.fer >= storage.fer ? rawRes.fer : Math.min(rawRes.fer + (prod.fer / 3600) * elapsed, storage.fer),
    silice: rawRes.silice >= storage.silice ? rawRes.silice : Math.min(rawRes.silice + (prod.silice / 3600) * elapsed, storage.silice),
    xenogas: rawRes.xenogas >= storage.xenogas ? rawRes.xenogas : Math.min(rawRes.xenogas + (prod.xenogas / 3600) * elapsed, storage.xenogas),
    energy: prod.energy,
  };
}

export async function loadFullStateFromTables(userId: string): Promise<GameState | null> {
  console.log('[tableSync] Loading full state (main + colonies) from tables for', userId);

  const { data: allPlanets } = await supabase
    .from('planets')
    .select('id, planet_name, coordinates, is_main, last_update, production_percentages')
    .eq('user_id', userId);

  if (!allPlanets || allPlanets.length === 0) {
    console.log('[tableSync] No planets found');
    return null;
  }

  const mainPlanet = allPlanets.find((p: { is_main: boolean }) => p.is_main);
  if (!mainPlanet) {
    console.log('[tableSync] No main planet found');
    return null;
  }

  const mainPlanetId = mainPlanet.id as string;
  const allPlanetIds = allPlanets.map((p: { id: string }) => p.id as string);
  const colonyPlanets = allPlanets.filter((p: { is_main: boolean }) => !p.is_main);

  const [resRes, buildRes, researchRes, shipsRes, defensesRes, timersRes, queueRes, playerRes] = await Promise.all([
    supabase.from('planet_resources').select('planet_id, fer, silice, xenogas, energy').in('planet_id', allPlanetIds),
    supabase.from('planet_buildings').select('planet_id, building_id, level').in('planet_id', allPlanetIds),
    supabase.from('player_research').select('research_id, level').eq('user_id', userId),
    supabase.from('planet_ships').select('planet_id, ship_id, quantity').in('planet_id', allPlanetIds),
    supabase.from('planet_defenses').select('planet_id, defense_id, quantity').in('planet_id', allPlanetIds),
    supabase.from('active_timers').select('id, planet_id, timer_type, target_id, target_level, start_time, end_time').eq('user_id', userId),
    supabase.from('shipyard_queue').select('planet_id, item_id, item_type, total_quantity, remaining_quantity, build_time_per_unit, current_unit_start_time, current_unit_end_time').in('planet_id', allPlanetIds),
    supabase.from('players').select('username, solar').eq('user_id', userId).single(),
  ]);

  type ResRow = { planet_id: string; fer?: number; silice?: number; xenogas?: number; energy?: number };
  type BuildRow = { planet_id: string; building_id: string; level: number };
  type ShipRow = { planet_id: string; ship_id: string; quantity: number };
  type DefRow = { planet_id: string; defense_id: string; quantity: number };

  const allResources = (resRes.data ?? []) as ResRow[];
  const allBuildings = (buildRes.data ?? []) as BuildRow[];
  const allShips = (shipsRes.data ?? []) as ShipRow[];
  const allDefenses = (defensesRes.data ?? []) as DefRow[];
  const allTimers = (timersRes.data ?? []) as TimerRow[];
  const allQueue = (queueRes.data ?? []) as QueueRow[];

  const getResForPlanet = (pid: string) => {
    const r = allResources.find(x => x.planet_id === pid);
    return { fer: r?.fer ?? 0, silice: r?.silice ?? 0, xenogas: r?.xenogas ?? 0, energy: r?.energy ?? 0 };
  };
  const getBuildingsForPlanet = (pid: string) => parseBuildingsFromRows(allBuildings.filter(x => x.planet_id === pid));
  const getShipsForPlanet = (pid: string) => parseShipsFromRows(allShips.filter(x => x.planet_id === pid));
  const getDefensesForPlanet = (pid: string) => parseDefensesFromRows(allDefenses.filter(x => x.planet_id === pid));

  const research: Record<string, number> = {};
  for (const r of (researchRes.data ?? []) as Array<{ research_id: string; level: number }>) {
    research[r.research_id] = r.level;
  }

  const plData = playerRes.data as { username?: string; solar?: number } | null;
  const now = Date.now();

  const mainBuildings = getBuildingsForPlanet(mainPlanetId);
  const mainShips = getShipsForPlanet(mainPlanetId);
  const mainRawRes = getResForPlanet(mainPlanetId);
  const mainLastUpdate = (mainPlanet.last_update as number) ?? now;
  const mainFreshRes = recalcPlanetResources(mainRawRes, mainBuildings, research, mainShips, mainLastUpdate, now);
  const mainElapsed = (now - mainLastUpdate) / 1000;

  if (mainElapsed > 2) {
    console.log('[tableSync] Client-side recalc for display only (no DB write). Main planet offline for', Math.floor(mainElapsed), 's');
  }

  const colonies: Colony[] = [];

  for (const cp of colonyPlanets as Array<{ id: string; planet_name: string; coordinates: unknown; last_update: unknown; production_percentages: unknown }>) {
    const cpId = cp.id as string;
    const colBuildings = getBuildingsForPlanet(cpId);
    const colShips = getShipsForPlanet(cpId);
    const colRawRes = getResForPlanet(cpId);
    const colLastUpdate = (cp.last_update as number) ?? now;
    const colFreshRes = recalcPlanetResources(colRawRes, colBuildings, research, colShips, colLastUpdate, now);
    const colElapsed = (now - colLastUpdate) / 1000;

    if (colElapsed > 2) {
      console.log('[tableSync] Client-side recalc for display only (no DB write). Colony', cpId, 'offline for', Math.floor(colElapsed), 's');
    }

    const colProdPct = cp.production_percentages as { ferMine: number; siliceMine: number; xenogasRefinery: number; solarPlant: number; heliosRemorqueur: number } | null;
    colonies.push({
      id: cpId,
      planetName: (cp.planet_name as string) ?? 'Colony',
      coordinates: parseCoords(cp.coordinates),
      buildings: colBuildings,
      ships: colShips,
      defenses: getDefensesForPlanet(cpId),
      resources: colFreshRes,
      activeTimers: parseTimersForPlanet(allTimers, cpId).filter(t => t.type === 'building'),
      shipyardQueue: parseQueueForPlanet(allQueue, cpId),
      lastUpdate: now,
      productionPercentages: colProdPct ?? undefined,
    });
  }



  const mainProdPct = (mainPlanet as { production_percentages: unknown }).production_percentages as { ferMine: number; siliceMine: number; xenogasRefinery: number; solarPlant: number; heliosRemorqueur: number } | null;
  const state: GameState = {
    planetName: (mainPlanet.planet_name as string) ?? 'Homeworld',
    coordinates: parseCoords(mainPlanet.coordinates),
    buildings: mainBuildings,
    research,
    ships: mainShips,
    defenses: getDefensesForPlanet(mainPlanetId),
    resources: mainFreshRes,
    solar: plData?.solar ?? 500,
    lastUpdate: now,
    activeTimers: parseTimersForPlanet(allTimers, mainPlanetId),
    shipyardQueue: parseQueueForPlanet(allQueue, mainPlanetId),
    username: plData?.username ?? '',
    colonies: colonies.length > 0 ? colonies : undefined,
    productionPercentages: mainProdPct ?? undefined,
  };

  console.log('[tableSync] Full state loaded (recalculated). Main resources:', {
    fer: Math.floor(state.resources.fer),
    silice: Math.floor(state.resources.silice),
    xenogas: Math.floor(state.resources.xenogas),
  }, 'Colonies:', colonies.length);

  return state;
}

export async function saveMaterializedToTables(
  planetId: string,
  userId: string,
  state: GameState,
): Promise<void> {
  try {
    await supabase.from('planets').update({
      last_update: state.lastUpdate,
      planet_name: state.planetName,
    }).eq('id', planetId);

    const buildingRows = Object.entries(state.buildings).map(([building_id, level]) => ({
      planet_id: planetId,
      building_id,
      level,
    }));
    if (buildingRows.length > 0) {
      await supabase.from('planet_buildings').upsert(buildingRows, { onConflict: 'planet_id,building_id' });
    }

    const researchRows = Object.entries(state.research).map(([research_id, level]) => ({
      user_id: userId,
      research_id,
      level,
    }));
    if (researchRows.length > 0) {
      await supabase.from('player_research').upsert(researchRows, { onConflict: 'user_id,research_id' });
    }

    const shipRows = Object.entries(state.ships).map(([ship_id, quantity]) => ({
      planet_id: planetId,
      ship_id,
      quantity,
    }));
    if (shipRows.length > 0) {
      await supabase.from('planet_ships').upsert(shipRows, { onConflict: 'planet_id,ship_id' });
    }

    const defenseRows = Object.entries(state.defenses).map(([defense_id, quantity]) => ({
      planet_id: planetId,
      defense_id,
      quantity,
    }));
    if (defenseRows.length > 0) {
      await supabase.from('planet_defenses').upsert(defenseRows, { onConflict: 'planet_id,defense_id' });
    }

    await syncTimersToTable(userId, planetId, state.activeTimers);
    await syncShipyardQueueToTable(planetId, state.shipyardQueue);

    console.log('[tableSync] Saved materialized state to tables');
  } catch (e) {
    console.log('[tableSync] Error saving to tables:', e);
  }
}

export async function syncTimersToTable(
  userId: string,
  planetId: string,
  timers: UpgradeTimer[],
): Promise<void> {
  try {
    const now = Date.now();
    await supabase.from('active_timers').delete().eq('planet_id', planetId).gt('end_time', now);
    const researchTimersWithoutPlanet = timers.filter(t => t.type === 'research');
    if (researchTimersWithoutPlanet.length > 0) {
      await supabase.from('active_timers').delete().eq('user_id', userId).eq('timer_type', 'research').gt('end_time', now);
    }

    const expiredInDb = await supabase.from('active_timers').select('target_id, timer_type').eq('planet_id', planetId).lte('end_time', now);
    if (expiredInDb.data && expiredInDb.data.length > 0) {
      console.log('[tableSync] Leaving', expiredInDb.data.length, 'expired timers for backend to process');
    }

    if (timers.length > 0) {
      const timerRows = timers.map(t => ({
        user_id: userId,
        planet_id: t.type === 'research' ? null : planetId,
        timer_type: t.type,
        target_id: t.id,
        target_level: t.targetLevel,
        start_time: t.startTime,
        end_time: t.endTime,
      }));
      const { error } = await supabase.from('active_timers').insert(timerRows);
      if (error) {
        console.log('[tableSync] Error inserting timers:', error.message);
      } else {
        console.log('[tableSync] Synced', timers.length, 'active timers to DB');
      }
    } else {
      console.log('[tableSync] No active timers to sync (expired ones left for backend)');
    }
  } catch (e) {
    console.log('[tableSync] Error syncing timers:', e);
  }
}

export async function syncShipyardQueueToTable(
  planetId: string,
  queue: ShipyardQueueItem[],
): Promise<void> {
  try {
    await supabase.from('shipyard_queue').delete().eq('planet_id', planetId);

    if (queue.length > 0) {
      const queueRows = queue.map(q => ({
        planet_id: planetId,
        item_id: q.id,
        item_type: q.type,
        total_quantity: q.totalQuantity,
        remaining_quantity: q.remainingQuantity,
        build_time_per_unit: q.buildTimePerUnit,
        current_unit_start_time: q.currentUnitStartTime,
        current_unit_end_time: q.currentUnitEndTime,
      }));
      const { error } = await supabase.from('shipyard_queue').insert(queueRows);
      if (error) {
        console.log('[tableSync] Error inserting shipyard queue:', error.message);
      } else {
        console.log('[tableSync] Synced', queue.length, 'shipyard queue items to DB');
      }
    }
  } catch (e) {
    console.log('[tableSync] Error syncing shipyard queue:', e);
  }
}

export async function syncFullStateToTables(userId: string, state: GameState): Promise<void> {
  try {
    let planetId = await getMainPlanetId(userId);

    if (!planetId) {
      const { data: newPlanet, error } = await supabase
        .from('planets')
        .insert({
          user_id: userId,
          planet_name: state.planetName,
          coordinates: state.coordinates,
          is_main: true,
          last_update: state.lastUpdate,
        })
        .select('id')
        .single();

      if (error || !newPlanet) {
        console.log('[tableSync] Error creating planet:', error?.message);
        return;
      }
      planetId = newPlanet.id as string;

      await supabase.from('planet_resources').insert({
        planet_id: planetId,
        fer: state.resources.fer,
        silice: state.resources.silice,
        xenogas: state.resources.xenogas,
        energy: state.resources.energy,
      });
    }

    await saveMaterializedToTables(planetId, userId, state);

    await supabase.from('players').update({
      solar: state.solar,
    }).eq('user_id', userId);

    await syncColoniesToPlanetsTable(userId, state);

  } catch (e) {
    console.log('[tableSync] Error in full sync:', e);
  }
}

async function saveColonyToTables(planetId: string, userId: string, colony: Colony, _research: Record<string, number>): Promise<void> {
  try {
    const buildingRows = Object.entries(colony.buildings).map(([building_id, level]) => ({
      planet_id: planetId,
      building_id,
      level,
    }));
    if (buildingRows.length > 0) {
      await supabase.from('planet_buildings').upsert(buildingRows, { onConflict: 'planet_id,building_id' });
    }

    const shipRows = Object.entries(colony.ships).map(([ship_id, quantity]) => ({
      planet_id: planetId,
      ship_id,
      quantity,
    }));
    if (shipRows.length > 0) {
      await supabase.from('planet_ships').upsert(shipRows, { onConflict: 'planet_id,ship_id' });
    }

    const defenseRows = Object.entries(colony.defenses).map(([defense_id, quantity]) => ({
      planet_id: planetId,
      defense_id,
      quantity,
    }));
    if (defenseRows.length > 0) {
      await supabase.from('planet_defenses').upsert(defenseRows, { onConflict: 'planet_id,defense_id' });
    }

    const buildingTimers = (colony.activeTimers ?? []).filter(t => t.type === 'building');
    if (buildingTimers.length > 0) {
      await supabase.from('active_timers').delete().eq('planet_id', planetId);
      const timerRows = buildingTimers.map(t => ({
        user_id: userId,
        planet_id: planetId,
        timer_type: t.type,
        target_id: t.id,
        target_level: t.targetLevel,
        start_time: t.startTime,
        end_time: t.endTime,
      }));
      const { error: timerErr } = await supabase.from('active_timers').insert(timerRows);
      if (timerErr) {
        console.log('[tableSync] Error inserting colony timers:', timerErr.message);
      }
    } else {
      await supabase.from('active_timers').delete().eq('planet_id', planetId);
    }

    await syncShipyardQueueToTable(planetId, colony.shipyardQueue ?? []);

    console.log('[tableSync] Saved colony data (incl timers/queue) for planet', planetId);
  } catch (e) {
    console.log('[tableSync] Error saving colony to tables:', e);
  }
}

export async function syncColoniesToPlanetsTable(userId: string, state: GameState): Promise<void> {
  try {
    const colonies = state.colonies ?? [];

    const { data: existingColonies } = await supabase
      .from('planets')
      .select('id, coordinates')
      .eq('user_id', userId)
      .eq('is_main', false);

    const existingMap = new Map<string, string>();
    for (const ec of (existingColonies ?? [])) {
      const coords = ec.coordinates as [number, number, number];
      const key = `${coords[0]}:${coords[1]}:${coords[2]}`;
      existingMap.set(key, ec.id as string);
    }

    const currentColonyKeys = new Set<string>();
    for (const colony of colonies) {
      const key = `${colony.coordinates[0]}:${colony.coordinates[1]}:${colony.coordinates[2]}`;
      currentColonyKeys.add(key);

      if (existingMap.has(key)) {
        const colonyPlanetId = existingMap.get(key)!;
        await supabase.from('planets').update({
          planet_name: colony.planetName,
          last_update: colony.lastUpdate,
        }).eq('id', colonyPlanetId);
        await saveColonyToTables(colonyPlanetId, userId, colony, state.research);
      } else {
        console.log('[tableSync] Inserting colony into planets table at', colony.coordinates);
        const { data: newPlanet, error } = await supabase.from('planets').insert({
          user_id: userId,
          planet_name: colony.planetName,
          coordinates: colony.coordinates,
          is_main: false,
          last_update: colony.lastUpdate,
        }).select('id').single();

        if (!error && newPlanet) {
          await saveColonyToTables(newPlanet.id as string, userId, colony, state.research);
        }
      }
    }

    for (const [key, planetId] of existingMap.entries()) {
      if (!currentColonyKeys.has(key)) {
        console.log('[tableSync] Removing orphaned colony and related data:', planetId);
        await Promise.all([
          supabase.from('planet_resources').delete().eq('planet_id', planetId),
          supabase.from('planet_buildings').delete().eq('planet_id', planetId),
          supabase.from('planet_ships').delete().eq('planet_id', planetId),
          supabase.from('planet_defenses').delete().eq('planet_id', planetId),
          supabase.from('shipyard_queue').delete().eq('planet_id', planetId),
          supabase.from('active_timers').delete().eq('planet_id', planetId),
        ]);
        await supabase.from('planets').delete().eq('id', planetId);
      }
    }
  } catch (e) {
    console.log('[tableSync] Error syncing colonies:', e);
  }
}

export async function insertColonyIntoPlanetsTable(
  userId: string,
  planetName: string,
  coordinates: [number, number, number],
  initialResources?: { fer: number; silice: number; xenogas: number; energy: number },
): Promise<void> {
  try {
    console.log('[tableSync] Inserting new colony into planets table at', coordinates);
    const { data: newPlanet, error } = await supabase.from('planets').insert({
      user_id: userId,
      planet_name: planetName,
      coordinates,
      is_main: false,
      last_update: Date.now(),
    }).select('id').single();

    if (error || !newPlanet) {
      console.log('[tableSync] Error inserting colony:', error?.message);
      return;
    }

    const colonyPlanetId = newPlanet.id as string;
    console.log('[tableSync] Colony inserted into planets table, id:', colonyPlanetId);

    const resources = initialResources ?? { fer: 500, silice: 300, xenogas: 0, energy: 0 };
    await supabase.from('planet_resources').insert({
      planet_id: colonyPlanetId,
      fer: resources.fer,
      silice: resources.silice,
      xenogas: resources.xenogas,
      energy: resources.energy,
    });
    console.log('[tableSync] Colony planet_resources initialized');

  } catch (e) {
    console.log('[tableSync] Error inserting colony:', e);
  }
}

export async function removeColonyFromPlanetsTable(
  userId: string,
  coordinates: [number, number, number],
): Promise<void> {
  try {
    console.log('[tableSync] Removing colony from planets table at', coordinates);
    const { data: planet } = await supabase
      .from('planets')
      .select('id')
      .eq('user_id', userId)
      .eq('is_main', false)
      .filter('coordinates->>0', 'eq', String(coordinates[0]))
      .filter('coordinates->>1', 'eq', String(coordinates[1]))
      .filter('coordinates->>2', 'eq', String(coordinates[2]))
      .single();

    if (planet) {
      const planetId = planet.id as string;
      console.log('[tableSync] Cleaning up related tables for colony planet', planetId);
      await Promise.all([
        supabase.from('planet_resources').delete().eq('planet_id', planetId),
        supabase.from('planet_buildings').delete().eq('planet_id', planetId),
        supabase.from('planet_ships').delete().eq('planet_id', planetId),
        supabase.from('planet_defenses').delete().eq('planet_id', planetId),
        supabase.from('shipyard_queue').delete().eq('planet_id', planetId),
        supabase.from('active_timers').delete().eq('planet_id', planetId),
      ]);
      await supabase.from('planets').delete().eq('id', planetId);
      console.log('[tableSync] Colony and related data removed successfully');
    } else {
      console.log('[tableSync] Colony planet not found for removal at', coordinates);
    }
  } catch (e) {
    console.log('[tableSync] Error removing colony:', e);
  }
}

export async function isPositionOccupiedInPlanetsTable(
  coordinates: [number, number, number],
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('planets')
      .select('id')
      .filter('coordinates->>0', 'eq', String(coordinates[0]))
      .filter('coordinates->>1', 'eq', String(coordinates[1]))
      .filter('coordinates->>2', 'eq', String(coordinates[2]))
      .limit(1);
    if (error) {
      console.log('[tableSync] Error checking position:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.log('[tableSync] Error checking position:', e);
    return false;
  }
}
