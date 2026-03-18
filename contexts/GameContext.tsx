import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { GameState, Resources, UpgradeTimer, ShipyardQueueItem, Colony } from '@/types/game';
import { TutorialReward } from '@/constants/tutorial';
import { calculateProduction, calculateCost, canAfford, calculateSolarCost, getResourceStorageCapacity, calculateUpgradeTime, calculateResearchTime, calculateShipBuildTime } from '@/utils/gameCalculations';
import { BUILDINGS, RESEARCH, SHIPS, DEFENSES, DEFAULT_STATE } from '@/constants/gameData';
import { supabase } from '@/utils/supabase';
import { removeColonyFromPlanetsTable, loadFullStateFromTables, syncTimersToTable, syncShipyardQueueToTable, getMainPlanetId, syncFullStateToTables } from '@/utils/tableSync';
import { trpcClient } from '@/lib/trpc';

const STORAGE_KEY = 'solaris_game_state';

interface ServerSnapshot {
  resources: { fer: number; silice: number; xenogas: number };
  ships: Record<string, number>;
  defenses: Record<string, number>;
  savedAt: number;
}

function generateCoordinates(): [number, number, number] {
  const galaxy = 1;
  const system = Math.floor(Math.random() * 100) + 1;
  const position = Math.floor(Math.random() * 15) + 1;
  return [galaxy, system, position];
}

function processShipyardQueue(
  queue: ShipyardQueueItem[],
  ships: Record<string, number>,
  defenses: Record<string, number>,
  now: number,
): { queue: ShipyardQueueItem[]; ships: Record<string, number>; defenses: Record<string, number>; changed: boolean } {
  let changed = false;
  const newShips = { ...ships };
  const newDefenses = { ...defenses };
  const newQueue: ShipyardQueueItem[] = [];

  for (const item of queue) {
    let current = { ...item };
    while (now >= current.currentUnitEndTime && current.remainingQuantity > 0) {
      changed = true;
      if (current.type === 'ship') {
        newShips[current.id] = (newShips[current.id] ?? 0) + 1;
      } else {
        newDefenses[current.id] = (newDefenses[current.id] ?? 0) + 1;
      }
      current.remainingQuantity -= 1;
      if (current.remainingQuantity > 0) {
        current.currentUnitStartTime = current.currentUnitEndTime;
        current.currentUnitEndTime = current.currentUnitStartTime + current.buildTimePerUnit * 1000;
      }
    }
    if (current.remainingQuantity > 0) {
      newQueue.push(current);
    }
  }

  return { queue: newQueue, ships: newShips, defenses: newDefenses, changed };
}

function clampCoordinates(coords: [number, number, number]): [number, number, number] {
  const galaxy = Math.min(Math.max(coords[0], 1), 1);
  const system = Math.min(Math.max(coords[1], 1), 100);
  const position = Math.min(Math.max(coords[2], 1), 15);
  return [galaxy, system, position];
}

function processCompletedTimersAndQueue(parsed: GameState): GameState {
  const now = Date.now();
  const elapsed = (now - parsed.lastUpdate) / 1000;
  if (elapsed > 5) console.log('[GameContext] Processing timers/queue, elapsed', Math.floor(elapsed), 's');

  const completedTimers: UpgradeTimer[] = [];
  const activeTimers: UpgradeTimer[] = [];
  for (const timer of (parsed.activeTimers ?? [])) {
    if (now >= timer.endTime) {
      completedTimers.push(timer);
    } else {
      activeTimers.push(timer);
    }
  }

  let buildings = { ...parsed.buildings };
  let research = { ...parsed.research };
  for (const timer of completedTimers) {
    if (timer.type === 'building') {
      buildings[timer.id] = timer.targetLevel;
      console.log('[GameContext] Completed building', timer.id, 'to level', timer.targetLevel);
    } else if (timer.type === 'research') {
      research[timer.id] = timer.targetLevel;
      console.log('[GameContext] Completed research', timer.id, 'to level', timer.targetLevel);
    }
  }

  const shipyardResult = processShipyardQueue(
    parsed.shipyardQueue ?? [],
    parsed.ships ?? {},
    parsed.defenses ?? {},
    now,
  );

  const updatedColonies = (parsed.colonies ?? []).map(colony => {
    const colCompleted: UpgradeTimer[] = [];
    const colActive: UpgradeTimer[] = [];
    for (const t of (colony.activeTimers ?? [])) {
      if (now >= t.endTime) colCompleted.push(t);
      else colActive.push(t);
    }
    let colBuildings = { ...colony.buildings };
    for (const t of colCompleted) {
      if (t.type === 'building') {
        colBuildings[t.id] = t.targetLevel;
      } else if (t.type === 'research') {
        research = { ...research, [t.id]: t.targetLevel };
      }
    }
    const colShipyard = processShipyardQueue(colony.shipyardQueue ?? [], colony.ships, colony.defenses, now);
    return {
      ...colony,
      buildings: colBuildings,
      ships: colShipyard.ships,
      defenses: colShipyard.defenses,
      activeTimers: colActive,
      shipyardQueue: colShipyard.queue,
    };
  });

  return {
    ...parsed,
    coordinates: clampCoordinates(parsed.coordinates),
    buildings,
    research,
    ships: shipyardResult.ships,
    defenses: shipyardResult.defenses,
    solar: parsed.solar ?? 500,
    activeTimers,
    shipyardQueue: shipyardResult.queue,
    colonies: updatedColonies.length > 0 ? updatedColonies : parsed.colonies,
    lastUpdate: now,
  };
}

async function loadStateFromSupabase(userId: string): Promise<GameState | null> {
  console.log('[GameContext] Loading state from normalized tables for user', userId);
  const state = await loadFullStateFromTables(userId);
  if (state) {
    console.log('[GameContext] Found state in normalized tables');
    return state;
  }
  console.log('[GameContext] No state found in normalized tables for user', userId);
  return null;
}

