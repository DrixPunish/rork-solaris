import { createTRPCRouter, publicProcedure } from "../create-context";
import { supabase } from "@/backend/supabase";
import { z } from "zod";
import { BUILDINGS, RESEARCH, SHIPS, DEFENSES } from "@/constants/gameData";
import {
  checkPrerequisites,
} from "@/utils/gameCalculations";

interface RpcResult {
  success: boolean;
  error?: string;
  resources?: { fer: number; silice: number; xenogas: number; energy: number };
  timer?: { id: string; type: string; targetLevel: number; startTime: number; endTime: number };
  queueItem?: {
    id: string;
    type: string;
    totalQuantity: number;
    remainingQuantity: number;
    buildTimePerUnit: number;
    currentUnitStartTime: number;
    currentUnitEndTime: number;
  };
  solar?: number;
  completedId?: string;
  completedType?: string;
  completedLevel?: number;
  completedQuantity?: number;
}

async function loadPlanetBuildings(planetId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("planet_buildings")
    .select("building_id, level")
    .eq("planet_id", planetId);
  const result: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ building_id: string; level: number }>) {
    result[r.building_id] = r.level;
  }
  return result;
}

async function loadPlayerResearch(userId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("player_research")
    .select("research_id, level")
    .eq("user_id", userId);
  const result: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ research_id: string; level: number }>) {
    result[r.research_id] = r.level;
  }
  return result;
}


