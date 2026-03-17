import { createTRPCRouter, publicProcedure } from "../create-context";
import { supabase } from "@/backend/supabase";

interface BuildingDefRow {
  building_id: string;
  base_cost_fer: number;
  base_cost_silice: number;
  base_cost_xenogas: number;
  cost_factor: number;
  base_time: number;
  time_factor: number;
}

interface ResearchDefRow {
  research_id: string;
  base_cost_fer: number;
  base_cost_silice: number;
  base_cost_xenogas: number;
  cost_factor: number;
  base_time: number;
  time_factor: number;
}

interface ShipDefRow {
  ship_id: string;
  cost_fer: number;
  cost_silice: number;
  cost_xenogas: number;
  build_time: number;
  base_attack: number;
  base_shield: number;
  base_hull: number;
  base_speed: number;
  base_cargo: number;
}

interface DefenseDefRow {
  defense_id: string;
  cost_fer: number;
  cost_silice: number;
  cost_xenogas: number;
  build_time: number;
  base_attack: number;
  base_shield: number;
  base_hull: number;
}

export const defsRouter = createTRPCRouter({
  getBuildingDefs: publicProcedure.query(async () => {
    const { data, error } = await supabase
      .from("building_defs")
      .select("*");

    if (error) {
      console.log("[Defs] Error fetching building_defs:", error.message);
      return { success: false as const, error: error.message, data: [] };
    }

    const rows = (data ?? []) as BuildingDefRow[];
    return {
      success: true as const,
      data: rows.map((r) => ({
        id: r.building_id,
        baseCostFer: r.base_cost_fer,
        baseCostSilice: r.base_cost_silice,
        baseCostXenogas: r.base_cost_xenogas,
        costFactor: r.cost_factor,
        baseTime: r.base_time,
        timeFactor: r.time_factor,
      })),
    };
  }),

  getResearchDefs: publicProcedure.query(async () => {
    const { data, error } = await supabase
      .from("research_defs")
      .select("*");

    if (error) {
      console.log("[Defs] Error fetching research_defs:", error.message);
      return { success: false as const, error: error.message, data: [] };
    }

    const rows = (data ?? []) as ResearchDefRow[];
    return {
      success: true as const,
      data: rows.map((r) => ({
        id: r.research_id,
        baseCostFer: r.base_cost_fer,
        baseCostSilice: r.base_cost_silice,
        baseCostXenogas: r.base_cost_xenogas,
        costFactor: r.cost_factor,
        baseTime: r.base_time,
        timeFactor: r.time_factor,
      })),
    };
  }),

  getShipDefs: publicProcedure.query(async () => {
    const { data, error } = await supabase
      .from("ship_defs")
      .select("*");

    if (error) {
      console.log("[Defs] Error fetching ship_defs:", error.message);
      return { success: false as const, error: error.message, data: [] };
    }

    const rows = (data ?? []) as ShipDefRow[];
    return {
      success: true as const,
      data: rows.map((r) => ({
        id: r.ship_id,
        costFer: r.cost_fer,
        costSilice: r.cost_silice,
        costXenogas: r.cost_xenogas,
        buildTime: r.build_time,
        baseAttack: r.base_attack,
        baseShield: r.base_shield,
        baseHull: r.base_hull,
        baseSpeed: r.base_speed,
        baseCargo: r.base_cargo,
      })),
    };
  }),

  getDefenseDefs: publicProcedure.query(async () => {
    const { data, error } = await supabase
      .from("defense_defs")
      .select("*");

    if (error) {
      console.log("[Defs] Error fetching defense_defs:", error.message);
      return { success: false as const, error: error.message, data: [] };
    }

    const rows = (data ?? []) as DefenseDefRow[];
    return {
      success: true as const,
      data: rows.map((r) => ({
        id: r.defense_id,
        costFer: r.cost_fer,
        costSilice: r.cost_silice,
        costXenogas: r.cost_xenogas,
        buildTime: r.build_time,
        baseAttack: r.base_attack,
        baseShield: r.base_shield,
        baseHull: r.base_hull,
      })),
    };
  }),

  getAllDefs: publicProcedure.query(async () => {
    const [buildings, research, ships, defenses] = await Promise.all([
      supabase.from("building_defs").select("*"),
      supabase.from("research_defs").select("*"),
      supabase.from("ship_defs").select("*"),
      supabase.from("defense_defs").select("*"),
    ]);

    if (buildings.error || research.error || ships.error || defenses.error) {
      const err = buildings.error?.message || research.error?.message || ships.error?.message || defenses.error?.message;
      console.log("[Defs] Error fetching all defs:", err);
      return { success: false as const, error: err };
    }

    const buildingRows = (buildings.data ?? []) as BuildingDefRow[];
    const researchRows = (research.data ?? []) as ResearchDefRow[];
    const shipRows = (ships.data ?? []) as ShipDefRow[];
    const defenseRows = (defenses.data ?? []) as DefenseDefRow[];

    return {
      success: true as const,
      buildings: buildingRows.map((r) => ({
        id: r.building_id,
        baseCostFer: r.base_cost_fer,
        baseCostSilice: r.base_cost_silice,
        baseCostXenogas: r.base_cost_xenogas,
        costFactor: r.cost_factor,
        baseTime: r.base_time,
        timeFactor: r.time_factor,
      })),
      research: researchRows.map((r) => ({
        id: r.research_id,
        baseCostFer: r.base_cost_fer,
        baseCostSilice: r.base_cost_silice,
        baseCostXenogas: r.base_cost_xenogas,
        costFactor: r.cost_factor,
        baseTime: r.base_time,
        timeFactor: r.time_factor,
      })),
      ships: shipRows.map((r) => ({
        id: r.ship_id,
        costFer: r.cost_fer,
        costSilice: r.cost_silice,
        costXenogas: r.cost_xenogas,
        buildTime: r.build_time,
        baseAttack: r.base_attack,
        baseShield: r.base_shield,
        baseHull: r.base_hull,
        baseSpeed: r.base_speed,
        baseCargo: r.base_cargo,
      })),
      defenses: defenseRows.map((r) => ({
        id: r.defense_id,
        costFer: r.cost_fer,
        costSilice: r.cost_silice,
        costXenogas: r.cost_xenogas,
        buildTime: r.build_time,
        baseAttack: r.base_attack,
        baseShield: r.base_shield,
        baseHull: r.base_hull,
      })),
    };
  }),
});
