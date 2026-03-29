import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGame } from '@/contexts/GameContext';
import { TUTORIAL_STEPS, TutorialStep, TutorialReward } from '@/constants/tutorial';
import { supabase } from '@/utils/supabase';

interface TutorialState {
  completedSteps: string[];
  claimedRewards: string[];
  dismissed: boolean;
  minimized: boolean;
}

const DEFAULT_TUTORIAL_STATE: TutorialState = {
  completedSteps: [],
  claimedRewards: [],
  dismissed: false,
  minimized: false,
};

export const [TutorialProvider, useTutorial] = createContextHook(() => {
  const [tutorialState, setTutorialState] = useState<TutorialState>(DEFAULT_TUTORIAL_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const { state, userId } = useGame();
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<TutorialState | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const load = async () => {
      console.log('[Tutorial] Loading state from Supabase for user:', userId);
      try {
        const { data, error } = await supabase
          .from('player_tutorial')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (cancelled) return;

        if (error && error.code === 'PGRST116') {
          console.log('[Tutorial] No row found, creating default for user:', userId);
          const { error: insertError } = await supabase
            .from('player_tutorial')
            .insert({ user_id: userId });
          if (insertError) {
            console.log('[Tutorial] Error creating default row:', insertError.message);
          }
          setIsLoaded(true);
          return;
        }

        if (error) {
          console.log('[Tutorial] Error loading from Supabase:', error.message);
          setIsLoaded(true);
          return;
        }

        if (data) {
          const serverCompleted: string[] = Array.isArray(data.completed_steps) ? data.completed_steps : [];
          const serverClaimed: string[] = Array.isArray(data.claimed_rewards) ? data.claimed_rewards : [];

          setTutorialState(prev => {
            const mergedCompleted = Array.from(new Set([...prev.completedSteps, ...serverCompleted]));
            const mergedClaimed = Array.from(new Set([...prev.claimedRewards, ...serverClaimed]));
            console.log('[Tutorial] Loaded from Supabase (merge), completed:', mergedCompleted.length, 'claimed:', mergedClaimed.length);
            return {
              completedSteps: mergedCompleted,
              claimedRewards: mergedClaimed,
              dismissed: data.dismissed ?? false,
              minimized: data.minimized ?? false,
            };
          });
        }
        setIsLoaded(true);
      } catch (err) {
        console.log('[Tutorial] Unexpected error loading:', err);
        if (!cancelled) setIsLoaded(true);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [userId]);

  const persistToSupabase = useCallback(async (newState: TutorialState) => {
    if (!userId) return;

    if (savingRef.current) {
      pendingSaveRef.current = newState;
      return;
    }

    savingRef.current = true;
    try {
      console.log('[Tutorial] Persisting to Supabase (merge mode)...');

      const { data: serverRow } = await supabase
        .from('player_tutorial')
        .select('claimed_rewards, completed_steps')
        .eq('user_id', userId)
        .single();

      const serverClaimed: string[] = Array.isArray(serverRow?.claimed_rewards) ? serverRow.claimed_rewards : [];
      const serverCompleted: string[] = Array.isArray(serverRow?.completed_steps) ? serverRow.completed_steps : [];

      const mergedClaimed = Array.from(new Set([...serverClaimed, ...newState.claimedRewards]));
      const mergedCompleted = Array.from(new Set([...serverCompleted, ...newState.completedSteps]));

      console.log('[Tutorial] Merge: server claimed', serverClaimed.length, '+ local', newState.claimedRewards.length, '= merged', mergedClaimed.length);

      const { error } = await supabase
        .from('player_tutorial')
        .upsert({
          user_id: userId,
          completed_steps: mergedCompleted,
          claimed_rewards: mergedClaimed,
          dismissed: newState.dismissed,
          minimized: newState.minimized,
        });
      if (error) {
        console.log('[Tutorial] Error persisting to Supabase:', error.message);
      } else {
        if (mergedClaimed.length > newState.claimedRewards.length || mergedCompleted.length > newState.completedSteps.length) {
          setTutorialState(prev => ({
            ...prev,
            claimedRewards: Array.from(new Set([...prev.claimedRewards, ...mergedClaimed])),
            completedSteps: Array.from(new Set([...prev.completedSteps, ...mergedCompleted])),
          }));
          console.log('[Tutorial] Local state updated with server-merged data');
        }
      }
    } catch (err) {
      console.log('[Tutorial] Unexpected error persisting:', err);
    } finally {
      savingRef.current = false;
      if (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        void persistToSupabase(pending);
      }
    }
  }, [userId]);

  const sentMissionsQuery = useQuery({
    queryKey: ['tutorial_sent_missions', userId],
    queryFn: async () => {
      if (!userId) return { espionage: false, attack: false };
      console.log('[Tutorial] Checking sent mission types for user');
      const { data, error } = await supabase
        .from('fleet_missions')
        .select('mission_type')
        .eq('sender_id', userId)
        .in('mission_type', ['espionage', 'attack'])
        .limit(50);
      if (error) {
        console.log('[Tutorial] Error querying missions:', error.message);
        return { espionage: false, attack: false };
      }
      const types = new Set((data ?? []).map((m: { mission_type: string }) => m.mission_type));
      return {
        espionage: types.has('espionage'),
        attack: types.has('attack'),
      };
    },
    enabled: !!userId,
    refetchInterval: 15000,
  });

  const sentMissions = useMemo(() => sentMissionsQuery.data ?? { espionage: false, attack: false }, [sentMissionsQuery.data]);

  const checkStepCompletion = useCallback((step: TutorialStep): boolean => {
    switch (step.checkType) {
      case 'building_level':
        return (state.buildings[step.checkTarget] ?? 0) >= step.checkValue;
      case 'research_level':
        return (state.research[step.checkTarget] ?? 0) >= step.checkValue;
      case 'ship_count':
        return (state.ships[step.checkTarget] ?? 0) >= step.checkValue;
      case 'defense_count':
        return (state.defenses[step.checkTarget] ?? 0) >= step.checkValue;
      case 'has_colony':
        return (state.colonies ?? []).length >= step.checkValue;
      case 'has_sent_mission':
        return sentMissions[step.checkTarget as keyof typeof sentMissions] === true;
      default:
        return false;
    }
  }, [state.buildings, state.research, state.ships, state.defenses, state.colonies, sentMissions]);

  const completedStepIds = useMemo(() => {
    const ids = new Set<string>(tutorialState.completedSteps);
    for (const step of TUTORIAL_STEPS) {
      if (!ids.has(step.id) && checkStepCompletion(step)) {
        ids.add(step.id);
      }
    }
    return ids;
  }, [tutorialState.completedSteps, checkStepCompletion]);

  useEffect(() => {
    if (!isLoaded || !state.username) return;
    const newCompleted = Array.from(completedStepIds);
    if (newCompleted.length !== tutorialState.completedSteps.length) {
      const updated = { ...tutorialState, completedSteps: newCompleted };
      setTutorialState(updated);
      void persistToSupabase(updated);
      console.log('[Tutorial] Auto-detected completions, total:', newCompleted.length);
    }
  }, [completedStepIds, isLoaded, tutorialState, persistToSupabase, state.username]);

  const currentStepIndex = useMemo(() => {
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      const step = TUTORIAL_STEPS[i];
      if (!completedStepIds.has(step.id) || !tutorialState.claimedRewards.includes(step.id)) {
        return i;
      }
    }
    return TUTORIAL_STEPS.length;
  }, [completedStepIds, tutorialState.claimedRewards]);

  const currentStep = useMemo(() => {
    if (currentStepIndex >= TUTORIAL_STEPS.length) return null;
    return TUTORIAL_STEPS[currentStepIndex];
  }, [currentStepIndex]);

  const isCurrentStepCompleted = useMemo(() => {
    if (!currentStep) return false;
    return completedStepIds.has(currentStep.id);
  }, [currentStep, completedStepIds]);

  const isCurrentStepClaimed = useMemo(() => {
    if (!currentStep) return false;
    return tutorialState.claimedRewards.includes(currentStep.id);
  }, [currentStep, tutorialState.claimedRewards]);

  const claimReward = useCallback((stepId: string): TutorialReward | null => {
    const step = TUTORIAL_STEPS.find(s => s.id === stepId);
    if (!step) return null;
    if (!completedStepIds.has(stepId)) return null;
    if (tutorialState.claimedRewards.includes(stepId)) {
      console.log('[Tutorial] Step already claimed locally, skipping:', stepId);
      return null;
    }

    console.log('[Tutorial] Claiming reward for step:', stepId);
    const newClaimed = [...tutorialState.claimedRewards, stepId];
    const updated = {
      ...tutorialState,
      claimedRewards: newClaimed,
    };
    setTutorialState(updated);
    void persistToSupabase(updated);
    return step.reward;
  }, [completedStepIds, tutorialState, persistToSupabase]);

  const dismissTutorial = useCallback(() => {
    console.log('[Tutorial] Tutorial dismissed');
    const updated = { ...tutorialState, dismissed: true };
    setTutorialState(updated);
    void persistToSupabase(updated);
  }, [tutorialState, persistToSupabase]);

  const reopenTutorial = useCallback(() => {
    console.log('[Tutorial] Tutorial reopened');
    const updated = { ...tutorialState, dismissed: false, minimized: false };
    setTutorialState(updated);
    void persistToSupabase(updated);
  }, [tutorialState, persistToSupabase]);

  const toggleMinimized = useCallback(() => {
    const updated = { ...tutorialState, minimized: !tutorialState.minimized };
    setTutorialState(updated);
    void persistToSupabase(updated);
  }, [tutorialState, persistToSupabase]);

  const totalSteps = TUTORIAL_STEPS.length;
  const completedCount = tutorialState.claimedRewards.length;
  const progress = totalSteps > 0 ? completedCount / totalSteps : 0;
  const isFinished = completedCount >= totalSteps;

  return useMemo(() => ({
    currentStep,
    currentStepIndex,
    isCurrentStepCompleted,
    isCurrentStepClaimed,
    claimReward,
    dismissTutorial,
    reopenTutorial,
    toggleMinimized,
    isDismissed: tutorialState.dismissed,
    isMinimized: tutorialState.minimized,
    isLoaded,
    totalSteps,
    completedCount,
    progress,
    isFinished,
    completedStepIds,
    claimedRewards: tutorialState.claimedRewards,
    allSteps: TUTORIAL_STEPS,
  }), [
    currentStep, currentStepIndex, isCurrentStepCompleted, isCurrentStepClaimed,
    claimReward, dismissTutorial, reopenTutorial, toggleMinimized,
    tutorialState.dismissed, tutorialState.minimized, isLoaded,
    totalSteps, completedCount, progress, isFinished, completedStepIds,
    tutorialState.claimedRewards,
  ]);
});