export const actionsRouter = createTRPCRouter({
  startBuilding: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      buildingId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, buildingId } = input;
      console.log("[Actions] startBuilding:", buildingId, "planet:", planetId);

      const building = BUILDINGS.find(b => b.id === buildingId);
      if (!building) return { success: false, error: "Building not found" };

      const [buildings, research] = await Promise.all([
        loadPlanetBuildings(planetId),
        loadPlayerResearch(userId),
      ]);

      const { met } = checkPrerequisites(building.prerequisites, buildings, research);
      if (!met) return { success: false, error: "Prerequisites not met" };

      const { data, error } = await supabase.rpc("rpc_build_structure", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_building_id: buildingId,
      });

      if (error) {
        console.log("[Actions] RPC error startBuilding:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Building rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Building started (atomic):", buildingId);
      return {
        success: true,
        resources: result.resources,
        timer: result.timer ? {
          id: result.timer.id,
          type: "building" as const,
          targetLevel: result.timer.targetLevel,
          startTime: result.timer.startTime,
          endTime: result.timer.endTime,
        } : undefined,
      };
    }),

  startResearch: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      researchId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, researchId } = input;
      console.log("[Actions] startResearch:", researchId, "planet:", planetId);

      const researchDef = RESEARCH.find(r => r.id === researchId);
      if (!researchDef) return { success: false, error: "Research not found" };

      const [buildings, research] = await Promise.all([
        loadPlanetBuildings(planetId),
        loadPlayerResearch(userId),
      ]);

      const { met } = checkPrerequisites(researchDef.prerequisites, buildings, research);
      if (!met) return { success: false, error: "Prerequisites not met" };

      const { data, error } = await supabase.rpc("rpc_start_research", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_research_id: researchId,
      });

      if (error) {
        console.log("[Actions] RPC error startResearch:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Research rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Research started (atomic):", researchId);
      return {
        success: true,
        resources: result.resources,
        timer: result.timer ? {
          id: result.timer.id,
          type: "research" as const,
          targetLevel: result.timer.targetLevel,
          startTime: result.timer.startTime,
          endTime: result.timer.endTime,
        } : undefined,
      };
    }),

  buildShips: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      shipId: z.string(),
      quantity: z.number().min(1),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, shipId, quantity } = input;
      console.log("[Actions] buildShips:", shipId, "x", quantity, "planet:", planetId);

      const ship = SHIPS.find(s => s.id === shipId);
      if (!ship) return { success: false, error: "Ship not found" };

      const [buildings, research] = await Promise.all([
        loadPlanetBuildings(planetId),
        loadPlayerResearch(userId),
      ]);

      const { met } = checkPrerequisites(ship.prerequisites, buildings, research);
      if (!met) return { success: false, error: "Prerequisites not met" };

      const { data, error } = await supabase.rpc("rpc_build_ships", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_ship_id: shipId,
        p_quantity: quantity,
      });

      if (error) {
        console.log("[Actions] RPC error buildShips:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Ships rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Ships queued (atomic):", shipId, "x", quantity);
      return {
        success: true,
        resources: result.resources,
        queueItem: result.queueItem ? {
          id: result.queueItem.id,
          type: "ship" as const,
          totalQuantity: result.queueItem.totalQuantity,
          remainingQuantity: result.queueItem.remainingQuantity,
          buildTimePerUnit: result.queueItem.buildTimePerUnit,
          currentUnitStartTime: result.queueItem.currentUnitStartTime,
          currentUnitEndTime: result.queueItem.currentUnitEndTime,
        } : undefined,
      };
    }),

  buildDefenses: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      defenseId: z.string(),
      quantity: z.number().min(1),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, defenseId, quantity } = input;
      console.log("[Actions] buildDefenses:", defenseId, "x", quantity, "planet:", planetId);

      const defense = DEFENSES.find(d => d.id === defenseId);
      if (!defense) return { success: false, error: "Defense not found" };

      const [buildings, research] = await Promise.all([
        loadPlanetBuildings(planetId),
        loadPlayerResearch(userId),
      ]);

      const { met } = checkPrerequisites(defense.prerequisites, buildings, research);
      if (!met) return { success: false, error: "Prerequisites not met" };

      const { data, error } = await supabase.rpc("rpc_build_defenses", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_defense_id: defenseId,
        p_quantity: quantity,
      });

      if (error) {
        console.log("[Actions] RPC error buildDefenses:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Defenses rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Defenses queued (atomic):", defenseId, "x", quantity);
      return {
        success: true,
        resources: result.resources,
        queueItem: result.queueItem ? {
          id: result.queueItem.id,
          type: "defense" as const,
          totalQuantity: result.queueItem.totalQuantity,
          remainingQuantity: result.queueItem.remainingQuantity,
          buildTimePerUnit: result.queueItem.buildTimePerUnit,
          currentUnitStartTime: result.queueItem.currentUnitStartTime,
          currentUnitEndTime: result.queueItem.currentUnitEndTime,
        } : undefined,
      };
    }),

  rushTimer: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      timerId: z.string(),
      timerType: z.enum(["building", "research"]),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, timerId, timerType } = input;
      console.log("[Actions] rushTimer:", timerId, timerType, "planet:", planetId);

      const { data, error } = await supabase.rpc("rpc_rush_timer", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_timer_id: timerId,
        p_timer_type: timerType,
      });

      if (error) {
        console.log("[Actions] RPC error rushTimer:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Rush rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Rush completed (atomic):", timerId, timerType);
      return {
        success: true,
        solar: result.solar,
        completedId: result.completedId,
        completedType: result.completedType,
        completedLevel: result.completedLevel,
      };
    }),

  cancelTimer: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      timerId: z.string(),
      timerType: z.enum(["building", "research"]),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, timerId, timerType } = input;
      console.log("[Actions] cancelTimer:", timerId, timerType, "planet:", planetId);

      const { data, error } = await supabase.rpc("rpc_cancel_timer", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_timer_id: timerId,
        p_timer_type: timerType,
      });

      if (error) {
        console.log("[Actions] RPC error cancelTimer:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Cancel rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Timer cancelled (atomic):", timerId);
      return { success: true, resources: result.resources };
    }),

  rushShipyard: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      itemId: z.string(),
      itemType: z.enum(["ship", "defense"]),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, itemId, itemType } = input;
      console.log("[Actions] rushShipyard:", itemId, itemType, "planet:", planetId);

      const { data, error } = await supabase.rpc("rpc_rush_shipyard", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_item_id: itemId,
        p_item_type: itemType,
      });

      if (error) {
        console.log("[Actions] RPC error rushShipyard:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Shipyard rush rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Shipyard rushed (atomic):", itemId, "x", result.completedQuantity);
      return {
        success: true,
        solar: result.solar,
        completedId: result.completedId,
        completedType: result.completedType,
        completedQuantity: result.completedQuantity,
      };
    }),

  renamePlanet: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      newName: z.string().min(1).max(24),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, newName } = input;
      const trimmed = newName.trim();
      console.log("[Actions] renamePlanet:", planetId, "to", trimmed);

      if (!trimmed || trimmed.length > 24) {
        return { success: false, error: "Nom invalide (1-24 caractères)" };
      }

      const { data, error } = await supabase
        .from("planets")
        .update({ planet_name: trimmed })
        .eq("id", planetId)
        .eq("user_id", userId)
        .select("id, planet_name")
        .single();

      if (error) {
        console.log("[Actions] renamePlanet error:", error.message);
        return { success: false, error: error.message };
      }

      if (!data) {
        return { success: false, error: "Planète introuvable ou non autorisée" };
      }

      const isMain = await supabase
        .from("planets")
        .select("is_main")
        .eq("id", planetId)
        .single();

      if (isMain.data?.is_main) {
        await supabase
          .from("players")
          .update({ planet_name: trimmed })
          .eq("user_id", userId);
      }

      console.log("[Actions] Planet renamed:", planetId, "→", trimmed);
      return { success: true, name: trimmed };
    }),

  sendFleet: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      ships: z.record(z.string(), z.number()),
      resources: z.object({ fer: z.number(), silice: z.number(), xenogas: z.number() }).optional(),
      missionType: z.string(),
      targetCoords: z.array(z.number()),
      targetPlayerId: z.string().nullable().optional(),
      targetUsername: z.string().nullable().optional(),
      targetPlanet: z.string().nullable().optional(),
      senderUsername: z.string(),
      senderPlanet: z.string(),
      senderCoords: z.array(z.number()),
      travelTimeSeconds: z.number(),
    }))
    .mutation(async ({ input }) => {
      console.log("[Actions] sendFleet:", input.missionType, "from", input.planetId);

      const cargo = input.resources ?? { fer: 0, silice: 0, xenogas: 0 };
      const { data: deductResult, error: deductError } = await supabase.rpc("rpc_send_fleet", {
        p_planet_id: input.planetId,
        p_ships: input.ships,
        p_cargo_fer: cargo.fer,
        p_cargo_silice: cargo.silice,
        p_cargo_xenogas: cargo.xenogas,
      });

      if (deductError) {
        console.log("[Actions] RPC error sendFleet:", deductError.message);
        return { success: false, error: deductError.message };
      }

      const deductRes = deductResult as { success: boolean; error?: string };
      if (!deductRes.success) {
        console.log("[Actions] Fleet deduction rejected:", deductRes.error);
        return { success: false, error: deductRes.error };
      }

      const now = Date.now();
      const arrivalTime = now + input.travelTimeSeconds * 1000;
      const returnTime = arrivalTime + input.travelTimeSeconds * 1000;

      const { error: insertError } = await supabase.from("fleet_missions").insert({
        sender_id: input.userId,
        sender_username: input.senderUsername,
        sender_planet: input.senderPlanet,
        sender_coords: input.senderCoords,
        target_coords: input.targetCoords,
        target_player_id: input.targetPlayerId ?? null,
        target_username: input.targetUsername ?? null,
        target_planet: input.targetPlanet ?? null,
        mission_type: input.missionType,
        ships: input.ships,
        resources: cargo,
        departure_time: now,
        arrival_time: arrivalTime,
        return_time: returnTime,
        status: "traveling",
        processed: false,
      });

      if (insertError) {
        console.log("[Actions] Error inserting fleet mission:", insertError.message);
        return { success: false, error: insertError.message };
      }

      console.log("[Actions] Fleet sent (atomic):", input.missionType, "arrival in", input.travelTimeSeconds, "s");
      return { success: true, departureTime: now, arrivalTime, returnTime };
    }),

  claimTutorialReward: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      stepId: z.string(),
      rewardType: z.enum(["resources", "solar"]),
      fer: z.number().optional(),
      silice: z.number().optional(),
      xenogas: z.number().optional(),
      solar: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      console.log("[Actions] claimTutorialReward:", input.stepId, input.rewardType, "for", input.userId);

      const { data, error } = await supabase.rpc("rpc_claim_tutorial_reward", {
        p_user_id: input.userId,
        p_planet_id: input.planetId,
        p_step_id: input.stepId,
        p_reward_type: input.rewardType,
        p_fer: input.fer ?? 0,
        p_silice: input.silice ?? 0,
        p_xenogas: input.xenogas ?? 0,
        p_solar: input.solar ?? 0,
      });

      if (error) {
        console.log("[Actions] RPC error claimTutorialReward:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as { success: boolean; error?: string; solar?: number };
      if (!result.success) {
        console.log("[Actions] Tutorial reward rejected:", result.error);
        return { success: false, error: result.error };
      }
      console.log("[Actions] Tutorial reward claimed (atomic):", input.stepId, input.rewardType);
      return { success: true, solar: result.solar };
    }),

  setProductionPercentages: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      percentages: z.object({
        ferMine: z.number(),
        siliceMine: z.number(),
        xenogasRefinery: z.number(),
        solarPlant: z.number(),
        heliosRemorqueur: z.number(),
      }),
    }))
    .mutation(async ({ input }) => {
      console.log("[Actions] setProductionPercentages for planet:", input.planetId);

      const { error } = await supabase
        .from("planets")
        .update({ production_percentages: input.percentages })
        .eq("id", input.planetId)
        .eq("user_id", input.userId);

      if (error) {
        console.log("[Actions] Error saving production percentages:", error.message);
        return { success: false, error: error.message };
      }

      console.log("[Actions] Production percentages saved");
      return { success: true };
    }),

  cancelShipyard: publicProcedure
    .input(z.object({
      userId: z.string(),
      planetId: z.string(),
      itemId: z.string(),
      itemType: z.enum(["ship", "defense"]),
    }))
    .mutation(async ({ input }) => {
      const { userId, planetId, itemId, itemType } = input;
      console.log("[Actions] cancelShipyard:", itemId, itemType, "planet:", planetId);

      const { data, error } = await supabase.rpc("rpc_cancel_shipyard", {
        p_user_id: userId,
        p_planet_id: planetId,
        p_item_id: itemId,
        p_item_type: itemType,
      });

      if (error) {
        console.log("[Actions] RPC error cancelShipyard:", error.message);
        return { success: false, error: error.message };
      }

      const result = data as RpcResult;
      if (!result.success) {
        console.log("[Actions] Shipyard cancel rejected:", result.error);
        return { success: false, error: result.error };
      }

      console.log("[Actions] Shipyard cancelled (atomic):", itemId);
      return { success: true, resources: result.resources };
    }),
});
