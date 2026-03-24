import { createTRPCRouter, publicProcedure } from "../create-context";
import { runWorldTick } from "@/backend/worldTick";
import { supabase } from "@/backend/supabase";
import { z } from "zod";

interface LeaderboardRow {
  player_id: string;
  username: string;
  coordinates: number[];
  total_points: number;
  building_points: number;
  research_points: number;
  fleet_points: number;
  defense_points: number;
  last_updated: string;
  rank: number;
}

export const worldRouter = createTRPCRouter({
  tick: publicProcedure.mutation(async () => {
    const result = await runWorldTick();
    return {
      success: true,
      ...result,
      timestamp: Date.now(),
    };
  }),

  status: publicProcedure.query(() => {
    return {
      running: true,
      timestamp: Date.now(),
    };
  }),

  getActiveMissions: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const { data, error } = await supabase
        .from('fleet_missions')
        .select('*')
        .or(`sender_id.eq.${input.userId},target_player_id.eq.${input.userId}`)
        .in('mission_phase', ['en_route', 'arrived', 'returning'])
        .order('arrival_time', { ascending: true });

      if (error) {
        console.log('[tRPC] Error fetching active missions:', error.message);
        return { success: false as const, error: error.message, missions: [] };
      }

      console.log('[tRPC] Active missions for', input.userId, ':', (data ?? []).length);
      return { success: true as const, missions: data ?? [] };
    }),

  deleteEspionageReport: publicProcedure
    .input(z.object({ reportId: z.string(), playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('espionage_reports')
        .delete()
        .eq('id', input.reportId)
        .eq('player_id', input.playerId);
      if (error) {
        console.log('[tRPC] Error deleting espionage report:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] Espionage report deleted:', input.reportId);
      return { success: true };
    }),

  deleteAllEspionageReports: publicProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('espionage_reports')
        .delete()
        .eq('player_id', input.playerId);
      if (error) {
        console.log('[tRPC] Error deleting all espionage reports:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] All espionage reports deleted for:', input.playerId);
      return { success: true };
    }),

  deleteCombatReport: publicProcedure
    .input(z.object({ reportId: z.string(), playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('combat_reports')
        .delete()
        .eq('id', input.reportId);
      if (error) {
        console.log('[tRPC] Error deleting combat report:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] Combat report deleted:', input.reportId);
      return { success: true };
    }),

  deleteAllCombatReports: publicProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('combat_reports')
        .delete()
        .or(`attacker_id.eq.${input.playerId},defender_id.eq.${input.playerId}`);
      if (error) {
        console.log('[tRPC] Error deleting all combat reports:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] All combat reports deleted for:', input.playerId);
      return { success: true };
    }),

  deleteTransportReport: publicProcedure
    .input(z.object({ missionId: z.string(), playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('fleet_missions')
        .delete()
        .eq('id', input.missionId);
      if (error) {
        console.log('[tRPC] Error deleting transport report:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] Transport report deleted:', input.missionId);
      return { success: true };
    }),

  insertTargetEspionageNotification: publicProcedure
    .input(z.object({
      targetPlayerId: z.string(),
      targetCoords: z.array(z.number()),
      probesSent: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { error } = await supabase
        .from('espionage_reports')
        .insert({
          player_id: input.targetPlayerId,
          target_player_id: null,
          target_username: null,
          target_coords: input.targetCoords,
          target_planet_name: null,
          resources: null,
          buildings: null,
          research: null,
          ships: null,
          defenses: null,
          probes_sent: 0,
          probes_lost: 0,
        });
      if (error) {
        console.log('[tRPC] Error inserting target espionage notification:', error.message);
        return { success: false, error: error.message };
      }
      console.log('[tRPC] Target espionage notification inserted for:', input.targetPlayerId);
      return { success: true };
    }),

  getLeaderboard: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 100;
      const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit });

      if (error) {
        console.log('[tRPC] Error fetching leaderboard:', error.message);
        return { success: false as const, error: error.message, players: [] };
      }

      const rows = (data ?? []) as LeaderboardRow[];
      console.log('[tRPC] Leaderboard fetched:', rows.length, 'players');
      return { success: true as const, players: rows };
    }),

  getPlanetResources: publicProcedure
    .input(z.object({ planetId: z.string(), userId: z.string() }))
    .query(async ({ input }) => {
      const { data, error } = await supabase
        .from('planet_resources')
        .select('fer, silice, xenogas, energy')
        .eq('planet_id', input.planetId)
        .maybeSingle();

      if (error) {
        console.log('[tRPC] Error fetching planet resources:', error.message);
        return { success: false as const, error: error.message };
      }

      if (!data) {
        return { success: false as const, error: 'Planet not found' };
      }

      console.log('[tRPC] Planet resources fetched:', input.planetId, 'fer:', data.fer, 'silice:', data.silice, 'xenogas:', data.xenogas);
      return {
        success: true as const,
        fer: data.fer as number,
        silice: data.silice as number,
        xenogas: data.xenogas as number,
        energy: data.energy as number,
      };
    }),

  getPlayerScore: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const { data, error } = await supabase
        .from('player_scores')
        .select('*')
        .eq('player_id', input.userId)
        .maybeSingle();

      if (error) {
        console.log('[tRPC] Error fetching player score:', error.message);
        return { success: false as const, error: error.message };
      }

      return { success: true as const, score: data };
    }),

  getPlayerAttackStatus: publicProcedure
    .input(z.object({ attackerId: z.string(), defenderId: z.string() }))
    .query(async ({ input }) => {
      const { attackerId, defenderId } = input;
      console.log('[tRPC] getPlayerAttackStatus:', attackerId, 'vs', defenderId);

      const { data: attackerData } = await supabase
        .from('player_scores')
        .select('total_points')
        .eq('player_id', attackerId)
        .maybeSingle();

      const { data: defenderData } = await supabase
        .from('player_scores')
        .select('total_points')
        .eq('player_id', defenderId)
        .maybeSingle();

      const attacker_pts = (attackerData?.total_points as number) ?? 0;
      const defender_pts = (defenderData?.total_points as number) ?? 0;

      if (attacker_pts < 100) {
        return { can_attack: false, reason: 'noob_shield_attacker' as const, attacker_pts, defender_pts };
      }
      if (defender_pts < 100) {
        return { can_attack: false, reason: 'noob_shield_defender' as const, attacker_pts, defender_pts };
      }
      if (defender_pts <= attacker_pts * 0.5) {
        return { can_attack: false, reason: 'point_gap' as const, attacker_pts, defender_pts };
      }

      return { can_attack: true, reason: null, attacker_pts, defender_pts };
    }),

  recalcPlayerScore: publicProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ input }) => {
      const { data, error } = await supabase.rpc('recalc_player_score', { p_player_id: input.userId });

      if (error) {
        console.log('[tRPC] Error recalcing player score:', error.message);
        return { success: false as const, error: error.message };
      }

      return { success: true as const, ...(data as Record<string, unknown>) };
    }),

  calculateFlightTime: publicProcedure
    .input(z.object({
      userId: z.string(),
      senderCoords: z.array(z.number()),
      targetCoords: z.array(z.number()),
      ships: z.record(z.string(), z.number()),
    }))
    .query(async ({ input }) => {
      const { data, error } = await supabase.rpc('rpc_calculate_flight_time', {
        p_sender_coords: input.senderCoords,
        p_target_coords: input.targetCoords,
        p_fleet_ships: input.ships,
        p_user_id: input.userId,
      });

      if (error) {
        console.log('[tRPC] Error calculating flight time:', error.message);
        return { success: false as const, error: error.message };
      }

      const result = data as {
        success: boolean;
        error?: string;
        distance?: number;
        slowest_speed?: number;
        flight_time_sec?: number;
        return_time_sec?: number;
        fuel_cost?: number;
      };
      console.log('[tRPC] Flight time calculated:', JSON.stringify(result));
      if (!result.success) {
        return { success: false as const, error: result.error ?? 'Unknown error' };
      }
      return {
        success: true as const,
        distance: result.distance ?? 0,
        slowest_speed: result.slowest_speed ?? 0,
        flight_time_sec: result.flight_time_sec ?? 30,
        return_time_sec: result.return_time_sec ?? 30,
        fuel_cost: result.fuel_cost ?? 0,
      };
    }),

  deleteAllTransportReports: publicProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ input }) => {
      const { error: e1 } = await supabase
        .from('fleet_missions')
        .delete()
        .eq('sender_id', input.playerId)
        .in('mission_type', ['transport', 'recycle'])
        .eq('status', 'completed');
      if (e1) console.log('[tRPC] Error deleting sent transport reports:', e1.message);

      const { error: e2 } = await supabase
        .from('fleet_missions')
        .delete()
        .eq('target_player_id', input.playerId)
        .neq('sender_id', input.playerId)
        .eq('mission_type', 'transport')
        .eq('processed', true)
        .eq('status', 'completed');
      if (e2) console.log('[tRPC] Error deleting received transport reports:', e2.message);

      console.log('[tRPC] All transport reports deleted for:', input.playerId);
      return { success: true };
    }),
});
