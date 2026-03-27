import createContextHook from '@nkzw/create-context-hook';
import { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useGame } from '@/contexts/GameContext';
import { FleetMission, FleetDispatchParams, EspionageReport, CombatReport, TransportReport } from '@/types/fleet';
import { trpc } from '@/lib/trpc';
import { trpcClient } from '@/lib/trpc';

const DELETED_REPORTS_KEY = 'deleted_report_ids';

export const [FleetProvider, useFleet] = createContextHook(() => {
  useAuth();
  const {
    state, userId, forceResync, activePlanet: gamActivePlanet,
  } = useGame();
  const queryClient = useQueryClient();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(DELETED_REPORTS_KEY).then(raw => {
      if (raw) {
        try {
          const arr = JSON.parse(raw) as string[];
          if (arr.length > 0) {
            setDeletedIds(new Set(arr));
            console.log('[FleetContext] Loaded', arr.length, 'deleted report IDs from storage');
          }
        } catch (e) {
          console.log('[FleetContext] Error parsing deleted IDs:', e);
        }
      }
    }).catch(() => {});
  }, []);

  const markAsDeleted = useCallback((...ids: string[]) => {
    setDeletedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      const arr = Array.from(next).slice(-500);
      AsyncStorage.setItem(DELETED_REPORTS_KEY, JSON.stringify(arr)).catch(() => {});
      return next;
    });
  }, []);

  const missionsQuery = useQuery({
    queryKey: ['fleet_missions', userId],
    queryFn: async () => {
      if (!userId) return [];

      try {
        const result = await trpcClient.world.getActiveMissions.query({ userId });
        if (result.success) {
          console.log('[Fleet] Missions loaded via tRPC:', result.missions.length, 'phases:', result.missions.map((m: Record<string, unknown>) => m.mission_phase));
          return result.missions as FleetMission[];
        }
        console.log('[Fleet] tRPC getActiveMissions failed:', result.error);
      } catch (e) {
        console.log('[Fleet] tRPC getActiveMissions error, falling back to direct query:', e);
      }

      const { data, error } = await supabase
        .from('fleet_missions')
        .select('*')
        .or(`sender_id.eq.${userId},target_player_id.eq.${userId}`)
        .in('mission_phase', ['en_route', 'arrived', 'returning'])
        .order('arrival_time', { ascending: true });
      if (error) {
        console.log('[Fleet] Error loading missions (fallback):', error.message);
        return [];
      }
      console.log('[Fleet] Missions loaded (fallback):', (data ?? []).length);
      return (data ?? []) as FleetMission[];
    },
    enabled: !!userId,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const activeMissions = useMemo(() => missionsQuery.data ?? [], [missionsQuery.data]);

  const sendFleetMutation = useMutation({
    mutationFn: async (params: FleetDispatchParams) => {
      if (!userId) throw new Error('Not authenticated');
      const planetId = activePlanet.id;
      if (!planetId) throw new Error('Planet ID not available');

      console.log('[FleetContext] Sending fleet', params.missionType, 'to', params.targetCoords);

      const senderCoords = activePlanet.coordinates;
      const senderPlanet = activePlanet.planetName;

      const result = await trpcClient.actions.sendFleet.mutate({
        userId,
        planetId,
        ships: params.ships,
        resources: params.resources,
        missionType: params.missionType,
        targetCoords: params.targetCoords,
        targetPlayerId: params.targetPlayerId,
        targetUsername: params.targetUsername,
        targetPlanet: params.targetPlanet,
        senderUsername: state.username ?? '',
        senderPlanet,
        senderCoords,
        speedPercent: params.speedPercent ?? 100,
      });

      if (!result.success) {
        throw new Error(result.error || 'Fleet dispatch failed');
      }

      const flightTimeSec = result.flightTimeSec ?? 30;
      console.log('[FleetContext] Fleet sent successfully (server-side time), arrival in', flightTimeSec, 's');
      return { travelTime: flightTimeSec, arrivalTime: result.arrivalTime };
    },
    onSuccess: () => {
      console.log('[FleetContext] Fleet send success — forcing resync from server');
      void queryClient.invalidateQueries({ queryKey: ['fleet_missions'] });
      void forceResync();
    },
    onError: (error) => {
      console.log('[FleetContext] Fleet send error — forcing resync from server:', error.message);
      void queryClient.invalidateQueries({ queryKey: ['fleet_missions'] });
      void forceResync();
    },
  });

  const espionageReportsQuery = useQuery({
    queryKey: ['espionage_reports', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('espionage_reports')
        .select('*')
        .eq('player_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as EspionageReport[];
    },
    enabled: !!userId,
    staleTime: 15000,
    refetchInterval: 15000,
  });

  const transportReportsQuery = useQuery({
    queryKey: ['transport_reports', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data: sentData, error: sentError } = await supabase
        .from('fleet_missions')
        .select('*')
        .eq('sender_id', userId)
        .in('mission_type', ['transport', 'recycle'])
        .in('status', ['completed', 'returning'])
        .eq('processed', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (sentError) {
        console.log('[FleetContext] Error loading sent transport reports:', sentError.message);
      }

      const { data: receivedData, error: receivedError } = await supabase
        .from('fleet_missions')
        .select('*')
        .eq('target_player_id', userId)
        .neq('sender_id', userId)
        .eq('mission_type', 'transport')
        .eq('processed', true)
        .in('status', ['completed', 'returning'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (receivedError) {
        console.log('[FleetContext] Error loading received transport reports:', receivedError.message);
      }

      const all = [...(sentData ?? []), ...(receivedData ?? [])];
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      console.log('[FleetContext] Transport reports loaded:', all.length);
      return all as TransportReport[];
    },
    enabled: !!userId,
    staleTime: 30000,
  });

  const combatReportsQuery = useQuery({
    queryKey: ['combat_reports', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('combat_reports')
        .select('*')
        .or(`attacker_id.eq.${userId},defender_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as CombatReport[];
    },
    enabled: !!userId,
    staleTime: 30000,
  });

  const activePlanet = useMemo(() => ({
    id: gamActivePlanet.id,
    coordinates: gamActivePlanet.coordinates,
    planetName: gamActivePlanet.planetName,
  }), [gamActivePlanet.id, gamActivePlanet.coordinates, gamActivePlanet.planetName]);

  const { mutateAsync: sendFleetAsync, isPending: isSending, error: sendFleetError } = sendFleetMutation;

  const sendFleet = useCallback((params: FleetDispatchParams) => {
    return sendFleetAsync(params);
  }, [sendFleetAsync]);

  const sonarLevel = state.research?.espionageTech ?? 0;

  const espionageReports = useMemo(() => (espionageReportsQuery.data ?? []).filter(r => !deletedIds.has(r.id)), [espionageReportsQuery.data, deletedIds]);
  const combatReports = useMemo(() => (combatReportsQuery.data ?? []).filter(r => !deletedIds.has(r.id)), [combatReportsQuery.data, deletedIds]);
  const transportReports = useMemo(() => (transportReportsQuery.data ?? []).filter(r => !deletedIds.has(r.id)), [transportReportsQuery.data, deletedIds]);

  const refreshMissions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['fleet_missions'] });
  }, [queryClient]);

  const refreshReports = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['espionage_reports'] });
    void queryClient.invalidateQueries({ queryKey: ['combat_reports'] });
    void queryClient.invalidateQueries({ queryKey: ['transport_reports'] });
  }, [queryClient]);

  const deleteEspionageReportMutation = trpc.world.deleteEspionageReport.useMutation();
  const deleteAllEspionageReportsMutation = trpc.world.deleteAllEspionageReports.useMutation();
  const deleteCombatReportMutation = trpc.world.deleteCombatReport.useMutation();
  const deleteAllCombatReportsMutation = trpc.world.deleteAllCombatReports.useMutation();
  const deleteTransportReportMutation = trpc.world.deleteTransportReport.useMutation();
  const deleteAllTransportReportsMutation = trpc.world.deleteAllTransportReports.useMutation();

  const deleteEspionageReportRef = useRef(deleteEspionageReportMutation);
  deleteEspionageReportRef.current = deleteEspionageReportMutation;
  const deleteAllEspionageReportsRef = useRef(deleteAllEspionageReportsMutation);
  deleteAllEspionageReportsRef.current = deleteAllEspionageReportsMutation;
  const deleteCombatReportRef = useRef(deleteCombatReportMutation);
  deleteCombatReportRef.current = deleteCombatReportMutation;
  const deleteAllCombatReportsRef = useRef(deleteAllCombatReportsMutation);
  deleteAllCombatReportsRef.current = deleteAllCombatReportsMutation;
  const deleteTransportReportRef = useRef(deleteTransportReportMutation);
  deleteTransportReportRef.current = deleteTransportReportMutation;
  const deleteAllTransportReportsRef = useRef(deleteAllTransportReportsMutation);
  deleteAllTransportReportsRef.current = deleteAllTransportReportsMutation;

  const deleteEspionageReport = useCallback(async (reportId: string) => {
    if (!userId) return;
    console.log('[FleetContext] Deleting espionage report via tRPC:', reportId);
    markAsDeleted(reportId);
    try {
      const result = await deleteEspionageReportRef.current.mutateAsync({ reportId, playerId: userId });
      if (!result.success) console.log('[FleetContext] tRPC delete espionage report failed:', result.error);
      else console.log('[FleetContext] Espionage report deleted from DB:', reportId);
    } catch (e) {
      console.log('[FleetContext] Error deleting espionage report:', e);
    }
  }, [markAsDeleted, userId]);

  const deleteCombatReport = useCallback(async (reportId: string) => {
    if (!userId) return;
    console.log('[FleetContext] Deleting combat report via tRPC:', reportId);
    markAsDeleted(reportId);
    try {
      const result = await deleteCombatReportRef.current.mutateAsync({ reportId, playerId: userId });
      if (!result.success) console.log('[FleetContext] tRPC delete combat report failed:', result.error);
      else console.log('[FleetContext] Combat report deleted from DB:', reportId);
    } catch (e) {
      console.log('[FleetContext] Error deleting combat report:', e);
    }
  }, [markAsDeleted, userId]);

  const deleteTransportReport = useCallback(async (missionId: string) => {
    if (!userId) return;
    console.log('[FleetContext] Deleting transport report via tRPC:', missionId);
    markAsDeleted(missionId);
    try {
      const result = await deleteTransportReportRef.current.mutateAsync({ missionId, playerId: userId });
      if (!result.success) console.log('[FleetContext] tRPC delete transport report failed:', result.error);
      else console.log('[FleetContext] Transport report deleted from DB:', missionId);
    } catch (e) {
      console.log('[FleetContext] Error deleting transport report:', e);
    }
  }, [markAsDeleted, userId]);

  const deleteAllEspionageReports = useCallback(async () => {
    if (!userId) return;
    console.log('[FleetContext] Deleting all espionage reports via tRPC');
    const ids = (espionageReportsQuery.data ?? []).map(r => r.id);
    markAsDeleted(...ids);
    try {
      await deleteAllEspionageReportsRef.current.mutateAsync({ playerId: userId });
      console.log('[FleetContext] All espionage reports deleted from DB');
    } catch (e) {
      console.log('[FleetContext] Error deleting all espionage reports:', e);
    }
  }, [userId, markAsDeleted, espionageReportsQuery.data]);

  const deleteAllCombatReports = useCallback(async () => {
    if (!userId) return;
    console.log('[FleetContext] Deleting all combat reports via tRPC');
    const ids = (combatReportsQuery.data ?? []).map(r => r.id);
    markAsDeleted(...ids);
    try {
      await deleteAllCombatReportsRef.current.mutateAsync({ playerId: userId });
      console.log('[FleetContext] All combat reports deleted from DB');
    } catch (e) {
      console.log('[FleetContext] Error deleting all combat reports:', e);
    }
  }, [userId, markAsDeleted, combatReportsQuery.data]);

  const deleteAllTransportReports = useCallback(async () => {
    if (!userId) return;
    console.log('[FleetContext] Deleting all transport reports via tRPC');
    const ids = (transportReportsQuery.data ?? []).map(r => r.id);
    markAsDeleted(...ids);
    try {
      await deleteAllTransportReportsRef.current.mutateAsync({ playerId: userId });
      console.log('[FleetContext] All transport reports deleted from DB');
    } catch (e) {
      console.log('[FleetContext] Error deleting all transport reports:', e);
    }
  }, [userId, markAsDeleted, transportReportsQuery.data]);

  const recallFleetMutation = useMutation({
    mutationFn: async (missionId: string) => {
      if (!userId) throw new Error('Not authenticated');
      console.log('[FleetContext] Recalling fleet:', missionId);
      const result = await trpcClient.actions.recallFleet.mutate({ userId, missionId });
      if (!result.success) {
        throw new Error(result.error || 'Rappel échoué');
      }
      void queryClient.invalidateQueries({ queryKey: ['fleet_missions'] });
      console.log('[FleetContext] Fleet recalled, return in', result.returnDurationSec, 's');
      return result;
    },
  });

  const recallFleet = useCallback((missionId: string) => {
    return recallFleetMutation.mutateAsync(missionId);
  }, [recallFleetMutation]);

  const isRecalling = recallFleetMutation.isPending;

  const sendError = sendFleetError?.message ?? null;

  return useMemo(() => ({
    activeMissions,
    espionageReports,
    combatReports,
    transportReports,
    sendFleet,
    recallFleet,
    isSending,
    isRecalling,
    sendError,
    refreshMissions,
    refreshReports,
    deleteEspionageReport,
    deleteCombatReport,
    deleteTransportReport,
    deleteAllEspionageReports,
    deleteAllCombatReports,
    deleteAllTransportReports,
    sonarLevel,
    userId,
  }), [
    activeMissions,
    espionageReports,
    combatReports,
    transportReports,
    sendFleet,
    recallFleet,
    isSending,
    isRecalling,
    sendError,
    refreshMissions,
    refreshReports,
    deleteEspionageReport,
    deleteCombatReport,
    deleteTransportReport,
    deleteAllEspionageReports,
    deleteAllCombatReports,
    deleteAllTransportReports,
    sonarLevel,
    userId,
  ]);
});
