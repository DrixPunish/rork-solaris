import createContextHook from '@nkzw/create-context-hook';
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useGame } from '@/contexts/GameContext';
import { Alliance, AllianceMember, AllianceMessage, AllianceInvitation, AllianceRole, AllianceApplication, AllianceSummary } from '@/types/alliance';

type CreateAllianceParams = { name: string; tag: string; description: string };
type UpdateRoleParams = { memberId: string; newRole: AllianceRole };
type ProcessApplicationParams = { applicationId: string; status: 'accepted' | 'rejected' };

export const [AllianceProvider, useAlliance] = createContextHook(() => {
  useAuth();
  const { state, userId } = useGame();
  const queryClient = useQueryClient();

  const membershipQuery = useQuery({
    queryKey: ['alliance_membership', userId],
    queryFn: async () => {
      if (!userId) return null;
      console.log('[AllianceContext] Loading membership');
      const { data, error } = await supabase
        .from('alliance_members')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (error) {
        if (error.code === 'PGRST116') return null;
        console.log('[AllianceContext] Membership error:', error.message);
        return null;
      }
      return data as AllianceMember;
    },
    enabled: !!userId,
    staleTime: 30000,
  });

  const myMembership = membershipQuery.data ?? null;
  const allianceId = myMembership?.alliance_id ?? null;

  const allianceQuery = useQuery({
    queryKey: ['alliance_details', allianceId],
    queryFn: async () => {
      if (!allianceId) return null;
      console.log('[AllianceContext] Loading alliance details');
      const { data, error } = await supabase
        .from('alliances')
        .select('*')
        .eq('id', allianceId)
        .single();
      if (error) {
        console.log('[AllianceContext] Alliance error:', error.message);
        return null;
      }
      return data as Alliance;
    },
    enabled: !!allianceId,
    staleTime: 30000,
  });

  const membersQuery = useQuery({
    queryKey: ['alliance_members', allianceId],
    queryFn: async () => {
      if (!allianceId) return [];
      const { data, error } = await supabase
        .from('alliance_members')
        .select('*')
        .eq('alliance_id', allianceId)
        .order('role', { ascending: true })
        .order('joined_at', { ascending: true });
      if (error) {
        console.log('[AllianceContext] Members error:', error.message);
        return [];
      }
      return (data ?? []) as AllianceMember[];
    },
    enabled: !!allianceId,
    staleTime: 15000,
  });

  const messagesQuery = useQuery({
    queryKey: ['alliance_messages', allianceId],
    queryFn: async () => {
      if (!allianceId) return [];
      const { data, error } = await supabase
        .from('alliance_messages')
        .select('*')
        .eq('alliance_id', allianceId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        console.log('[AllianceContext] Messages error:', error.message);
        return [];
      }
      return (data ?? []).reverse() as AllianceMessage[];
    },
    enabled: !!allianceId,
    staleTime: 5000,
  });

  const invitationsQuery = useQuery({
    queryKey: ['alliance_invitations', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('alliance_invitations')
        .select('*')
        .eq('target_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[AllianceContext] Invitations error:', error.message);
        return [];
      }
      return (data ?? []) as AllianceInvitation[];
    },
    enabled: !!userId && !allianceId,
    staleTime: 15000,
  });

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['alliance_membership'] });
    void queryClient.invalidateQueries({ queryKey: ['alliance_details'] });
    void queryClient.invalidateQueries({ queryKey: ['alliance_members'] });
    void queryClient.invalidateQueries({ queryKey: ['alliance_messages'] });
    void queryClient.invalidateQueries({ queryKey: ['alliance_invitations'] });
  }, [queryClient]);

  const createAllianceMutation = useMutation({
    mutationFn: async ({ name, tag, description }: CreateAllianceParams) => {
      if (!userId) throw new Error('Non authentifié');
      console.log('[AllianceContext] Creating alliance', name, tag);

      const { data: alliance, error: allianceError } = await supabase
        .from('alliances')
        .insert({ name, tag: tag.toUpperCase(), description, leader_id: userId })
        .select()
        .single();

      if (allianceError) {
        console.log('[AllianceContext] Create alliance error:', allianceError.message);
        if (allianceError.message.includes('unique') || allianceError.message.includes('duplicate')) {
          throw new Error('Ce nom ou tag d\'alliance est déjà pris.');
        }
        throw new Error(allianceError.message);
      }

      const { error: memberError } = await supabase
        .from('alliance_members')
        .insert({
          alliance_id: alliance.id,
          user_id: userId,
          username: state.username ?? '',
          role: 'founder',
        });

      if (memberError) {
        console.log('[AllianceContext] Create member error:', memberError.message);
        await supabase.from('alliances').delete().eq('id', alliance.id);
        throw new Error(memberError.message);
      }

      invalidateAll();
      return alliance as Alliance;
    },
  });

  const leaveAllianceMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !allianceId) throw new Error('Pas dans une alliance');
      console.log('[AllianceContext] Leaving alliance');

      if (myMembership?.role === 'founder') {
        const members = membersQuery.data ?? [];
        const otherMembers = members.filter(m => m.user_id !== userId);
        if (otherMembers.length > 0) {
          throw new Error('Transférez le leadership ou dissolvez l\'alliance avant de partir.');
        }
        await supabase.from('alliances').delete().eq('id', allianceId);
      } else {
        await supabase.from('alliance_members').delete()
          .eq('alliance_id', allianceId)
          .eq('user_id', userId);
      }

      invalidateAll();
    },
  });

  const dissolveAllianceMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !allianceId || myMembership?.role !== 'founder') {
        throw new Error('Seul le fondateur peut dissoudre l\'alliance');
      }
      console.log('[AllianceContext] Dissolving alliance');
      const { error } = await supabase.from('alliances').delete().eq('id', allianceId);
      if (error) throw new Error(error.message);
      invalidateAll();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!userId || !allianceId) throw new Error('Pas dans une alliance');
      const { error } = await supabase.from('alliance_messages').insert({
        alliance_id: allianceId,
        sender_id: userId,
        sender_username: state.username ?? 'Inconnu',
        content,
      });
      if (error) throw new Error(error.message);
      void queryClient.invalidateQueries({ queryKey: ['alliance_messages'] });
    },
  });

  const invitePlayerMutation = useMutation({
    mutationFn: async (targetUsername: string) => {
      if (!userId || !allianceId) throw new Error('Pas dans une alliance');
      const alliance = allianceQuery.data;
      if (!alliance) throw new Error('Alliance introuvable');

      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('user_id, username')
        .eq('username', targetUsername)
        .single();

      if (playerError || !player) throw new Error('Joueur introuvable');
      if (player.user_id === userId) throw new Error('Vous ne pouvez pas vous inviter vous-même');

      const { data: existingMember } = await supabase
        .from('alliance_members')
        .select('id')
        .eq('user_id', player.user_id)
        .single();

      if (existingMember) throw new Error('Ce joueur est déjà dans une alliance');

      const { data: existingInvite } = await supabase
        .from('alliance_invitations')
        .select('id')
        .eq('alliance_id', allianceId)
        .eq('target_id', player.user_id)
        .eq('status', 'pending')
        .single();

      if (existingInvite) throw new Error('Une invitation est déjà en attente pour ce joueur');

      const { error } = await supabase.from('alliance_invitations').insert({
        alliance_id: allianceId,
        alliance_name: alliance.name,
        alliance_tag: alliance.tag,
        sender_id: userId,
        sender_username: state.username ?? '',
        target_id: player.user_id,
      });

      if (error) throw new Error(error.message);
      console.log('[AllianceContext] Invitation sent to', targetUsername);
    },
  });

  const acceptInvitationMutation = useMutation({
    mutationFn: async (invitation: AllianceInvitation) => {
      if (!userId) throw new Error('Non authentifié');
      console.log('[AllianceContext] Accepting invitation', invitation.id);

      const { error: memberError } = await supabase
        .from('alliance_members')
        .insert({
          alliance_id: invitation.alliance_id,
          user_id: userId,
          username: state.username ?? '',
          role: 'member',
        });

      if (memberError) throw new Error(memberError.message);

      void supabase.from('alliance_invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      invalidateAll();
    },
  });

  const rejectInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      void supabase.from('alliance_invitations')
        .update({ status: 'rejected' })
        .eq('id', invitationId);
      void queryClient.invalidateQueries({ queryKey: ['alliance_invitations'] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, newRole }: UpdateRoleParams) => {
      if (myMembership?.role !== 'founder') throw new Error('Seul le fondateur peut changer les rôles');
      console.log('[AllianceContext] Updating role', memberId, newRole);
      const { error } = await supabase
        .from('alliance_members')
        .update({ role: newRole })
        .eq('id', memberId);
      if (error) throw new Error(error.message);
      void queryClient.invalidateQueries({ queryKey: ['alliance_members'] });
    },
  });

  const transferLeadershipMutation = useMutation({
    mutationFn: async (targetMemberId: string) => {
      if (!myMembership || myMembership.role !== 'founder') throw new Error('Seul le fondateur peut transférer');
      console.log('[AllianceContext] Transferring leadership to', targetMemberId);

      const targetMember = (membersQuery.data ?? []).find(m => m.id === targetMemberId);
      if (!targetMember) throw new Error('Membre introuvable');

      await supabase.from('alliance_members')
        .update({ role: 'founder' })
        .eq('id', targetMemberId);

      await supabase.from('alliance_members')
        .update({ role: 'officer' })
        .eq('id', myMembership.id);

      if (allianceId) {
        void supabase.from('alliances')
          .update({ leader_id: targetMember.user_id })
          .eq('id', allianceId);
      }

      invalidateAll();
    },
  });

  const kickMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const targetMember = (membersQuery.data ?? []).find(m => m.id === memberId);
      if (!targetMember) throw new Error('Membre introuvable');
      if (targetMember.role === 'founder') throw new Error('Impossible d\'exclure le fondateur');
      if (myMembership?.role === 'officer' && targetMember.role === 'officer') {
        throw new Error('Un officier ne peut pas exclure un autre officier');
      }
      console.log('[AllianceContext] Kicking member', memberId);
      const { error } = await supabase
        .from('alliance_members')
        .delete()
        .eq('id', memberId);
      if (error) throw new Error(error.message);
      void queryClient.invalidateQueries({ queryKey: ['alliance_members'] });
    },
  });

  const myAlliance = allianceQuery.data ?? null;
  const myRole = myMembership?.role ?? null;
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const pendingInvitations = useMemo(() => invitationsQuery.data ?? [], [invitationsQuery.data]);
  const isLoading = membershipQuery.isLoading;
  const canManage = myRole === 'founder' || myRole === 'officer' || myRole === 'diplomat';

  const allAlliancesQuery = useQuery({
    queryKey: ['all_alliances'],
    queryFn: async () => {
      console.log('[AllianceContext] Loading all alliances');
      const { data, error } = await supabase
        .from('alliances')
        .select('*, alliance_members(count)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        console.log('[AllianceContext] All alliances error:', error.message);
        return [];
      }
      return (data ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        member_count: Array.isArray(a.alliance_members) && a.alliance_members.length > 0
          ? (a.alliance_members[0] as { count: number }).count
          : 0,
      })) as AllianceSummary[];
    },
    enabled: !!userId && !allianceId,
    staleTime: 30000,
  });

  const applicationsQuery = useQuery({
    queryKey: ['alliance_applications', allianceId],
    queryFn: async () => {
      if (!allianceId) return [];
      const { data, error } = await supabase
        .from('alliance_applications')
        .select('*')
        .eq('alliance_id', allianceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[AllianceContext] Applications error:', error.message);
        return [];
      }
      return (data ?? []) as AllianceApplication[];
    },
    enabled: !!allianceId && canManage,
    staleTime: 15000,
  });

  const myApplicationsQuery = useQuery({
    queryKey: ['my_alliance_applications', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('alliance_applications')
        .select('*')
        .eq('applicant_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) {
        console.log('[AllianceContext] My applications error:', error.message);
        return [];
      }
      return (data ?? []) as AllianceApplication[];
    },
    enabled: !!userId && !allianceId,
    staleTime: 15000,
  });

  const applyToAllianceMutation = useMutation({
    mutationFn: async ({ allianceId: targetAllianceId, message }: { allianceId: string; message?: string }) => {
      if (!userId) throw new Error('Non authentifié');
      console.log('[AllianceContext] Applying to alliance', targetAllianceId);

      const { data: existing } = await supabase
        .from('alliance_applications')
        .select('id')
        .eq('alliance_id', targetAllianceId)
        .eq('applicant_id', userId)
        .eq('status', 'pending')
        .single();

      if (existing) throw new Error('Vous avez déjà une candidature en attente pour cette alliance.');

      const { error } = await supabase.from('alliance_applications').insert({
        alliance_id: targetAllianceId,
        applicant_id: userId,
        applicant_username: state.username ?? '',
        message: message?.trim() || null,
      });

      if (error) throw new Error(error.message);
      console.log('[AllianceContext] Application sent');
      void queryClient.invalidateQueries({ queryKey: ['my_alliance_applications'] });
    },
  });

  const processApplicationMutation = useMutation({
    mutationFn: async ({ applicationId, status }: ProcessApplicationParams) => {
      if (!userId || !canManage) throw new Error('Permissions insuffisantes');
      console.log('[AllianceContext] Processing application', applicationId, status);

      if (status === 'accepted') {
        const { data: app, error: appError } = await supabase
          .from('alliance_applications')
          .select('*')
          .eq('id', applicationId)
          .single();

        if (appError || !app) throw new Error('Candidature introuvable');
        const application = app as AllianceApplication;

        const { data: existingMember } = await supabase
          .from('alliance_members')
          .select('id')
          .eq('user_id', application.applicant_id)
          .single();

        if (existingMember) throw new Error('Ce joueur est déjà dans une alliance');

        const { error: memberError } = await supabase
          .from('alliance_members')
          .insert({
            alliance_id: application.alliance_id,
            user_id: application.applicant_id,
            username: application.applicant_username,
            role: 'member',
          });

        if (memberError) throw new Error(memberError.message);
      }

      const { error } = await supabase
        .from('alliance_applications')
        .update({ status, processed_at: new Date().toISOString(), processed_by: userId })
        .eq('id', applicationId);

      if (error) throw new Error(error.message);

      void queryClient.invalidateQueries({ queryKey: ['alliance_applications'] });
      void queryClient.invalidateQueries({ queryKey: ['alliance_members'] });
    },
  });

  const searchAlliancesMutation = useMutation({
    mutationFn: async (query: string) => {
      console.log('[AllianceContext] Searching alliances:', query);
      const { data, error } = await supabase
        .from('alliances')
        .select('*, alliance_members(count)')
        .or(`name.ilike.%${query}%,tag.ilike.%${query}%`)
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        member_count: Array.isArray(a.alliance_members) && a.alliance_members.length > 0
          ? (a.alliance_members[0] as { count: number }).count
          : 0,
      })) as AllianceSummary[];
    },
  });

  const allAlliances = useMemo(() => allAlliancesQuery.data ?? [], [allAlliancesQuery.data]);
  const pendingApplications = useMemo(() => applicationsQuery.data ?? [], [applicationsQuery.data]);
  const myApplications = useMemo(() => myApplicationsQuery.data ?? [], [myApplicationsQuery.data]);

  const refetchMessages = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['alliance_messages'] });
  }, [queryClient]);

  return useMemo(() => ({
    myAlliance,
    myRole,
    members,
    messages,
    pendingInvitations,
    isLoading,
    canManage,
    createAlliance: createAllianceMutation.mutateAsync,
    isCreating: createAllianceMutation.isPending,
    leaveAlliance: leaveAllianceMutation.mutateAsync,
    isLeaving: leaveAllianceMutation.isPending,
    dissolveAlliance: dissolveAllianceMutation.mutateAsync,
    sendMessage: sendMessageMutation.mutateAsync,
    isSendingMessage: sendMessageMutation.isPending,
    invitePlayer: invitePlayerMutation.mutateAsync,
    isInviting: invitePlayerMutation.isPending,
    acceptInvitation: acceptInvitationMutation.mutateAsync,
    rejectInvitation: rejectInvitationMutation.mutateAsync,
    updateMemberRole: updateRoleMutation.mutateAsync,
    transferLeadership: transferLeadershipMutation.mutateAsync,
    kickMember: kickMemberMutation.mutateAsync,
    allAlliances,
    isLoadingAllAlliances: allAlliancesQuery.isLoading,
    pendingApplications,
    myApplications,
    applyToAlliance: applyToAllianceMutation.mutateAsync,
    isApplying: applyToAllianceMutation.isPending,
    processApplication: processApplicationMutation.mutateAsync,
    isProcessingApplication: processApplicationMutation.isPending,
    searchAlliances: searchAlliancesMutation.mutateAsync,
    isSearchingAlliances: searchAlliancesMutation.isPending,
    searchResults: searchAlliancesMutation.data ?? [],
    refreshAll: invalidateAll,
    refetchMessages,
  }), [
    myAlliance, myRole, members, messages, pendingInvitations, isLoading, canManage,
    createAllianceMutation, leaveAllianceMutation, dissolveAllianceMutation,
    sendMessageMutation, invitePlayerMutation, acceptInvitationMutation,
    rejectInvitationMutation, updateRoleMutation, transferLeadershipMutation,
    kickMemberMutation, invalidateAll, refetchMessages,
    allAlliances, allAlliancesQuery.isLoading, pendingApplications, myApplications,
    applyToAllianceMutation, processApplicationMutation, searchAlliancesMutation,
  ]);
});