async function saveStateToSupabase(userId: string, state: GameState, email: string): Promise<void> {
  const { error } = await supabase
    .from('players')
    .upsert({
      user_id: userId,
      email,
      username: state.username ?? '',
      planet_name: state.planetName,
      coordinates: state.coordinates,
      updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.log('[GameContext] Supabase save error:', error.message);
  }
}

export const [GameProvider, useGame] = createContextHook(() => {
  const [state, setState] = useState<GameState>(DEFAULT_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [activePlanetId, setActivePlanetId] = useState<string | null>(null);
  const mainPlanetIdRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSavedSnapshotRef = useRef<ServerSnapshot | null>(null);
  const isMergingRef = useRef(false);
  const [displayTick, setDisplayTick] = useState(0);
  const resourceSyncTimeRef = useRef(Date.now());
  const pendingActionsRef = useRef(new Set<string>());
  const [actionError, setActionError] = useState<string | null>(null);
  const solarCooldownsRef = useRef<Map<string, number>>(new Map());
  const SOLAR_COOLDOWN_MS = 3000;

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? '');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? '');
      } else {
        setUserId(null);
        setUserEmail('');
        setIsLoaded(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const stateQuery = useQuery({
    queryKey: ['gameState', userId],
    queryFn: async () => {
      console.log('[GameContext] Loading game state...');

      if (userId) {
        const supabaseState = await loadStateFromSupabase(userId);
        if (supabaseState) {
          console.log('[GameContext] Using Supabase state');
          const withProgress = processCompletedTimersAndQueue(supabaseState);
          lastSavedSnapshotRef.current = {
            resources: { fer: withProgress.resources.fer, silice: withProgress.resources.silice, xenogas: withProgress.resources.xenogas },
            ships: { ...withProgress.ships },
            defenses: { ...withProgress.defenses },
            savedAt: Date.now(),
          };
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withProgress));
          return withProgress;
        }

        console.log('[GameContext] New player - creating initial state');
        const coords = generateCoordinates();
        const newState: GameState = {
          ...DEFAULT_STATE,
          coordinates: coords,
          lastUpdate: Date.now(),
        };
        lastSavedSnapshotRef.current = {
          resources: { fer: newState.resources.fer, silice: newState.resources.silice, xenogas: newState.resources.xenogas },
          ships: { ...newState.ships },
          defenses: { ...newState.defenses },
          savedAt: Date.now(),
        };
        await saveStateToSupabase(userId, newState, userEmail);
        try {
          await syncFullStateToTables(userId, newState);
          console.log('[GameContext] New player: all tables initialized (planets, resources, buildings, etc.)');
        } catch (e) {
          console.log('[GameContext] Error initializing new player tables:', e);
        }
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        return newState;
      }

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GameState;
        return processCompletedTimersAndQueue(parsed);
      }

      console.log('[GameContext] No saved state, using defaults');
      return { ...DEFAULT_STATE, lastUpdate: Date.now() };
    },
    staleTime: Infinity,
    enabled: userId !== null,
  });

  useEffect(() => {
    if (stateQuery.data && !isLoaded) {
      setState(stateQuery.data);
      resourceSyncTimeRef.current = Date.now();
      setIsLoaded(true);
      if (userId) {
        void getMainPlanetId(userId).then(id => {
          mainPlanetIdRef.current = id;
          console.log('[GameContext] Main planet ID cached:', id);
        });
      }
    }
  }, [stateQuery.data, isLoaded, userId]);

  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(() => setDisplayTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        let changed = false;
        let buildings = prev.buildings;
        let research = prev.research;
        let activeTimers = prev.activeTimers;
        let ships = prev.ships;
        let defenses = prev.defenses;
        let shipyardQueue = prev.shipyardQueue;

        const hasExpired = prev.activeTimers.some(t => now >= t.endTime);
        if (hasExpired) {
          changed = true;
          const completed = prev.activeTimers.filter(t => now >= t.endTime);
          activeTimers = prev.activeTimers.filter(t => now < t.endTime);
          buildings = { ...prev.buildings };
          research = { ...prev.research };
          for (const timer of completed) {
            if (timer.type === 'building') {
              buildings[timer.id] = timer.targetLevel;
              console.log('[GameContext] Timer completed building', timer.id, 'lv', timer.targetLevel);
            } else if (timer.type === 'research') {
              research[timer.id] = timer.targetLevel;
              console.log('[GameContext] Timer completed research', timer.id, 'lv', timer.targetLevel);
            }
          }
        }

        if ((prev.shipyardQueue ?? []).length > 0) {
          const result = processShipyardQueue(prev.shipyardQueue, prev.ships, prev.defenses, now);
          if (result.changed) {
            changed = true;
            ships = result.ships;
            defenses = result.defenses;
          }
          if (result.queue.length !== prev.shipyardQueue.length) changed = true;
          shipyardQueue = result.queue;
        }

        let colonies = prev.colonies;
        if ((prev.colonies ?? []).length > 0) {
          let coloniesChanged = false;
          const updatedColonies = (prev.colonies ?? []).map(colony => {
            let colChanged = false;
            let colActiveTimers = colony.activeTimers;
            let colBuildings = colony.buildings;

            if (colony.activeTimers.length > 0) {
              const hasColExpired = colony.activeTimers.some(t => now >= t.endTime);
              if (hasColExpired) {
                colChanged = true;
                const colCompleted = colony.activeTimers.filter(t => now >= t.endTime);
                colActiveTimers = colony.activeTimers.filter(t => now < t.endTime);
                colBuildings = { ...colony.buildings };
                for (const timer of colCompleted) {
                  if (timer.type === 'building') {
                    colBuildings[timer.id] = timer.targetLevel;
                  } else if (timer.type === 'research') {
                    research = { ...research, [timer.id]: timer.targetLevel };
                    changed = true;
                  }
                }
              }
            }

            let colShips = colony.ships;
            let colDefenses = colony.defenses;
            let colQueue = colony.shipyardQueue;
            if ((colony.shipyardQueue ?? []).length > 0) {
              const colShipyard = processShipyardQueue(colony.shipyardQueue ?? [], colony.ships, colony.defenses, now);
              if (colShipyard.changed) {
                colChanged = true;
                colShips = colShipyard.ships;
                colDefenses = colShipyard.defenses;
              }
              if (colShipyard.queue.length !== (colony.shipyardQueue ?? []).length) colChanged = true;
              colQueue = colShipyard.queue;
            }

            if (colChanged) {
              coloniesChanged = true;
              return {
                ...colony,
                buildings: colBuildings,
                ships: colShips,
                defenses: colDefenses,
                activeTimers: colActiveTimers,
                shipyardQueue: colQueue,
              };
            }
            return colony;
          });
          if (coloniesChanged) {
            changed = true;
            colonies = updatedColonies;
          }
        }

        if (!changed) return prev;

        return {
          ...prev,
          buildings,
          research,
          ships,
          defenses,
          activeTimers,
          shipyardQueue,
          colonies,
        };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(() => {
      const currentState = stateRef.current;
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
    }, 10000);
    return () => clearInterval(interval);
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        const currentState = stateRef.current;
        void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
      }

      if (nextAppState === 'active') {
        console.log('[GameContext] App returned to foreground, triggering resync');
        void resyncFromServerRef.current();
      }
    });
    return () => subscription.remove();
  }, [isLoaded, userId]);

  const resyncFromServer = useCallback(async () => {
    if (!userId || isMergingRef.current) return;
    if (pendingActionsRef.current.size > 0) {
      console.log('[Resync] Skipped: pending actions in flight:', Array.from(pendingActionsRef.current));
      return;
    }
    isMergingRef.current = true;
    try {
      const serverState = await loadFullStateFromTables(userId);
      if (!serverState) {
        isMergingRef.current = false;
        return;
      }

      const serverTimerCount = serverState.activeTimers.length;
      const serverTimerIds = serverState.activeTimers.map(t => `${t.type}:${t.id}(end=${t.endTime})`);
      console.log('[Resync] Server timers received:', serverTimerCount, serverTimerIds);

      const localTimers = stateRef.current.activeTimers;
      const localTimerIds = localTimers.map(t => `${t.type}:${t.id}(end=${t.endTime})`);
      console.log('[Resync] Local timers before merge:', localTimers.length, localTimerIds);

      const processed = processCompletedTimersAndQueue(serverState);

      const completedDuringProcess = serverTimerCount - processed.activeTimers.length;
      if (completedDuringProcess > 0) {
        console.log('[Resync] Timers completed during processing:', completedDuringProcess);
      }
      console.log('[Resync] Active timers after processing:', processed.activeTimers.length,
        processed.activeTimers.map(t => `${t.type}:${t.id}(end=${t.endTime}, remaining=${Math.ceil((t.endTime - Date.now()) / 1000)}s)`));

      const localOnlyTimers = localTimers.filter(lt =>
        !processed.activeTimers.some(pt => pt.id === lt.id && pt.type === lt.type) &&
        lt.endTime > Date.now() &&
        !serverState.activeTimers.some(st => st.id === lt.id && st.type === lt.type)
      );
      if (localOnlyTimers.length > 0) {
        console.log('[Resync] Preserving local-only optimistic timers:', localOnlyTimers.map(t => `${t.type}:${t.id}`));
        processed.activeTimers = [...processed.activeTimers, ...localOnlyTimers];
      }

      if (completedDuringProcess > 0 && mainPlanetIdRef.current) {
        console.log('[Resync] Syncing completed timer results back to DB');
        const planetId = mainPlanetIdRef.current;
        void (async () => {
          try {
            await syncTimersToTable(userId, planetId, processed.activeTimers);
            const buildingRows = Object.entries(processed.buildings).map(([bid, level]) => ({
              planet_id: planetId, building_id: bid, level,
            }));
            if (buildingRows.length > 0) {
              await supabase.from('planet_buildings').upsert(buildingRows, { onConflict: 'planet_id,building_id' });
            }
            const researchRows = Object.entries(processed.research).map(([rid, level]) => ({
              user_id: userId, research_id: rid, level,
            }));
            if (researchRows.length > 0) {
              await supabase.from('player_research').upsert(researchRows, { onConflict: 'user_id,research_id' });
            }
            console.log('[Resync] Completed timer results synced to DB');
          } catch (e) {
            console.log('[Resync] Error syncing completed timer results:', e);
          }
        })();
      }

      lastSavedSnapshotRef.current = {
        resources: { fer: processed.resources.fer, silice: processed.resources.silice, xenogas: processed.resources.xenogas },
        ships: { ...processed.ships },
        defenses: { ...processed.defenses },
        savedAt: Date.now(),
      };

      resourceSyncTimeRef.current = Date.now();
      setState(processed);
      stateRef.current = processed;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(processed));
      console.log('[Resync] Complete. Resources:', {
        fer: Math.floor(processed.resources.fer),
        silice: Math.floor(processed.resources.silice),
        xenogas: Math.floor(processed.resources.xenogas),
      }, 'Timers:', processed.activeTimers.length);
    } catch (e) {
      console.log('[Resync] Error in resyncFromServer:', e);
    } finally {
      isMergingRef.current = false;
    }
  }, [userId]);

  const resyncFromServerRef = useRef(resyncFromServer);
  resyncFromServerRef.current = resyncFromServer;


  useEffect(() => {
    if (!isLoaded || !userId) return;
    const resyncInterval = setInterval(() => {
      void resyncFromServerRef.current();
    }, 15000);
    return () => {
      clearInterval(resyncInterval);
    };
  }, [isLoaded, userId]);



  const saveState = useCallback((newState: GameState) => {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    if (userId) {
      lastSavedSnapshotRef.current = {
        resources: { fer: newState.resources.fer, silice: newState.resources.silice, xenogas: newState.resources.xenogas },
        ships: { ...newState.ships },
        defenses: { ...newState.defenses },
        savedAt: Date.now(),
      };
      const capturedUserId = userId;
      const capturedEmail = userEmail;
      const capturedTimers = newState.activeTimers;
      const capturedQueue = newState.shipyardQueue;
      const capturedColonies = newState.colonies;
      InteractionManager.runAfterInteractions(() => {
        void saveStateToSupabase(capturedUserId, newState, capturedEmail);
        void (async () => {
          try {
            const planetId = await getMainPlanetId(capturedUserId);
            if (planetId) {
              await supabase.from('planet_resources').upsert({
                planet_id: planetId,
                fer: newState.resources.fer,
                silice: newState.resources.silice,
                xenogas: newState.resources.xenogas,
                energy: newState.resources.energy,
              }, { onConflict: 'planet_id' });
              await supabase.from('planets').update({ last_update: Date.now() }).eq('id', planetId);
              const buildingRows = Object.entries(newState.buildings).map(([bid, level]) => ({
                planet_id: planetId, building_id: bid, level,
              }));
              if (buildingRows.length > 0) {
                await supabase.from('planet_buildings').upsert(buildingRows, { onConflict: 'planet_id,building_id' });
              }
              const researchRows = Object.entries(newState.research).map(([rid, level]) => ({
                user_id: capturedUserId, research_id: rid, level,
              }));
              if (researchRows.length > 0) {
                await supabase.from('player_research').upsert(researchRows, { onConflict: 'user_id,research_id' });
              }
              await syncTimersToTable(capturedUserId, planetId, capturedTimers);
              await syncShipyardQueueToTable(planetId, capturedQueue);
            }
            if (capturedColonies && capturedColonies.length > 0) {
              for (const colony of capturedColonies) {
                await supabase.from('planet_resources').upsert({
                  planet_id: colony.id,
                  fer: colony.resources.fer,
                  silice: colony.resources.silice,
                  xenogas: colony.resources.xenogas,
                  energy: colony.resources.energy,
                }, { onConflict: 'planet_id' });
                await supabase.from('planets').update({ last_update: Date.now() }).eq('id', colony.id);
                const colBuildingRows = Object.entries(colony.buildings ?? {}).map(([bid, level]) => ({
                  planet_id: colony.id, building_id: bid, level,
                }));
                if (colBuildingRows.length > 0) {
                  await supabase.from('planet_buildings').upsert(colBuildingRows, { onConflict: 'planet_id,building_id' });
                }
                await syncTimersToTable(capturedUserId, colony.id, colony.activeTimers ?? []);
                if ((colony.shipyardQueue ?? []).length > 0) {
                  await syncShipyardQueueToTable(colony.id, colony.shipyardQueue);
                }
              }
            }
          } catch (e) {
            console.log('[GameContext] Error in deferred save:', e);
          }
        })();
      });
    }
  }, [userId, userEmail]);

  const getTimerForId = useCallback((id: string, type: 'building' | 'research'): UpgradeTimer | undefined => {
    return stateRef.current.activeTimers.find(t => t.id === id && t.type === type);
  }, []);

  const isUpgrading = useCallback((id: string, type: 'building' | 'research'): boolean => {
    return stateRef.current.activeTimers.some(t => t.id === id && t.type === type);
  }, []);

  const getShipyardQueueItem = useCallback((id: string, type: 'ship' | 'defense'): ShipyardQueueItem | undefined => {
    return stateRef.current.shipyardQueue.find(q => q.id === id && q.type === type);
  }, []);

  const upgradeBuilding = useCallback(async (buildingId: string) => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `build:${buildingId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const building = BUILDINGS.find(b => b.id === buildingId);
    if (!building) return;
    if (prev.activeTimers.some(t => t.id === buildingId && t.type === 'building')) return;
    const currentLevel = prev.buildings[buildingId] ?? 0;
    const cost = calculateCost(building.baseCost, building.costFactor, currentLevel);
    if (!canAfford(prev.resources, cost)) return;

    pendingActionsRef.current.add(actionKey);
    const roboticsLevel = prev.buildings.robotics ?? 0;
    const naniteLevel = prev.buildings.naniteFactory ?? 0;
    const buildTimeSec = calculateUpgradeTime(building.baseTime, building.timeFactor, currentLevel, roboticsLevel, naniteLevel);
    const now = Date.now();
    const optimisticTimer: UpgradeTimer = { id: buildingId, type: 'building', targetLevel: currentLevel + 1, startTime: now, endTime: now + buildTimeSec * 1000 };
    setState(p => ({
      ...p,
      resources: { ...p.resources, fer: p.resources.fer - cost.fer, silice: p.resources.silice - cost.silice, xenogas: p.resources.xenogas - cost.xenogas },
      activeTimers: [...p.activeTimers, optimisticTimer],
    }));
    console.log('[GameContext] Optimistic building upgrade:', buildingId, 'lv', currentLevel + 1);

    try {
      const result = await trpcClient.actions.startBuilding.mutate({ userId, planetId: mainPlanetIdRef.current, buildingId });
      if (!result.success) {
        console.log('[GameContext] Server rejected building upgrade:', result.error);
        setState(p => ({
          ...p,
          resources: { ...p.resources, fer: p.resources.fer + cost.fer, silice: p.resources.silice + cost.silice, xenogas: p.resources.xenogas + cost.xenogas },
          activeTimers: p.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')),
        }));
        setActionError(result.error || 'Construction refusée');
        return;
      }
      const serverRes = result.resources!;
      const serverTimer = result.timer!;
      setState(p => {
        const newState: GameState = {
          ...p,
          resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          activeTimers: [...p.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')), serverTimer],
        };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Building upgrade confirmed by server:', buildingId, 'lv', serverTimer.targetLevel);
    } catch (e) {
      console.log('[GameContext] Error calling server for building upgrade:', e);
      setState(p => ({
        ...p,
        resources: { ...p.resources, fer: p.resources.fer + cost.fer, silice: p.resources.silice + cost.silice, xenogas: p.resources.xenogas + cost.xenogas },
        activeTimers: p.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')),
      }));
      setActionError('Erreur réseau lors de la construction');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const upgradeResearch = useCallback(async (researchId: string) => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `research:${researchId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const researchDef = RESEARCH.find(r => r.id === researchId);
    if (!researchDef) return;
    if (prev.activeTimers.some(t => t.id === researchId && t.type === 'research')) return;
    const currentLevel = prev.research[researchId] ?? 0;
    const cost = calculateCost(researchDef.baseCost, researchDef.costFactor, currentLevel);
    if (!canAfford(prev.resources, cost)) return;

    pendingActionsRef.current.add(actionKey);
    const labLevel = prev.buildings.researchLab ?? 0;
    const naniteLevel = prev.buildings.naniteFactory ?? 0;
    const researchTimeSec = calculateResearchTime(researchDef.baseTime, researchDef.timeFactor, currentLevel, labLevel, naniteLevel);
    const now = Date.now();
    const optimisticTimer: UpgradeTimer = { id: researchId, type: 'research', targetLevel: currentLevel + 1, startTime: now, endTime: now + researchTimeSec * 1000 };
    setState(p => ({
      ...p,
      resources: { ...p.resources, fer: p.resources.fer - cost.fer, silice: p.resources.silice - cost.silice, xenogas: p.resources.xenogas - cost.xenogas },
      activeTimers: [...p.activeTimers, optimisticTimer],
    }));
    console.log('[GameContext] Optimistic research:', researchId, 'lv', currentLevel + 1);

    try {
      const result = await trpcClient.actions.startResearch.mutate({ userId, planetId: mainPlanetIdRef.current, researchId });
      if (!result.success) {
        console.log('[GameContext] Server rejected research:', result.error);
        setState(p => ({
          ...p,
          resources: { ...p.resources, fer: p.resources.fer + cost.fer, silice: p.resources.silice + cost.silice, xenogas: p.resources.xenogas + cost.xenogas },
          activeTimers: p.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')),
        }));
        setActionError(result.error || 'Recherche refusée');
        return;
      }
      const serverRes = result.resources!;
      const serverTimer = result.timer!;
      setState(p => {
        const newState: GameState = {
          ...p,
          resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          activeTimers: [...p.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')), serverTimer],
        };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Research confirmed by server:', researchId, 'lv', serverTimer.targetLevel);
    } catch (e) {
      console.log('[GameContext] Error calling server for research:', e);
      setState(p => ({
        ...p,
        resources: { ...p.resources, fer: p.resources.fer + cost.fer, silice: p.resources.silice + cost.silice, xenogas: p.resources.xenogas + cost.xenogas },
        activeTimers: p.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')),
      }));
      setActionError('Erreur réseau lors de la recherche');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const buildShipQueue = useCallback(async (shipId: string, quantity: number) => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `ship:${shipId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const ship = SHIPS.find(s => s.id === shipId);
    if (!ship || quantity <= 0) return;
    const totalCost = { fer: (ship.cost.fer ?? 0) * quantity, silice: (ship.cost.silice ?? 0) * quantity, xenogas: (ship.cost.xenogas ?? 0) * quantity, energy: 0 };
    if (!canAfford(prev.resources, totalCost)) return;

    pendingActionsRef.current.add(actionKey);
    const shipyardLevel = prev.buildings.shipyard ?? 0;
    const naniteLevel = prev.buildings.naniteFactory ?? 0;
    const buildTimePerUnit = calculateShipBuildTime(ship.buildTime, shipyardLevel, naniteLevel);
    const now = Date.now();
    const prevQueueItem = prev.shipyardQueue.find(q => q.id === shipId && q.type === 'ship');
    const optimisticQueue: ShipyardQueueItem = prevQueueItem
      ? { ...prevQueueItem, totalQuantity: prevQueueItem.totalQuantity + quantity, remainingQuantity: prevQueueItem.remainingQuantity + quantity }
      : { id: shipId, type: 'ship', totalQuantity: quantity, remainingQuantity: quantity, buildTimePerUnit, currentUnitStartTime: now, currentUnitEndTime: now + buildTimePerUnit * 1000 };
    setState(p => {
      const existingIdx = p.shipyardQueue.findIndex(q => q.id === shipId && q.type === 'ship');
      const newQueue = existingIdx >= 0 ? p.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? optimisticQueue : q) : [...p.shipyardQueue, optimisticQueue];
      return { ...p, resources: { ...p.resources, fer: p.resources.fer - totalCost.fer, silice: p.resources.silice - totalCost.silice, xenogas: p.resources.xenogas - totalCost.xenogas }, shipyardQueue: newQueue };
    });
    console.log('[GameContext] Optimistic ship build:', shipId, 'x', quantity);

    try {
      const result = await trpcClient.actions.buildShips.mutate({ userId, planetId: mainPlanetIdRef.current, shipId, quantity });
      if (!result.success) {
        console.log('[GameContext] Server rejected ship build:', result.error);
        setState(p => {
          const restoredQueue = prevQueueItem ? p.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? prevQueueItem : q) : p.shipyardQueue.filter(q => !(q.id === shipId && q.type === 'ship'));
          return { ...p, resources: { ...p.resources, fer: p.resources.fer + totalCost.fer, silice: p.resources.silice + totalCost.silice, xenogas: p.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
        });
        setActionError(result.error || 'Construction de vaisseaux refusée');
        return;
      }
      const serverRes = result.resources!;
      const serverQueue = result.queueItem!;
      setState(p => {
        const existingIdx = p.shipyardQueue.findIndex(q => q.id === shipId && q.type === 'ship');
        const newQueue = existingIdx >= 0 ? p.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? serverQueue : q) : [...p.shipyardQueue, serverQueue];
        const newState: GameState = { ...p, resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, shipyardQueue: newQueue };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Ship build confirmed by server:', shipId, 'x', quantity);
    } catch (e) {
      console.log('[GameContext] Error calling server for ship build:', e);
      setState(p => {
        const restoredQueue = prevQueueItem ? p.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? prevQueueItem : q) : p.shipyardQueue.filter(q => !(q.id === shipId && q.type === 'ship'));
        return { ...p, resources: { ...p.resources, fer: p.resources.fer + totalCost.fer, silice: p.resources.silice + totalCost.silice, xenogas: p.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
      });
      setActionError('Erreur réseau lors de la construction de vaisseaux');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const buildDefenseQueue = useCallback(async (defenseId: string, quantity: number) => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `defense:${defenseId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const defense = DEFENSES.find(d => d.id === defenseId);
    if (!defense || quantity <= 0) return;
    const totalCost = { fer: (defense.cost.fer ?? 0) * quantity, silice: (defense.cost.silice ?? 0) * quantity, xenogas: (defense.cost.xenogas ?? 0) * quantity, energy: 0 };
    if (!canAfford(prev.resources, totalCost)) return;

    pendingActionsRef.current.add(actionKey);
    const shipyardLevel = prev.buildings.shipyard ?? 0;
    const naniteLevel = prev.buildings.naniteFactory ?? 0;
    const buildTimePerUnit = calculateShipBuildTime(defense.buildTime, shipyardLevel, naniteLevel);
    const now = Date.now();
    const prevQueueItem = prev.shipyardQueue.find(q => q.id === defenseId && q.type === 'defense');
    const optimisticQueue: ShipyardQueueItem = prevQueueItem
      ? { ...prevQueueItem, totalQuantity: prevQueueItem.totalQuantity + quantity, remainingQuantity: prevQueueItem.remainingQuantity + quantity }
      : { id: defenseId, type: 'defense', totalQuantity: quantity, remainingQuantity: quantity, buildTimePerUnit, currentUnitStartTime: now, currentUnitEndTime: now + buildTimePerUnit * 1000 };
    setState(p => {
      const existingIdx = p.shipyardQueue.findIndex(q => q.id === defenseId && q.type === 'defense');
      const newQueue = existingIdx >= 0 ? p.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? optimisticQueue : q) : [...p.shipyardQueue, optimisticQueue];
      return { ...p, resources: { ...p.resources, fer: p.resources.fer - totalCost.fer, silice: p.resources.silice - totalCost.silice, xenogas: p.resources.xenogas - totalCost.xenogas }, shipyardQueue: newQueue };
    });
    console.log('[GameContext] Optimistic defense build:', defenseId, 'x', quantity);

    try {
      const result = await trpcClient.actions.buildDefenses.mutate({ userId, planetId: mainPlanetIdRef.current, defenseId, quantity });
      if (!result.success) {
        console.log('[GameContext] Server rejected defense build:', result.error);
        setState(p => {
          const restoredQueue = prevQueueItem ? p.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? prevQueueItem : q) : p.shipyardQueue.filter(q => !(q.id === defenseId && q.type === 'defense'));
          return { ...p, resources: { ...p.resources, fer: p.resources.fer + totalCost.fer, silice: p.resources.silice + totalCost.silice, xenogas: p.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
        });
        setActionError(result.error || 'Construction de défenses refusée');
        return;
      }
      const serverRes = result.resources!;
      const serverQueue = result.queueItem!;
      setState(p => {
        const existingIdx = p.shipyardQueue.findIndex(q => q.id === defenseId && q.type === 'defense');
        const newQueue = existingIdx >= 0 ? p.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? serverQueue : q) : [...p.shipyardQueue, serverQueue];
        const newState: GameState = { ...p, resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, shipyardQueue: newQueue };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Defense build confirmed by server:', defenseId, 'x', quantity);
    } catch (e) {
      console.log('[GameContext] Error calling server for defense build:', e);
      setState(p => {
        const restoredQueue = prevQueueItem ? p.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? prevQueueItem : q) : p.shipyardQueue.filter(q => !(q.id === defenseId && q.type === 'defense'));
        return { ...p, resources: { ...p.resources, fer: p.resources.fer + totalCost.fer, silice: p.resources.silice + totalCost.silice, xenogas: p.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
      });
      setActionError('Erreur réseau lors de la construction de défenses');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const rushWithSolar = useCallback(async (timerId: string, timerType: 'building' | 'research') => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `rush:${timerId}:${timerType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const timer = prev.activeTimers.find(t => t.id === timerId && t.type === timerType);
    if (!timer) return;
    const remainingSeconds = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
    const solarCost = calculateSolarCost(remainingSeconds);
    if (prev.solar < solarCost) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => {
      let buildings = p.buildings;
      let research = p.research;
      if (timerType === 'building') buildings = { ...p.buildings, [timerId]: timer.targetLevel };
      else if (timerType === 'research') research = { ...p.research, [timerId]: timer.targetLevel };
      return { ...p, buildings, research, solar: p.solar - solarCost, activeTimers: p.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) };
    });
    console.log('[GameContext] Optimistic rush:', timerId, timerType);

    try {
      const result = await trpcClient.actions.rushTimer.mutate({ userId, planetId: mainPlanetIdRef.current, timerId, timerType });
      if (!result.success) {
        console.log('[GameContext] Server rejected rush:', result.error);
        setState(p => {
          let buildings = p.buildings;
          let research = p.research;
          if (timerType === 'building') { const newB = { ...p.buildings }; delete newB[timerId]; buildings = prev.buildings; }
          else if (timerType === 'research') { research = prev.research; }
          return { ...p, buildings, research, solar: p.solar + solarCost, activeTimers: [...p.activeTimers, timer] };
        });
        setActionError(result.error || 'Accélération refusée');
        return;
      }
      setState(p => {
        let buildings = p.buildings;
        let research = p.research;
        if (result.completedType === 'building') buildings = { ...p.buildings, [result.completedId!]: result.completedLevel! };
        else if (result.completedType === 'research') research = { ...p.research, [result.completedId!]: result.completedLevel! };
        const newState: GameState = { ...p, buildings, research, solar: result.solar!, activeTimers: p.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Rush confirmed by server:', timerId);
    } catch (e) {
      console.log('[GameContext] Error calling server for rush:', e);
      setState(p => {
        let buildings = timerType === 'building' ? prev.buildings : p.buildings;
        let research = timerType === 'research' ? prev.research : p.research;
        return { ...p, buildings, research, solar: p.solar + solarCost, activeTimers: [...p.activeTimers, timer] };
      });
      setActionError('Erreur réseau lors de l\'accélération');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const cancelUpgrade = useCallback(async (timerId: string, timerType: 'building' | 'research') => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `cancel:${timerId}:${timerType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const timer = prev.activeTimers.find(t => t.id === timerId && t.type === timerType);
    if (!timer) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => ({ ...p, activeTimers: p.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) }));
    console.log('[GameContext] Optimistic cancel:', timerId, timerType);

    try {
      const result = await trpcClient.actions.cancelTimer.mutate({ userId, planetId: mainPlanetIdRef.current, timerId, timerType });
      if (!result.success) {
        console.log('[GameContext] Server rejected cancel:', result.error);
        setState(p => ({ ...p, activeTimers: [...p.activeTimers, timer] }));
        setActionError(result.error || 'Annulation refusée');
        return;
      }
      const serverRes = result.resources!;
      setState(p => {
        const newState: GameState = { ...p, resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, activeTimers: p.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Cancel confirmed by server:', timerId);
    } catch (e) {
      console.log('[GameContext] Error calling server for cancel:', e);
      setState(p => ({ ...p, activeTimers: [...p.activeTimers, timer] }));
      setActionError('Erreur réseau lors de l\'annulation');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const cancelShipyardQueue = useCallback(async (itemId: string, itemType: 'ship' | 'defense') => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `cancelShip:${itemId}:${itemType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const queueItem = prev.shipyardQueue.find(q => q.id === itemId && q.type === itemType);
    if (!queueItem) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => ({ ...p, shipyardQueue: p.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) }));
    console.log('[GameContext] Optimistic shipyard cancel:', itemId, itemType);

    try {
      const result = await trpcClient.actions.cancelShipyard.mutate({ userId, planetId: mainPlanetIdRef.current, itemId, itemType });
      if (!result.success) {
        console.log('[GameContext] Server rejected shipyard cancel:', result.error);
        setState(p => ({ ...p, shipyardQueue: [...p.shipyardQueue, queueItem] }));
        setActionError(result.error || 'Annulation du chantier refusée');
        return;
      }
      const serverRes = result.resources!;
      setState(p => {
        const newState: GameState = { ...p, resources: { ...p.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, shipyardQueue: p.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Shipyard cancel confirmed by server:', itemId);
    } catch (e) {
      console.log('[GameContext] Error calling server for shipyard cancel:', e);
      setState(p => ({ ...p, shipyardQueue: [...p.shipyardQueue, queueItem] }));
      setActionError('Erreur réseau lors de l\'annulation du chantier');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const rushShipyardWithSolar = useCallback(async (itemId: string, itemType: 'ship' | 'defense') => {
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `rushShip:${itemId}:${itemType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const queueItem = prev.shipyardQueue.find(q => q.id === itemId && q.type === itemType);
    if (!queueItem) return;
    const remainingSec = Math.max(0, Math.ceil(((queueItem.currentUnitEndTime - Date.now()) / 1000) + (queueItem.remainingQuantity - 1) * queueItem.buildTimePerUnit));
    const solarCost = calculateSolarCost(remainingSec);
    if (prev.solar < solarCost) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => {
      const newShips = { ...p.ships };
      const newDefenses = { ...p.defenses };
      if (itemType === 'ship') newShips[itemId] = (newShips[itemId] ?? 0) + queueItem.remainingQuantity;
      else newDefenses[itemId] = (newDefenses[itemId] ?? 0) + queueItem.remainingQuantity;
      return { ...p, ships: newShips, defenses: newDefenses, solar: p.solar - solarCost, shipyardQueue: p.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) };
    });
    console.log('[GameContext] Optimistic shipyard rush:', itemId, itemType);

    try {
      const result = await trpcClient.actions.rushShipyard.mutate({ userId, planetId: mainPlanetIdRef.current, itemId, itemType });
      if (!result.success) {
        console.log('[GameContext] Server rejected shipyard rush:', result.error);
        setState(p => {
          const newShips = { ...p.ships };
          const newDefenses = { ...p.defenses };
          if (itemType === 'ship') newShips[itemId] = Math.max(0, (newShips[itemId] ?? 0) - queueItem.remainingQuantity);
          else newDefenses[itemId] = Math.max(0, (newDefenses[itemId] ?? 0) - queueItem.remainingQuantity);
          return { ...p, ships: newShips, defenses: newDefenses, solar: p.solar + solarCost, shipyardQueue: [...p.shipyardQueue, queueItem] };
        });
        setActionError(result.error || 'Accélération du chantier refusée');
        return;
      }
      setState(p => {
        const newShips = { ...p.ships };
        const newDefenses = { ...p.defenses };
        if (result.completedType === 'ship') newShips[result.completedId!] = (prev.ships[result.completedId!] ?? 0) + (result.completedQuantity ?? 0);
        else newDefenses[result.completedId!] = (prev.defenses[result.completedId!] ?? 0) + (result.completedQuantity ?? 0);
        const newState: GameState = { ...p, ships: newShips, defenses: newDefenses, solar: result.solar!, shipyardQueue: p.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Shipyard rush confirmed by server:', itemId);
    } catch (e) {
      console.log('[GameContext] Error calling server for shipyard rush:', e);
      setState(p => {
        const newShips = { ...p.ships };
        const newDefenses = { ...p.defenses };
        if (itemType === 'ship') newShips[itemId] = Math.max(0, (newShips[itemId] ?? 0) - queueItem.remainingQuantity);
        else newDefenses[itemId] = Math.max(0, (newDefenses[itemId] ?? 0) - queueItem.remainingQuantity);
        return { ...p, ships: newShips, defenses: newDefenses, solar: p.solar + solarCost, shipyardQueue: [...p.shipyardQueue, queueItem] };
      });
      setActionError('Erreur réseau lors de l\'accélération du chantier');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const getMaxBuildableQuantity = useCallback((cost: Partial<Resources>): number => {
    const s = stateRef.current;
    const maxFer = (cost.fer ?? 0) > 0 ? Math.floor(s.resources.fer / (cost.fer ?? 1)) : Infinity;
    const maxSilice = (cost.silice ?? 0) > 0 ? Math.floor(s.resources.silice / (cost.silice ?? 1)) : Infinity;
    const maxXenogas = (cost.xenogas ?? 0) > 0 ? Math.floor(s.resources.xenogas / (cost.xenogas ?? 1)) : Infinity;
    const maxVal = Math.min(maxFer, maxSilice, maxXenogas);
    return maxVal === Infinity ? 999 : Math.max(0, maxVal);
  }, []);

  const production = useMemo(() => calculateProduction(state.buildings, state.research, state.ships, state.productionPercentages), [state.buildings, state.research, state.ships, state.productionPercentages]);

  const setUsername = useCallback((username: string) => {
    setState(prev => {
      const newState = { ...prev, username };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const renamePlanet = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 24) return;
    if (!userId || !mainPlanetIdRef.current) return;
    const actionKey = `rename:main`;
    if (pendingActionsRef.current.has(actionKey)) return;

    const previousName = stateRef.current.planetName;
    console.log('[GameContext] Renaming planet to', trimmed);

    pendingActionsRef.current.add(actionKey);
    setState(prev => ({ ...prev, planetName: trimmed }));

    try {
      const result = await trpcClient.actions.renamePlanet.mutate({
        userId,
        planetId: mainPlanetIdRef.current!,
        newName: trimmed,
      });
      if (!result.success) {
        console.log('[GameContext] Server rejected rename:', result.error);
        setState(prev => ({ ...prev, planetName: previousName }));
        setActionError(result.error || 'Renommage refusé');
      } else {
        console.log('[GameContext] Planet rename confirmed by server');
        saveState({ ...stateRef.current, planetName: trimmed });
      }
    } catch (err) {
      console.log('[GameContext] Network error renaming planet:', err);
      setState(prev => ({ ...prev, planetName: previousName }));
      setActionError('Erreur réseau lors du renommage');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState, setActionError]);

  const deductFleetShips = useCallback((ships: Record<string, number>, resources?: { fer: number; silice: number; xenogas: number }) => {
    setState(prev => {
      const newShips = { ...prev.ships };
      for (const [id, count] of Object.entries(ships)) {
        newShips[id] = Math.max(0, (newShips[id] ?? 0) - count);
      }
      const newResources = { ...prev.resources };
      if (resources) {
        newResources.fer = Math.max(0, newResources.fer - resources.fer);
        newResources.silice = Math.max(0, newResources.silice - resources.silice);
        newResources.xenogas = Math.max(0, newResources.xenogas - resources.xenogas);
      }
      console.log('[GameContext] Deducting fleet ships (optimistic)', ships);
      return { ...prev, ships: newShips, resources: newResources };
    });
  }, []);



  const addColony = useCallback((colony: Colony) => {
    console.log('[GameContext] Adding colony', colony.id, 'at', colony.coordinates);
    setState(prev => {
      const colonies = [...(prev.colonies ?? []), colony];
      const newState = { ...prev, colonies };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const removeColony = useCallback((colonyId: string) => {
    console.log('[GameContext] Removing colony', colonyId);
    setState(prev => {
      const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
      if (colony && userId) {
        void removeColonyFromPlanetsTable(userId, colony.coordinates);
      }
      const colonies = (prev.colonies ?? []).filter(c => c.id !== colonyId);
      const newState = { ...prev, colonies };
      saveState(newState);
      return newState;
    });
  }, [saveState, userId]);

  const renameColony = useCallback(async (colonyId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 24) return;
    if (!userId) return;
    const actionKey = `rename:${colonyId}`;
    if (pendingActionsRef.current.has(actionKey)) return;

    const previousName = (stateRef.current.colonies ?? []).find(c => c.id === colonyId)?.planetName;
    console.log('[GameContext] Renaming colony', colonyId, 'to', trimmed);

    pendingActionsRef.current.add(actionKey);
    setState(prev => ({
      ...prev,
      colonies: (prev.colonies ?? []).map(c =>
        c.id === colonyId ? { ...c, planetName: trimmed } : c
      ),
    }));

    try {
      const result = await trpcClient.actions.renamePlanet.mutate({
        userId,
        planetId: colonyId,
        newName: trimmed,
      });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony rename:', result.error);
        setState(prev => ({
          ...prev,
          colonies: (prev.colonies ?? []).map(c =>
            c.id === colonyId ? { ...c, planetName: previousName ?? c.planetName } : c
          ),
        }));
        setActionError(result.error || 'Renommage colonie refusé');
      } else {
        console.log('[GameContext] Colony rename confirmed by server');
        saveState(stateRef.current);
      }
    } catch (err) {
      console.log('[GameContext] Network error renaming colony:', err);
      setState(prev => ({
        ...prev,
        colonies: (prev.colonies ?? []).map(c =>
          c.id === colonyId ? { ...c, planetName: previousName ?? c.planetName } : c
        ),
      }));
      setActionError('Erreur réseau lors du renommage colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState, setActionError]);

  const upgradeColonyBuilding = useCallback(async (colonyId: string, buildingId: string) => {
    if (!userId) return;
    const actionKey = `colBuild:${colonyId}:${buildingId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const building = BUILDINGS.find(b => b.id === buildingId);
    if (!building) return;
    if (colony.activeTimers.some(t => t.id === buildingId && t.type === 'building')) return;
    const currentLevel = colony.buildings[buildingId] ?? 0;
    const cost = calculateCost(building.baseCost, building.costFactor, currentLevel);
    if (!canAfford(colony.resources, cost)) return;

    pendingActionsRef.current.add(actionKey);
    const roboticsLevel = colony.buildings.robotics ?? 0;
    const naniteLevel = colony.buildings.naniteFactory ?? 0;
    const buildTimeSec = calculateUpgradeTime(building.baseTime, building.timeFactor, currentLevel, roboticsLevel, naniteLevel);
    const now = Date.now();
    const optimisticTimer: UpgradeTimer = { id: buildingId, type: 'building', targetLevel: currentLevel + 1, startTime: now, endTime: now + buildTimeSec * 1000 };
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
        ...c,
        resources: { ...c.resources, fer: c.resources.fer - cost.fer, silice: c.resources.silice - cost.silice, xenogas: c.resources.xenogas - cost.xenogas },
        activeTimers: [...c.activeTimers, optimisticTimer],
      }),
    }));
    console.log('[GameContext] Optimistic colony building:', colonyId, buildingId, 'lv', currentLevel + 1);

    try {
      const result = await trpcClient.actions.startBuilding.mutate({ userId, planetId: colonyId, buildingId });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony building:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
            ...c,
            resources: { ...c.resources, fer: c.resources.fer + cost.fer, silice: c.resources.silice + cost.silice, xenogas: c.resources.xenogas + cost.xenogas },
            activeTimers: c.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')),
          }),
        }));
        setActionError(result.error || 'Construction colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      const serverTimer = result.timer!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => c.id !== colonyId ? c : ({
          ...c,
          resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          activeTimers: [...c.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')), serverTimer],
        }));
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony building confirmed by server:', colonyId, buildingId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony building:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
          ...c,
          resources: { ...c.resources, fer: c.resources.fer + cost.fer, silice: c.resources.silice + cost.silice, xenogas: c.resources.xenogas + cost.xenogas },
          activeTimers: c.activeTimers.filter(t => !(t.id === buildingId && t.type === 'building')),
        }),
      }));
      setActionError('Erreur r\u00e9seau construction colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const buildColonyShipQueue = useCallback(async (colonyId: string, shipId: string, quantity: number) => {
    if (!userId) return;
    const actionKey = `colShip:${colonyId}:${shipId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const ship = SHIPS.find(s => s.id === shipId);
    if (!ship || quantity <= 0) return;
    const totalCost = { fer: (ship.cost.fer ?? 0) * quantity, silice: (ship.cost.silice ?? 0) * quantity, xenogas: (ship.cost.xenogas ?? 0) * quantity, energy: 0 };
    if (!canAfford(colony.resources, totalCost)) return;

    pendingActionsRef.current.add(actionKey);
    const shipyardLevel = colony.buildings.shipyard ?? 0;
    const naniteLevel = colony.buildings.naniteFactory ?? 0;
    const buildTimePerUnit = calculateShipBuildTime(ship.buildTime, shipyardLevel, naniteLevel);
    const now = Date.now();
    const prevQueueItem = colony.shipyardQueue.find(q => q.id === shipId && q.type === 'ship');
    const optimisticQueue: ShipyardQueueItem = prevQueueItem
      ? { ...prevQueueItem, totalQuantity: prevQueueItem.totalQuantity + quantity, remainingQuantity: prevQueueItem.remainingQuantity + quantity }
      : { id: shipId, type: 'ship', totalQuantity: quantity, remainingQuantity: quantity, buildTimePerUnit, currentUnitStartTime: now, currentUnitEndTime: now + buildTimePerUnit * 1000 };
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => {
        if (c.id !== colonyId) return c;
        const existingIdx = c.shipyardQueue.findIndex(q => q.id === shipId && q.type === 'ship');
        const newQueue = existingIdx >= 0 ? c.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? optimisticQueue : q) : [...c.shipyardQueue, optimisticQueue];
        return { ...c, resources: { ...c.resources, fer: c.resources.fer - totalCost.fer, silice: c.resources.silice - totalCost.silice, xenogas: c.resources.xenogas - totalCost.xenogas }, shipyardQueue: newQueue };
      }),
    }));
    console.log('[GameContext] Optimistic colony ship build:', colonyId, shipId, 'x', quantity);

    try {
      const result = await trpcClient.actions.buildShips.mutate({ userId, planetId: colonyId, shipId, quantity });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony ship build:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => {
            if (c.id !== colonyId) return c;
            const restoredQueue = prevQueueItem ? c.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? prevQueueItem : q) : c.shipyardQueue.filter(q => !(q.id === shipId && q.type === 'ship'));
            return { ...c, resources: { ...c.resources, fer: c.resources.fer + totalCost.fer, silice: c.resources.silice + totalCost.silice, xenogas: c.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
          }),
        }));
        setActionError(result.error || 'Construction vaisseaux colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      const serverQueue = result.queueItem!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const existingIdx = c.shipyardQueue.findIndex(q => q.id === shipId && q.type === 'ship');
          const newQueue = existingIdx >= 0 ? c.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? serverQueue : q) : [...c.shipyardQueue, serverQueue];
          return { ...c, resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, shipyardQueue: newQueue };
        });
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony ship build confirmed by server:', colonyId, shipId, 'x', quantity);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony ship build:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const restoredQueue = prevQueueItem ? c.shipyardQueue.map(q => q.id === shipId && q.type === 'ship' ? prevQueueItem : q) : c.shipyardQueue.filter(q => !(q.id === shipId && q.type === 'ship'));
          return { ...c, resources: { ...c.resources, fer: c.resources.fer + totalCost.fer, silice: c.resources.silice + totalCost.silice, xenogas: c.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
        }),
      }));
      setActionError('Erreur r\u00e9seau construction vaisseaux colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const buildColonyDefenseQueue = useCallback(async (colonyId: string, defenseId: string, quantity: number) => {
    if (!userId) return;
    const actionKey = `colDef:${colonyId}:${defenseId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const defense = DEFENSES.find(d => d.id === defenseId);
    if (!defense || quantity <= 0) return;
    const totalCost = { fer: (defense.cost.fer ?? 0) * quantity, silice: (defense.cost.silice ?? 0) * quantity, xenogas: (defense.cost.xenogas ?? 0) * quantity, energy: 0 };
    if (!canAfford(colony.resources, totalCost)) return;

    pendingActionsRef.current.add(actionKey);
    const shipyardLevel = colony.buildings.shipyard ?? 0;
    const naniteLevel = colony.buildings.naniteFactory ?? 0;
    const buildTimePerUnit = calculateShipBuildTime(defense.buildTime, shipyardLevel, naniteLevel);
    const now = Date.now();
    const prevQueueItem = colony.shipyardQueue.find(q => q.id === defenseId && q.type === 'defense');
    const optimisticQueue: ShipyardQueueItem = prevQueueItem
      ? { ...prevQueueItem, totalQuantity: prevQueueItem.totalQuantity + quantity, remainingQuantity: prevQueueItem.remainingQuantity + quantity }
      : { id: defenseId, type: 'defense', totalQuantity: quantity, remainingQuantity: quantity, buildTimePerUnit, currentUnitStartTime: now, currentUnitEndTime: now + buildTimePerUnit * 1000 };
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => {
        if (c.id !== colonyId) return c;
        const existingIdx = c.shipyardQueue.findIndex(q => q.id === defenseId && q.type === 'defense');
        const newQueue = existingIdx >= 0 ? c.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? optimisticQueue : q) : [...c.shipyardQueue, optimisticQueue];
        return { ...c, resources: { ...c.resources, fer: c.resources.fer - totalCost.fer, silice: c.resources.silice - totalCost.silice, xenogas: c.resources.xenogas - totalCost.xenogas }, shipyardQueue: newQueue };
      }),
    }));
    console.log('[GameContext] Optimistic colony defense build:', colonyId, defenseId, 'x', quantity);

    try {
      const result = await trpcClient.actions.buildDefenses.mutate({ userId, planetId: colonyId, defenseId, quantity });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony defense build:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => {
            if (c.id !== colonyId) return c;
            const restoredQueue = prevQueueItem ? c.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? prevQueueItem : q) : c.shipyardQueue.filter(q => !(q.id === defenseId && q.type === 'defense'));
            return { ...c, resources: { ...c.resources, fer: c.resources.fer + totalCost.fer, silice: c.resources.silice + totalCost.silice, xenogas: c.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
          }),
        }));
        setActionError(result.error || 'Construction d\u00e9fenses colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      const serverQueue = result.queueItem!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const existingIdx = c.shipyardQueue.findIndex(q => q.id === defenseId && q.type === 'defense');
          const newQueue = existingIdx >= 0 ? c.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? serverQueue : q) : [...c.shipyardQueue, serverQueue];
          return { ...c, resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy }, shipyardQueue: newQueue };
        });
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony defense build confirmed by server:', colonyId, defenseId, 'x', quantity);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony defense build:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const restoredQueue = prevQueueItem ? c.shipyardQueue.map(q => q.id === defenseId && q.type === 'defense' ? prevQueueItem : q) : c.shipyardQueue.filter(q => !(q.id === defenseId && q.type === 'defense'));
          return { ...c, resources: { ...c.resources, fer: c.resources.fer + totalCost.fer, silice: c.resources.silice + totalCost.silice, xenogas: c.resources.xenogas + totalCost.xenogas }, shipyardQueue: restoredQueue };
        }),
      }));
      setActionError('Erreur r\u00e9seau construction d\u00e9fenses colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const cancelColonyUpgrade = useCallback(async (colonyId: string, timerId: string, timerType: 'building' | 'research') => {
    if (!userId) return;
    const actionKey = `colCancel:${colonyId}:${timerId}:${timerType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    const timer = colony?.activeTimers.find(t => t.id === timerId && t.type === timerType);
    if (!timer) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
        ...c, activeTimers: c.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)),
      }),
    }));
    console.log('[GameContext] Optimistic colony cancel:', colonyId, timerId);

    try {
      const result = await trpcClient.actions.cancelTimer.mutate({ userId, planetId: colonyId, timerId, timerType });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony cancel:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
            ...c, activeTimers: [...c.activeTimers, timer],
          }),
        }));
        setActionError(result.error || 'Annulation colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => c.id !== colonyId ? c : ({
          ...c,
          resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          activeTimers: c.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)),
        }));
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony cancel confirmed by server:', colonyId, timerId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony cancel:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
          ...c, activeTimers: [...c.activeTimers, timer],
        }),
      }));
      setActionError('Erreur r\u00e9seau annulation colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const upgradeColonyResearch = useCallback(async (colonyId: string, researchId: string) => {
    if (!userId) return;
    const actionKey = `colResearch:${colonyId}:${researchId}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const researchDef = RESEARCH.find(r => r.id === researchId);
    if (!researchDef) return;
    if (colony.activeTimers.some(t => t.id === researchId && t.type === 'research')) return;
    if (prev.activeTimers.some(t => t.id === researchId && t.type === 'research')) return;
    const currentLevel = prev.research[researchId] ?? 0;
    const cost = calculateCost(researchDef.baseCost, researchDef.costFactor, currentLevel);
    if (!canAfford(colony.resources, cost)) return;

    pendingActionsRef.current.add(actionKey);
    const labLevel = colony.buildings.researchLab ?? 0;
    const naniteLevel = colony.buildings.naniteFactory ?? 0;
    const researchTimeSec = calculateResearchTime(researchDef.baseTime, researchDef.timeFactor, currentLevel, labLevel, naniteLevel);
    const now = Date.now();
    const optimisticTimer: UpgradeTimer = { id: researchId, type: 'research', targetLevel: currentLevel + 1, startTime: now, endTime: now + researchTimeSec * 1000 };
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
        ...c,
        resources: { ...c.resources, fer: c.resources.fer - cost.fer, silice: c.resources.silice - cost.silice, xenogas: c.resources.xenogas - cost.xenogas },
        activeTimers: [...c.activeTimers, optimisticTimer],
      }),
    }));
    console.log('[GameContext] Optimistic colony research:', colonyId, researchId, 'lv', currentLevel + 1);

    try {
      const result = await trpcClient.actions.startResearch.mutate({ userId, planetId: colonyId, researchId });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony research:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
            ...c,
            resources: { ...c.resources, fer: c.resources.fer + cost.fer, silice: c.resources.silice + cost.silice, xenogas: c.resources.xenogas + cost.xenogas },
            activeTimers: c.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')),
          }),
        }));
        setActionError(result.error || 'Recherche colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      const serverTimer = result.timer!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => c.id !== colonyId ? c : ({
          ...c,
          resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          activeTimers: [...c.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')), serverTimer],
        }));
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony research confirmed by server:', colonyId, researchId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony research:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
          ...c,
          resources: { ...c.resources, fer: c.resources.fer + cost.fer, silice: c.resources.silice + cost.silice, xenogas: c.resources.xenogas + cost.xenogas },
          activeTimers: c.activeTimers.filter(t => !(t.id === researchId && t.type === 'research')),
        }),
      }));
      setActionError('Erreur r\u00e9seau recherche colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const rushColonyWithSolar = useCallback(async (colonyId: string, timerId: string, timerType: 'building' | 'research') => {
    if (!userId) return;
    const actionKey = `colRush:${colonyId}:${timerId}:${timerType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const timer = colony.activeTimers.find(t => t.id === timerId && t.type === timerType);
    if (!timer) return;
    const remainingSeconds = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
    const solarCost = calculateSolarCost(remainingSeconds);
    if (prev.solar < solarCost) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => {
      let research = p.research;
      const cols = (p.colonies ?? []).map(c => {
        if (c.id !== colonyId) return c;
        let colBuildings = c.buildings;
        if (timerType === 'building') colBuildings = { ...c.buildings, [timerId]: timer.targetLevel };
        else if (timerType === 'research') research = { ...p.research, [timerId]: timer.targetLevel };
        return { ...c, buildings: colBuildings, activeTimers: c.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) };
      });
      return { ...p, colonies: cols, research, solar: p.solar - solarCost };
    });
    console.log('[GameContext] Optimistic colony rush:', colonyId, timerId, timerType);

    try {
      const result = await trpcClient.actions.rushTimer.mutate({ userId, planetId: colonyId, timerId, timerType });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony rush:', result.error);
        setState(p => {
          let research = timerType === 'research' ? prev.research : p.research;
          const cols = (p.colonies ?? []).map(c => {
            if (c.id !== colonyId) return c;
            let colBuildings = timerType === 'building' ? (prev.colonies ?? []).find(pc => pc.id === colonyId)?.buildings ?? c.buildings : c.buildings;
            return { ...c, buildings: colBuildings, activeTimers: [...c.activeTimers, timer] };
          });
          return { ...p, colonies: cols, research, solar: p.solar + solarCost };
        });
        setActionError(result.error || 'Acc\u00e9l\u00e9ration colonie refus\u00e9e');
        return;
      }
      setState(p => {
        let research = p.research;
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          let colBuildings = c.buildings;
          if (result.completedType === 'building') colBuildings = { ...c.buildings, [result.completedId!]: result.completedLevel! };
          else if (result.completedType === 'research') research = { ...p.research, [result.completedId!]: result.completedLevel! };
          return { ...c, buildings: colBuildings, activeTimers: c.activeTimers.filter(t => !(t.id === timerId && t.type === timerType)) };
        });
        const newState = { ...p, colonies: cols, research, solar: result.solar! };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony rush confirmed by server:', colonyId, timerId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony rush:', e);
      setState(p => {
        let research = timerType === 'research' ? prev.research : p.research;
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          let colBuildings = timerType === 'building' ? (prev.colonies ?? []).find(pc => pc.id === colonyId)?.buildings ?? c.buildings : c.buildings;
          return { ...c, buildings: colBuildings, activeTimers: [...c.activeTimers, timer] };
        });
        return { ...p, colonies: cols, research, solar: p.solar + solarCost };
      });
      setActionError('Erreur r\u00e9seau acc\u00e9l\u00e9ration colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const cancelColonyShipyardQueue = useCallback(async (colonyId: string, itemId: string, itemType: 'ship' | 'defense') => {
    if (!userId) return;
    const actionKey = `colCancelShip:${colonyId}:${itemId}:${itemType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    const queueItem = colony?.shipyardQueue.find(q => q.id === itemId && q.type === itemType);
    if (!queueItem) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => ({
      ...p,
      colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
        ...c, shipyardQueue: c.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)),
      }),
    }));
    console.log('[GameContext] Optimistic colony shipyard cancel:', colonyId, itemId);

    try {
      const result = await trpcClient.actions.cancelShipyard.mutate({ userId, planetId: colonyId, itemId, itemType });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony shipyard cancel:', result.error);
        setState(p => ({
          ...p,
          colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
            ...c, shipyardQueue: [...c.shipyardQueue, queueItem],
          }),
        }));
        setActionError(result.error || 'Annulation chantier colonie refus\u00e9e');
        return;
      }
      const serverRes = result.resources!;
      setState(p => {
        const cols = (p.colonies ?? []).map(c => c.id !== colonyId ? c : ({
          ...c,
          resources: { ...c.resources, fer: serverRes.fer, silice: serverRes.silice, xenogas: serverRes.xenogas, energy: serverRes.energy },
          shipyardQueue: c.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)),
        }));
        const newState = { ...p, colonies: cols };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony shipyard cancel confirmed by server:', colonyId, itemId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony shipyard cancel:', e);
      setState(p => ({
        ...p,
        colonies: (p.colonies ?? []).map(c => c.id !== colonyId ? c : {
          ...c, shipyardQueue: [...c.shipyardQueue, queueItem],
        }),
      }));
      setActionError('Erreur r\u00e9seau annulation chantier colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const rushColonyShipyardWithSolar = useCallback(async (colonyId: string, itemId: string, itemType: 'ship' | 'defense') => {
    if (!userId) return;
    const actionKey = `colRushShip:${colonyId}:${itemId}:${itemType}`;
    if (pendingActionsRef.current.has(actionKey)) return;
    const prev = stateRef.current;
    const colony = (prev.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return;
    const queueItem = colony.shipyardQueue.find(q => q.id === itemId && q.type === itemType);
    if (!queueItem) return;
    const remainingSec = Math.max(0, Math.ceil(((queueItem.currentUnitEndTime - Date.now()) / 1000) + (queueItem.remainingQuantity - 1) * queueItem.buildTimePerUnit));
    const solarCost = calculateSolarCost(remainingSec);
    if (prev.solar < solarCost) return;

    pendingActionsRef.current.add(actionKey);
    setState(p => {
      const cols = (p.colonies ?? []).map(c => {
        if (c.id !== colonyId) return c;
        const newShips = { ...c.ships };
        const newDefenses = { ...c.defenses };
        if (itemType === 'ship') newShips[itemId] = (newShips[itemId] ?? 0) + queueItem.remainingQuantity;
        else newDefenses[itemId] = (newDefenses[itemId] ?? 0) + queueItem.remainingQuantity;
        return { ...c, ships: newShips, defenses: newDefenses, shipyardQueue: c.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) };
      });
      return { ...p, colonies: cols, solar: p.solar - solarCost };
    });
    console.log('[GameContext] Optimistic colony shipyard rush:', colonyId, itemId, itemType);

    try {
      const result = await trpcClient.actions.rushShipyard.mutate({ userId, planetId: colonyId, itemId, itemType });
      if (!result.success) {
        console.log('[GameContext] Server rejected colony shipyard rush:', result.error);
        setState(p => {
          const cols = (p.colonies ?? []).map(c => {
            if (c.id !== colonyId) return c;
            const newShips = { ...c.ships };
            const newDefenses = { ...c.defenses };
            if (itemType === 'ship') newShips[itemId] = Math.max(0, (newShips[itemId] ?? 0) - queueItem.remainingQuantity);
            else newDefenses[itemId] = Math.max(0, (newDefenses[itemId] ?? 0) - queueItem.remainingQuantity);
            return { ...c, ships: newShips, defenses: newDefenses, shipyardQueue: [...c.shipyardQueue, queueItem] };
          });
          return { ...p, colonies: cols, solar: p.solar + solarCost };
        });
        setActionError(result.error || 'Acc\u00e9l\u00e9ration chantier colonie refus\u00e9e');
        return;
      }
      setState(p => {
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const newShips = { ...c.ships };
          const newDefenses = { ...c.defenses };
          if (result.completedType === 'ship') newShips[result.completedId!] = (colony.ships[result.completedId!] ?? 0) + (result.completedQuantity ?? 0);
          else newDefenses[result.completedId!] = (colony.defenses[result.completedId!] ?? 0) + (result.completedQuantity ?? 0);
          return { ...c, ships: newShips, defenses: newDefenses, shipyardQueue: c.shipyardQueue.filter(q => !(q.id === itemId && q.type === itemType)) };
        });
        const newState = { ...p, colonies: cols, solar: result.solar! };
        saveState(newState);
        return newState;
      });
      console.log('[GameContext] Colony shipyard rush confirmed by server:', colonyId, itemId);
    } catch (e) {
      console.log('[GameContext] Error calling server for colony shipyard rush:', e);
      setState(p => {
        const cols = (p.colonies ?? []).map(c => {
          if (c.id !== colonyId) return c;
          const newShips = { ...c.ships };
          const newDefenses = { ...c.defenses };
          if (itemType === 'ship') newShips[itemId] = Math.max(0, (newShips[itemId] ?? 0) - queueItem.remainingQuantity);
          else newDefenses[itemId] = Math.max(0, (newDefenses[itemId] ?? 0) - queueItem.remainingQuantity);
          return { ...c, ships: newShips, defenses: newDefenses, shipyardQueue: [...c.shipyardQueue, queueItem] };
        });
        return { ...p, colonies: cols, solar: p.solar + solarCost };
      });
      setActionError('Erreur r\u00e9seau acc\u00e9l\u00e9ration chantier colonie');
    } finally {
      pendingActionsRef.current.delete(actionKey);
    }
  }, [userId, saveState]);

  const getColonyMaxBuildableQuantity = useCallback((colonyId: string, cost: Partial<Resources>): number => {
    const colony = (stateRef.current.colonies ?? []).find(c => c.id === colonyId);
    if (!colony) return 0;
    const maxFer = (cost.fer ?? 0) > 0 ? Math.floor(colony.resources.fer / (cost.fer ?? 1)) : Infinity;
    const maxSilice = (cost.silice ?? 0) > 0 ? Math.floor(colony.resources.silice / (cost.silice ?? 1)) : Infinity;
    const maxXenogas = (cost.xenogas ?? 0) > 0 ? Math.floor(colony.resources.xenogas / (cost.xenogas ?? 1)) : Infinity;
    const maxVal = Math.min(maxFer, maxSilice, maxXenogas);
    return maxVal === Infinity ? 999 : Math.max(0, maxVal);
  }, []);

  const maxColonies = useMemo(() => {
    const astroLevel = state.research.astrophysics ?? 0;
    return Math.floor((astroLevel + 1) / 2);
  }, [state.research]);

  const needsUsername = useMemo(() => {
    return isLoaded && !state.username;
  }, [isLoaded, state.username]);

  const activePlanet = useMemo(() => {
    void displayTick;
    const elapsed = Math.max(0, (Date.now() - resourceSyncTimeRef.current) / 1000);

    const interpolateResources = (
      resources: { fer: number; silice: number; xenogas: number; energy: number },
      buildings: Record<string, number>,
      ships: Record<string, number>,
      pct?: { ferMine: number; siliceMine: number; xenogasRefinery: number; solarPlant: number; heliosRemorqueur: number },
    ) => {
      const prod = calculateProduction(buildings, state.research, ships, pct);
      const cap = getResourceStorageCapacity(buildings);
      return {
        fer: resources.fer >= cap.fer ? resources.fer : Math.min(resources.fer + (prod.fer / 3600) * elapsed, cap.fer),
        silice: resources.silice >= cap.silice ? resources.silice : Math.min(resources.silice + (prod.silice / 3600) * elapsed, cap.silice),
        xenogas: resources.xenogas >= cap.xenogas ? resources.xenogas : Math.min(resources.xenogas + (prod.xenogas / 3600) * elapsed, cap.xenogas),
        energy: prod.energy,
      };
    };

    if (!activePlanetId) {
      return {
        id: mainPlanetIdRef.current as string | null,
        isColony: false,
        planetName: state.planetName,
        coordinates: state.coordinates,
        buildings: state.buildings,
        ships: state.ships,
        defenses: state.defenses,
        resources: interpolateResources(state.resources, state.buildings, state.ships, state.productionPercentages),
        activeTimers: state.activeTimers,
        shipyardQueue: state.shipyardQueue,
      };
    }
    const colony = (state.colonies ?? []).find(c => c.id === activePlanetId);
    if (!colony) {
      return {
        id: mainPlanetIdRef.current as string | null,
        isColony: false,
        planetName: state.planetName,
        coordinates: state.coordinates,
        buildings: state.buildings,
        ships: state.ships,
        defenses: state.defenses,
        resources: interpolateResources(state.resources, state.buildings, state.ships, state.productionPercentages),
        activeTimers: state.activeTimers,
        shipyardQueue: state.shipyardQueue,
      };
    }
    return {
      id: activePlanetId,
      isColony: true,
      planetName: colony.planetName,
      coordinates: colony.coordinates,
      buildings: colony.buildings,
      ships: colony.ships,
      defenses: colony.defenses,
      resources: interpolateResources(colony.resources, colony.buildings, colony.ships, colony.productionPercentages),
      activeTimers: colony.activeTimers,
      shipyardQueue: colony.shipyardQueue,
    };
  }, [displayTick, activePlanetId, state.planetName, state.coordinates, state.buildings, state.ships, state.defenses, state.resources, state.activeTimers, state.shipyardQueue, state.colonies, state.research, state.productionPercentages]);

  const activeUpgradeBuilding = useCallback((buildingId: string) => {
    solarCooldownsRef.current.set(`building:${buildingId}`, Date.now() + SOLAR_COOLDOWN_MS);
    if (!activePlanetId) {
      void upgradeBuilding(buildingId);
    } else {
      void upgradeColonyBuilding(activePlanetId, buildingId);
    }
  }, [activePlanetId, upgradeBuilding, upgradeColonyBuilding]);

  const activeUpgradeResearch = useCallback((researchId: string) => {
    solarCooldownsRef.current.set(`research:${researchId}`, Date.now() + SOLAR_COOLDOWN_MS);
    if (!activePlanetId) {
      void upgradeResearch(researchId);
    } else {
      void upgradeColonyResearch(activePlanetId, researchId);
    }
  }, [activePlanetId, upgradeResearch, upgradeColonyResearch]);

  const activeBuildShipQueue = useCallback((shipId: string, quantity: number) => {
    solarCooldownsRef.current.set(`ship:${shipId}`, Date.now() + SOLAR_COOLDOWN_MS);
    if (!activePlanetId) {
      void buildShipQueue(shipId, quantity);
    } else {
      void buildColonyShipQueue(activePlanetId, shipId, quantity);
    }
  }, [activePlanetId, buildShipQueue, buildColonyShipQueue]);

  const activeBuildDefenseQueue = useCallback((defenseId: string, quantity: number) => {
    solarCooldownsRef.current.set(`defense:${defenseId}`, Date.now() + SOLAR_COOLDOWN_MS);
    if (!activePlanetId) {
      void buildDefenseQueue(defenseId, quantity);
    } else {
      void buildColonyDefenseQueue(activePlanetId, defenseId, quantity);
    }
  }, [activePlanetId, buildDefenseQueue, buildColonyDefenseQueue]);

  const activeRushWithSolar = useCallback((timerId: string, timerType: 'building' | 'research') => {
    if (!activePlanetId) {
      void rushWithSolar(timerId, timerType);
    } else {
      void rushColonyWithSolar(activePlanetId, timerId, timerType);
    }
  }, [activePlanetId, rushWithSolar, rushColonyWithSolar]);

  const activeCancelUpgrade = useCallback((timerId: string, timerType: 'building' | 'research') => {
    if (!activePlanetId) {
      void cancelUpgrade(timerId, timerType);
    } else {
      void cancelColonyUpgrade(activePlanetId, timerId, timerType);
    }
  }, [activePlanetId, cancelUpgrade, cancelColonyUpgrade]);

  const activeRushShipyardWithSolar = useCallback((itemId: string, itemType: 'ship' | 'defense') => {
    if (!activePlanetId) {
      void rushShipyardWithSolar(itemId, itemType);
    } else {
      void rushColonyShipyardWithSolar(activePlanetId, itemId, itemType);
    }
  }, [activePlanetId, rushShipyardWithSolar, rushColonyShipyardWithSolar]);

  const activeCancelShipyardQueue = useCallback((itemId: string, itemType: 'ship' | 'defense') => {
    if (!activePlanetId) {
      void cancelShipyardQueue(itemId, itemType);
    } else {
      void cancelColonyShipyardQueue(activePlanetId, itemId, itemType);
    }
  }, [activePlanetId, cancelShipyardQueue, cancelColonyShipyardQueue]);

  const activeGetMaxBuildableQuantity = useCallback((cost: Partial<Resources>): number => {
    if (!activePlanetId) {
      return getMaxBuildableQuantity(cost);
    }
    return getColonyMaxBuildableQuantity(activePlanetId, cost);
  }, [activePlanetId, getMaxBuildableQuantity, getColonyMaxBuildableQuantity]);

  const activeRenamePlanet = useCallback((newName: string) => {
    if (!activePlanetId) {
      void renamePlanet(newName);
    } else {
      void renameColony(activePlanetId, newName);
    }
  }, [activePlanetId, renamePlanet, renameColony]);



  const activeProduction = useMemo(() => {
    const pct = activePlanet.isColony
      ? (state.colonies ?? []).find(c => c.id === activePlanetId)?.productionPercentages
      : state.productionPercentages;
    return calculateProduction(activePlanet.buildings, state.research, activePlanet.ships, pct);
  }, [activePlanet.buildings, activePlanet.isColony, state.research, activePlanet.ships, state.productionPercentages, state.colonies, activePlanetId]);

  const applyTutorialReward = useCallback(async (reward: TutorialReward, stepId?: string) => {
    if (!userId || !mainPlanetIdRef.current || !stepId) {
      console.log('[GameContext] Tutorial reward skipped - missing userId/planetId/stepId');
      return;
    }

    console.log('[GameContext] Tutorial reward claiming via server - step:', stepId, 'type:', reward.type);

    try {
      const result = await trpcClient.actions.claimTutorialReward.mutate({
        userId,
        planetId: mainPlanetIdRef.current,
        stepId,
        rewardType: reward.type,
        fer: reward.fer,
        silice: reward.silice,
        xenogas: reward.xenogas,
        solar: reward.solar,
      });

      console.log('[TUTORIAL CLAIM] Server response:', JSON.stringify(result));

      if (result.success) {
        if (reward.type === 'resources' && result.resources) {
          setState(prev => ({
            ...prev,
            resources: {
              ...prev.resources,
              fer: result.resources!.fer,
              silice: result.resources!.silice,
              xenogas: result.resources!.xenogas,
            },
          }));
          console.log('[GameContext] Tutorial reward applied from server - resources:', result.resources);
        } else if (reward.type === 'solar' && result.solar != null) {
          setState(prev => ({ ...prev, solar: result.solar! }));
          console.log('[GameContext] Tutorial reward applied from server - solar:', result.solar);
        } else {
          setState(prev => {
            let newState = { ...prev };
            if (reward.type === 'resources') {
              newState.resources = {
                ...prev.resources,
                fer: prev.resources.fer + (reward.fer ?? 0),
                silice: prev.resources.silice + (reward.silice ?? 0),
                xenogas: prev.resources.xenogas + (reward.xenogas ?? 0),
              };
            } else if (reward.type === 'solar') {
              newState.solar = prev.solar + (reward.solar ?? 0);
            }
            return newState;
          });
        }
      } else {
        console.log('[GameContext] Tutorial reward rejected by server:', result.error);
      }
    } catch (e) {
      console.log('[GameContext] Error claiming tutorial reward:', e);
    }
  }, [userId]);

  const setActiveProductionPercentages = useCallback((percentages: { ferMine: number; siliceMine: number; xenogasRefinery: number; solarPlant: number; heliosRemorqueur: number }) => {
    console.log('[GameContext] Setting production percentages', percentages);
    const planetId = activePlanetId ?? mainPlanetIdRef.current;
    setState(prev => {
      if (!activePlanetId) {
        return { ...prev, productionPercentages: percentages };
      }
      const colonies = (prev.colonies ?? []).map(c =>
        c.id === activePlanetId ? { ...c, productionPercentages: percentages } : c
      );
      return { ...prev, colonies };
    });
    if (userId && planetId) {
      void trpcClient.actions.setProductionPercentages.mutate({
        userId,
        planetId,
        percentages,
      }).catch(e => console.log('[GameContext] Error persisting production percentages:', e));
    }
  }, [activePlanetId, userId]);

  const activeProductionPercentages = useMemo(() => {
    if (!activePlanetId) {
      return state.productionPercentages ?? { ferMine: 100, siliceMine: 100, xenogasRefinery: 100, solarPlant: 100, heliosRemorqueur: 100 };
    }
    const colony = (state.colonies ?? []).find(c => c.id === activePlanetId);
    return colony?.productionPercentages ?? { ferMine: 100, siliceMine: 100, xenogasRefinery: 100, solarPlant: 100, heliosRemorqueur: 100 };
  }, [activePlanetId, state.productionPercentages, state.colonies]);

  const isLoading = !isLoaded && userId !== null;

  const clearActionError = useCallback(() => setActionError(null), []);

  const getSolarCooldownEnd = useCallback((id: string, type: 'building' | 'research' | 'ship' | 'defense'): number => {
    const key = `${type}:${id}`;
    const end = solarCooldownsRef.current.get(key) ?? 0;
    if (end <= Date.now()) {
      solarCooldownsRef.current.delete(key);
      return 0;
    }
    return end;
  }, []);

  return useMemo(() => ({
    state,
    production,
    upgradeBuilding,
    upgradeResearch,
    buildShipQueue,
    buildDefenseQueue,
    rushWithSolar,
    rushShipyardWithSolar,
    cancelUpgrade,
    cancelShipyardQueue,
    getTimerForId,
    isUpgrading,
    getShipyardQueueItem,
    getMaxBuildableQuantity,
    setUsername,
    renamePlanet,
    deductFleetShips,
    needsUsername,
    userId,
    userEmail,
    isLoading,
    addColony,
    removeColony,
    renameColony,
    upgradeColonyBuilding,
    buildColonyShipQueue,
    buildColonyDefenseQueue,
    cancelColonyUpgrade,
    upgradeColonyResearch,
    rushColonyWithSolar,
    cancelColonyShipyardQueue,
    rushColonyShipyardWithSolar,
    getColonyMaxBuildableQuantity,
    maxColonies,
    activePlanetId,
    setActivePlanetId,
    activePlanet,
    activeUpgradeBuilding,
    activeUpgradeResearch,
    activeBuildShipQueue,
    activeBuildDefenseQueue,
    activeRushWithSolar,
    activeCancelUpgrade,
    activeRushShipyardWithSolar,
    activeCancelShipyardQueue,
    activeGetMaxBuildableQuantity,
    activeRenamePlanet,
    activeProduction,
    activeProductionPercentages,
    setActiveProductionPercentages,
    applyTutorialReward,
    actionError,
    clearActionError,
    getSolarCooldownEnd,
  }), [
    state, production, upgradeBuilding, upgradeResearch, buildShipQueue, buildDefenseQueue,
    rushWithSolar, rushShipyardWithSolar, cancelUpgrade, cancelShipyardQueue, getTimerForId,
    isUpgrading, getShipyardQueueItem, getMaxBuildableQuantity, setUsername, renamePlanet,
    deductFleetShips, needsUsername, userId, userEmail, isLoading,
    addColony, removeColony, renameColony, upgradeColonyBuilding, buildColonyShipQueue,
    buildColonyDefenseQueue, cancelColonyUpgrade, upgradeColonyResearch, rushColonyWithSolar,
    cancelColonyShipyardQueue, rushColonyShipyardWithSolar, getColonyMaxBuildableQuantity,
    maxColonies, activePlanetId, setActivePlanetId, activePlanet, activeUpgradeBuilding,
    activeUpgradeResearch, activeBuildShipQueue, activeBuildDefenseQueue, activeRushWithSolar,
    activeCancelUpgrade, activeRushShipyardWithSolar, activeCancelShipyardQueue,
    activeGetMaxBuildableQuantity, activeRenamePlanet, activeProduction, activeProductionPercentages,
    setActiveProductionPercentages,
    applyTutorialReward,
    actionError, clearActionError, getSolarCooldownEnd,
  ]);
});
