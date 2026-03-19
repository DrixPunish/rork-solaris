import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  FlatList, KeyboardAvoidingView, Platform, Modal, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import {
  Shield, Crown, Star, Users, Send, UserPlus, LogOut, Trash2, X,
  MessageCircle, Settings, Plus, Check, User, Globe,
  Search, FileText, ChevronRight, Inbox, Eye,
} from 'lucide-react-native';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import * as Haptics from 'expo-haptics';
import { useAlliance } from '@/contexts/AllianceContext';
import { useGame } from '@/contexts/GameContext';
import { AllianceMember, AllianceMessage, AllianceInvitation, AllianceSummary, AllianceApplication } from '@/types/alliance';
import { showGameAlert } from '@/components/GameAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';

type SubTab = 'members' | 'chat' | 'applications' | 'settings';
type NoAllianceTab = 'discover' | 'search' | 'invitations' | 'my_apps';

function getRoleBadge(role: string) {
  switch (role) {
    case 'founder':
      return { icon: Crown, color: '#FFD700', label: 'Fondateur' };
    case 'officer':
      return { icon: Star, color: Colors.xenogas, label: 'Officier' };
    case 'diplomat':
      return { icon: Globe, color: '#4FC3F7', label: 'Diplomate' };
    default:
      return { icon: Users, color: Colors.textMuted, label: 'Membre' };
  }
}

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return mins <= 0 ? "à l'instant" : `il y a ${mins}m`;
  }
  if (diffH < 24) return `il y a ${Math.floor(diffH)}h`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AllianceScreen() {
  const alliance = useAlliance();
  const insets = useSafeAreaInsets();

  if (alliance.isLoading) {
    return (
      <View style={styles.centered}>
        <View style={[styles.notchSpacer, { height: insets.top }]} />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  if (!alliance.myAlliance) {
    return <NoAllianceView />;
  }

  return <AllianceView />;
}

function NoAllianceView() {
  const alliance = useAlliance();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<NoAllianceTab>('discover');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    const tag = createTag.trim();
    if (name.length < 3 || tag.length < 2) {
      showGameAlert('Erreur', 'Le nom doit faire au moins 3 caractères et le tag 2.');
      return;
    }
    try {
      await alliance.createAlliance({ name, tag, description: createDesc.trim() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowCreateModal(false);
      setCreateName('');
      setCreateTag('');
      setCreateDesc('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      showGameAlert('Erreur', msg);
    }
  }, [createName, createTag, createDesc, alliance]);

  const invCount = alliance.pendingInvitations.length;
  const appCount = alliance.myApplications.filter(a => a.status === 'pending').length;

  return (
    <View style={styles.container}>
      <View style={[styles.notchSpacer, { height: insets.top }]} />

      <View style={styles.heroCompact}>
        <View style={styles.heroIconSmall}>
          <Shield size={28} color={Colors.xenogas} />
        </View>
        <View style={styles.heroTextWrap}>
          <Text style={styles.heroTitleSmall}>Alliance</Text>
          <Text style={styles.heroSubSmall}>Trouvez ou créez votre alliance</Text>
        </View>
        <TouchableOpacity
          style={styles.createBtnCompact}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.7}
        >
          <Plus size={16} color="#0A0A14" />
          <Text style={styles.createBtnCompactText}>Créer</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.noAllianceTabRow}>
        {([
          { id: 'discover' as const, label: 'Découverte', Icon: Eye, badge: 0 },
          { id: 'search' as const, label: 'Recherche', Icon: Search, badge: 0 },
          { id: 'invitations' as const, label: 'Invitations', Icon: Inbox, badge: invCount },
          { id: 'my_apps' as const, label: 'Candidatures', Icon: FileText, badge: appCount },
        ]).map(({ id, label, Icon, badge }) => {
          const isActive = activeTab === id;
          return (
            <TouchableOpacity
              key={id}
              style={[styles.noAllianceTab, isActive && styles.noAllianceTabActive]}
              onPress={() => setActiveTab(id)}
              activeOpacity={0.7}
            >
              <Icon size={13} color={isActive ? Colors.xenogas : Colors.textMuted} />
              <Text style={[styles.noAllianceTabText, isActive && styles.noAllianceTabTextActive]}>{label}</Text>
              {badge > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'discover' && <DiscoverTab />}
      {activeTab === 'search' && <SearchTab />}
      {activeTab === 'invitations' && <InvitationsTab />}
      {activeTab === 'my_apps' && <MyApplicationsTab />}

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowCreateModal(false)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Créer une Alliance</Text>
                <Pressable onPress={() => setShowCreateModal(false)} hitSlop={8}>
                  <X size={20} color={Colors.textMuted} />
                </Pressable>
              </View>

              <Text style={styles.inputLabel}>Nom de l{"'"}alliance</Text>
              <TextInput
                style={styles.modalInput}
                value={createName}
                onChangeText={setCreateName}
                maxLength={30}
                placeholder="ex: Les Conquérants"
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
              />
              <Text style={styles.charCount}>{createName.length}/30</Text>

              <Text style={styles.inputLabel}>Tag (2-5 caractères)</Text>
              <TextInput
                style={styles.modalInput}
                value={createTag}
                onChangeText={(t) => setCreateTag(t.toUpperCase())}
                maxLength={5}
                autoCapitalize="characters"
                placeholder="ex: CONQ"
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
              />

              <Text style={styles.inputLabel}>Description (optionnel)</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={createDesc}
                onChangeText={setCreateDesc}
                maxLength={200}
                multiline
                numberOfLines={3}
                placeholder="Décrivez votre alliance..."
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
              />

              <TouchableOpacity
                style={[styles.confirmBtn, (alliance.isCreating || createName.trim().length < 3 || createTag.trim().length < 2) && styles.confirmBtnDisabled]}
                onPress={handleCreate}
                disabled={alliance.isCreating || createName.trim().length < 3 || createTag.trim().length < 2}
                activeOpacity={0.7}
              >
                {alliance.isCreating ? (
                  <ActivityIndicator size="small" color="#0A0A14" />
                ) : (
                  <>
                    <Shield size={16} color="#0A0A14" />
                    <Text style={styles.confirmBtnText}>Créer l{"'"}Alliance</Text>
                  </>
                )}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function AllianceCard({ alliance: a, onApply }: { alliance: AllianceSummary; onApply: (a: AllianceSummary) => void }) {
  return (
    <View style={styles.allianceListCard}>
      <View style={styles.allianceListCardTop}>
        <View style={styles.allianceListTagWrap}>
          <Text style={styles.allianceListTag}>[{a.tag}]</Text>
        </View>
        <View style={styles.allianceListCardInfo}>
          <Text style={styles.allianceListName} numberOfLines={1}>{a.name}</Text>
          <View style={styles.allianceListMeta}>
            <Users size={11} color={Colors.textMuted} />
            <Text style={styles.allianceListMetaText}>{a.member_count} membre{a.member_count !== 1 ? 's' : ''}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={() => onApply(a)} activeOpacity={0.7}>
          <Text style={styles.applyBtnText}>Postuler</Text>
          <ChevronRight size={14} color="#0A0A14" />
        </TouchableOpacity>
      </View>
      {a.description ? (
        <Text style={styles.allianceListDesc} numberOfLines={2}>{a.description}</Text>
      ) : null}
    </View>
  );
}

function DiscoverTab() {
  const alliance = useAlliance();
  const [applyTarget, setApplyTarget] = useState<AllianceSummary | null>(null);
  const [applyMessage, setApplyMessage] = useState('');

  const handleApply = useCallback(async () => {
    if (!applyTarget) return;
    try {
      await alliance.applyToAlliance({ allianceId: applyTarget.id, message: applyMessage.trim() || undefined });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showGameAlert('Candidature envoyée', `Votre candidature pour [${applyTarget.tag}] ${applyTarget.name} a été envoyée.`);
      setApplyTarget(null);
      setApplyMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      showGameAlert('Erreur', msg);
    }
  }, [applyTarget, applyMessage, alliance]);

  if (alliance.isLoadingAllAlliances) {
    return (
      <View style={styles.tabCentered}>
        <ActivityIndicator size="small" color={Colors.xenogas} />
        <Text style={styles.loadingText}>Chargement des alliances...</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={alliance.allAlliances}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={alliance.refreshAll} tintColor={Colors.primary} />}
        renderItem={({ item }) => <AllianceCard alliance={item} onApply={setApplyTarget} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Shield size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Aucune alliance</Text>
            <Text style={styles.emptySubtitle}>Soyez le premier à en créer une !</Text>
          </View>
        }
      />

      <Modal visible={!!applyTarget} transparent animationType="fade" onRequestClose={() => setApplyTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={() => setApplyTarget(null)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Postuler</Text>
                <Pressable onPress={() => setApplyTarget(null)} hitSlop={8}>
                  <X size={20} color={Colors.textMuted} />
                </Pressable>
              </View>

              {applyTarget && (
                <View style={styles.applyTargetInfo}>
                  <Text style={styles.applyTargetTag}>[{applyTarget.tag}]</Text>
                  <Text style={styles.applyTargetName}>{applyTarget.name}</Text>
                </View>
              )}

              <Text style={styles.inputLabel}>Message (optionnel)</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={applyMessage}
                onChangeText={setApplyMessage}
                maxLength={200}
                multiline
                numberOfLines={3}
                placeholder="Présentez-vous..."
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
              />

              <TouchableOpacity
                style={[styles.confirmBtn, alliance.isApplying && styles.confirmBtnDisabled]}
                onPress={handleApply}
                disabled={alliance.isApplying}
                activeOpacity={0.7}
              >
                {alliance.isApplying ? (
                  <ActivityIndicator size="small" color="#0A0A14" />
                ) : (
                  <>
                    <Send size={16} color="#0A0A14" />
                    <Text style={styles.confirmBtnText}>Envoyer la candidature</Text>
                  </>
                )}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function SearchTab() {
  const alliance = useAlliance();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AllianceSummary[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [applyTarget, setApplyTarget] = useState<AllianceSummary | null>(null);
  const [applyMessage, setApplyMessage] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    try {
      const data = await alliance.searchAlliances(q.trim());
      setResults(data);
      setHasSearched(true);
    } catch (err) {
      console.log('[Alliance Search] Error:', err);
    }
  }, [alliance]);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(text);
    }, 500);
  }, [doSearch]);

  const handleApply = useCallback(async () => {
    if (!applyTarget) return;
    try {
      await alliance.applyToAlliance({ allianceId: applyTarget.id, message: applyMessage.trim() || undefined });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showGameAlert('Candidature envoyée', `Candidature pour [${applyTarget.tag}] envoyée.`);
      setApplyTarget(null);
      setApplyMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      showGameAlert('Erreur', msg);
    }
  }, [applyTarget, applyMessage, alliance]);

  return (
    <>
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrap}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Nom ou tag d'alliance..."
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={Colors.primary}
          />
          {alliance.isSearchingAlliances && <ActivityIndicator size="small" color={Colors.xenogas} />}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <AllianceCard alliance={item} onApply={setApplyTarget} />}
        ListEmptyComponent={
          hasSearched ? (
            <View style={styles.emptyState}>
              <Search size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucun résultat</Text>
              <Text style={styles.emptySubtitle}>Essayez un autre nom ou tag</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Search size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Rechercher une alliance</Text>
              <Text style={styles.emptySubtitle}>Tapez un nom ou un tag pour commencer</Text>
            </View>
          )
        }
      />

      <Modal visible={!!applyTarget} transparent animationType="fade" onRequestClose={() => setApplyTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={() => setApplyTarget(null)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Postuler</Text>
                <Pressable onPress={() => setApplyTarget(null)} hitSlop={8}>
                  <X size={20} color={Colors.textMuted} />
                </Pressable>
              </View>
              {applyTarget && (
                <View style={styles.applyTargetInfo}>
                  <Text style={styles.applyTargetTag}>[{applyTarget.tag}]</Text>
                  <Text style={styles.applyTargetName}>{applyTarget.name}</Text>
                </View>
              )}
              <Text style={styles.inputLabel}>Message (optionnel)</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={applyMessage}
                onChangeText={setApplyMessage}
                maxLength={200}
                multiline
                numberOfLines={3}
                placeholder="Présentez-vous..."
                placeholderTextColor={Colors.textMuted}
                selectionColor={Colors.primary}
              />
              <TouchableOpacity
                style={[styles.confirmBtn, alliance.isApplying && styles.confirmBtnDisabled]}
                onPress={handleApply}
                disabled={alliance.isApplying}
                activeOpacity={0.7}
              >
                {alliance.isApplying ? (
                  <ActivityIndicator size="small" color="#0A0A14" />
                ) : (
                  <>
                    <Send size={16} color="#0A0A14" />
                    <Text style={styles.confirmBtnText}>Envoyer la candidature</Text>
                  </>
                )}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function InvitationsTab() {
  const alliance = useAlliance();

  const handleAccept = useCallback(async (inv: AllianceInvitation) => {
    try {
      await alliance.acceptInvitation(inv);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      showGameAlert('Erreur', msg);
    }
  }, [alliance]);

  const handleReject = useCallback(async (invId: string) => {
    try {
      await alliance.rejectInvitation(invId);
    } catch (err: unknown) {
      console.log('[Alliance] Reject error', err);
    }
  }, [alliance]);

  return (
    <ScrollView
      style={styles.tabScrollContent}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={false} onRefresh={alliance.refreshAll} tintColor={Colors.primary} />}
    >
      {alliance.pendingInvitations.length === 0 ? (
        <View style={styles.emptyState}>
          <Inbox size={36} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Aucune invitation</Text>
          <Text style={styles.emptySubtitle}>Les invitations d{"'"}alliances apparaîtront ici</Text>
        </View>
      ) : (
        alliance.pendingInvitations.map((inv) => (
          <View key={inv.id} style={styles.invitationCard}>
            <View style={styles.invitationInfo}>
              <Text style={styles.invitationName}>[{inv.alliance_tag}] {inv.alliance_name}</Text>
              <Text style={styles.invitationFrom}>Invité par {inv.sender_username}</Text>
            </View>
            <View style={styles.invitationActions}>
              <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(inv)} activeOpacity={0.7}>
                <Check size={16} color="#0A0A14" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectBtn} onPress={() => handleReject(inv.id)} activeOpacity={0.7}>
                <X size={16} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function MyApplicationsTab() {
  const alliance = useAlliance();

  const statusConfig: Record<string, { color: string; label: string }> = {
    pending: { color: Colors.warning, label: 'En attente' },
    accepted: { color: Colors.success, label: 'Acceptée' },
    rejected: { color: Colors.danger, label: 'Refusée' },
  };

  return (
    <ScrollView
      style={styles.tabScrollContent}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={false} onRefresh={alliance.refreshAll} tintColor={Colors.primary} />}
    >
      {alliance.myApplications.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={36} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Aucune candidature</Text>
          <Text style={styles.emptySubtitle}>Postulez à une alliance depuis Découverte ou Recherche</Text>
        </View>
      ) : (
        alliance.myApplications.map((app) => {
          const cfg = statusConfig[app.status] ?? statusConfig.pending;
          return (
            <View key={app.id} style={styles.applicationCard}>
              <View style={styles.applicationTop}>
                <View style={styles.applicationInfo}>
                  <Text style={styles.applicationAllianceName}>Alliance</Text>
                  <Text style={styles.applicationDate}>{formatDate(app.created_at)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: cfg.color + '18', borderColor: cfg.color + '35' }]}>
                  <Text style={[styles.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              </View>
              {app.message && (
                <Text style={styles.applicationMessage} numberOfLines={2}>{app.message}</Text>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function AllianceView() {
  const alliance = useAlliance();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<SubTab>('members');

  const appCount = alliance.pendingApplications.length;
  const showAppsTab = alliance.canManage;

  const tabs = useMemo(() => {
    const base: { id: SubTab; label: string; Icon: React.ComponentType<{ size: number; color: string }>; badge: number }[] = [
      { id: 'members', label: 'Membres', Icon: Users, badge: 0 },
      { id: 'chat', label: 'Chat', Icon: MessageCircle, badge: 0 },
    ];
    if (showAppsTab) {
      base.push({ id: 'applications', label: 'Candidatures', Icon: FileText, badge: appCount });
    }
    base.push({ id: 'settings', label: 'Gestion', Icon: Settings, badge: 0 });
    return base;
  }, [showAppsTab, appCount]);

  return (
    <View style={styles.container}>
      <View style={[styles.notchSpacer, { height: insets.top }]} />
      <View style={styles.allianceHeader}>
        <View style={styles.headerTagWrap}>
          <Text style={styles.headerTag}>[{alliance.myAlliance?.tag}]</Text>
        </View>
        <Text style={styles.headerName}>{alliance.myAlliance?.name}</Text>
        <View style={styles.headerStats}>
          <Users size={14} color={Colors.textMuted} />
          <Text style={styles.headerStatText}>{alliance.members.length} membre{alliance.members.length > 1 ? 's' : ''}</Text>
          <View style={styles.headerDot} />
          <Text style={styles.headerRoleText}>{getRoleBadge(alliance.myRole ?? 'member').label}</Text>
        </View>
        {alliance.myAlliance?.description ? (
          <Text style={styles.headerDesc} numberOfLines={2}>{alliance.myAlliance.description}</Text>
        ) : null}
      </View>

      <View style={styles.subTabRow}>
        {tabs.map(({ id, label, Icon, badge }) => {
          const isActive = activeTab === id;
          return (
            <TouchableOpacity
              key={id}
              style={[styles.subTab, isActive && styles.subTabActive]}
              onPress={() => setActiveTab(id)}
              activeOpacity={0.7}
            >
              <Icon size={13} color={isActive ? Colors.xenogas : Colors.textMuted} />
              <Text style={[styles.subTabText, isActive && styles.subTabTextActive]}>{label}</Text>
              {badge > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'members' && <MembersTab />}
      {activeTab === 'chat' && <ChatTab />}
      {activeTab === 'applications' && <ApplicationsManagementTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </View>
  );
}

function ApplicationsManagementTab() {
  const alliance = useAlliance();

  const handleProcess = useCallback(async (app: AllianceApplication, status: 'accepted' | 'rejected') => {
    const action = status === 'accepted' ? 'accepter' : 'refuser';
    showGameAlert('Confirmer', `Voulez-vous ${action} la candidature de ${app.applicant_username} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: status === 'accepted' ? 'Accepter' : 'Refuser',
        style: status === 'rejected' ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await alliance.processApplication({ applicationId: app.id, status });
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erreur';
            showGameAlert('Erreur', msg);
          }
        },
      },
    ], 'confirm');
  }, [alliance]);

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={false} onRefresh={alliance.refreshAll} tintColor={Colors.primary} />}
    >
      {alliance.pendingApplications.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={32} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Aucune candidature</Text>
          <Text style={styles.emptySubtitle}>Les candidatures en attente apparaîtront ici</Text>
        </View>
      ) : (
        alliance.pendingApplications.map((app) => (
          <View key={app.id} style={styles.applicationManageCard}>
            <View style={styles.applicationManageTop}>
              <View style={styles.applicationManageAvatar}>
                <User size={16} color={Colors.xenogas} />
              </View>
              <View style={styles.applicationManageInfo}>
                <Text style={styles.applicationManageName}>{app.applicant_username}</Text>
                <Text style={styles.applicationManageDate}>{formatDate(app.created_at)}</Text>
              </View>
            </View>
            {app.message && (
              <View style={styles.applicationManageMessageWrap}>
                <Text style={styles.applicationManageMessage}>{app.message}</Text>
              </View>
            )}
            <View style={styles.applicationManageActions}>
              <TouchableOpacity
                style={styles.applicationAcceptBtn}
                onPress={() => handleProcess(app, 'accepted')}
                activeOpacity={0.7}
              >
                <Check size={14} color="#0A0A14" />
                <Text style={styles.applicationAcceptBtnText}>Accepter</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applicationRejectBtn}
                onPress={() => handleProcess(app, 'rejected')}
                activeOpacity={0.7}
              >
                <X size={14} color={Colors.danger} />
                <Text style={styles.applicationRejectBtnText}>Refuser</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const InviteModalContent = React.memo(function InviteModalContent({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const alliance = useAlliance();
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<{ user_id: string; username: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ user_id: string; username: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  const searchPlayers = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setSuggestions([]);
      return;
    }
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from('players')
        .select('user_id, username')
        .ilike('username', `%${query}%`)
        .neq('user_id', user?.id ?? '')
        .limit(8);
      if (error) {
        setSuggestions([]);
      } else {
        setSuggestions((data ?? []) as { user_id: string; username: string }[]);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, [user?.id]);

  const handleUsernameChange = useCallback((text: string) => {
    setUsername(text);
    setSelectedPlayer(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length >= 1) {
      debounceRef.current = setTimeout(() => {
        void searchPlayers(text.trim());
      }, 400);
    } else {
      setSuggestions([]);
    }
  }, [searchPlayers]);

  const handleSelectPlayer = useCallback((player: { user_id: string; username: string }) => {
    setUsername(player.username);
    setSelectedPlayer(player);
    setSuggestions([]);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleInvite = useCallback(async () => {
    const target = username.trim();
    if (!target) return;
    setIsSending(true);
    try {
      await alliance.invitePlayer(target);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      showGameAlert('Invitation envoyée', `${target} a reçu une invitation.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      showGameAlert('Erreur', msg);
    } finally {
      setIsSending(false);
    }
  }, [username, alliance, onClose]);

  return (
    <View>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Inviter un joueur</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <X size={20} color={Colors.textMuted} />
        </Pressable>
      </View>

      <Text style={styles.inputLabel}>Pseudo du joueur</Text>
      <View style={styles.inlineInviteInputRow}>
        <TextInput
          ref={inputRef}
          style={styles.inviteModalInput}
          value={username}
          onChangeText={handleUsernameChange}
          placeholder="Rechercher un joueur..."
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={Colors.primary}
          returnKeyType="done"
        />
        {selectedPlayer && (
          <View style={styles.inlineResolvedBadge}>
            <Check size={12} color={Colors.success} />
          </View>
        )}
      </View>

      {isSearching && (
        <View style={styles.inlineSuggestionsLoading}>
          <ActivityIndicator size="small" color={Colors.xenogas} />
          <Text style={styles.inlineSuggestionsLoadingText}>Recherche...</Text>
        </View>
      )}

      {!selectedPlayer && suggestions.length > 0 && (
        <ScrollView style={styles.inviteSuggestionsScroll} keyboardShouldPersistTaps="handled">
          {suggestions.map((player) => (
            <TouchableOpacity
              key={player.user_id}
              style={styles.inlineSuggestionRow}
              onPress={() => handleSelectPlayer(player)}
              activeOpacity={0.6}
            >
              <View style={styles.inlineSuggestionAvatar}>
                <User size={14} color={Colors.xenogas} />
              </View>
              <Text style={styles.inlineSuggestionText}>{player.username}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <TouchableOpacity
        style={[styles.confirmBtn, (!username.trim() || isSending) && styles.confirmBtnDisabled]}
        onPress={handleInvite}
        disabled={!username.trim() || isSending}
        activeOpacity={0.7}
      >
        {isSending ? (
          <ActivityIndicator size="small" color="#0A0A14" />
        ) : (
          <>
            <UserPlus size={16} color={username.trim() ? '#0A0A14' : Colors.textMuted} />
            <Text style={[styles.confirmBtnText, !username.trim() && { color: Colors.textMuted }]}>Inviter</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
});

function MembersTab() {
  const alliance = useAlliance();
  const { userId } = useGame();
  const [showInviteModal, setShowInviteModal] = useState(false);

  const founders = alliance.members.filter(m => m.role === 'founder');
  const officers = alliance.members.filter(m => m.role === 'officer');
  const diplomats = alliance.members.filter(m => m.role === 'diplomat');
  const members = alliance.members.filter(m => m.role === 'member');

  const openInviteModal = useCallback(() => {
    setShowInviteModal(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const closeInviteModal = useCallback(() => {
    setShowInviteModal(false);
  }, []);

  const handleChangeRole = useCallback((member: AllianceMember, newRole: 'officer' | 'diplomat' | 'member') => {
    const roleLabels: Record<string, string> = { officer: 'Officier', diplomat: 'Diplomate', member: 'Membre' };
    const label = `Changer le rôle en ${roleLabels[newRole]}`;
    showGameAlert('Confirmer', `${label} : ${member.username} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer', onPress: async () => {
          try {
            await alliance.updateMemberRole({ memberId: member.id, newRole });
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erreur';
            showGameAlert('Erreur', msg);
          }
        },
      },
    ], 'confirm');
  }, [alliance]);

  const handleKick = useCallback((member: AllianceMember) => {
    showGameAlert('Exclure', `Exclure ${member.username} de l'alliance ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Exclure', style: 'destructive', onPress: async () => {
          try {
            await alliance.kickMember(member.id);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erreur';
            showGameAlert('Erreur', msg);
          }
        },
      },
    ], 'confirm');
  }, [alliance]);

  const [roleMenuMember, setRoleMenuMember] = useState<AllianceMember | null>(null);

  const renderMember = useCallback((member: AllianceMember) => {
    const badge = getRoleBadge(member.role);
    const BadgeIcon = badge.icon;
    const isMe = member.user_id === userId;
    const canAct = alliance.myRole === 'founder' && !isMe && member.role !== 'founder';

    return (
      <View key={member.id} style={styles.memberRow}>
        <View style={[styles.memberBadge, { backgroundColor: badge.color + '15', borderWidth: 1, borderColor: badge.color + '30' }]}>
          <BadgeIcon size={16} color={badge.color} />
        </View>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>
            {member.username}{isMe ? ' (vous)' : ''}
          </Text>
          <View style={[styles.roleBanner, { backgroundColor: badge.color + '12', borderColor: badge.color + '25' }]}>
            <BadgeIcon size={10} color={badge.color} />
            <Text style={[styles.roleBannerText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        </View>
        {canAct && (
          <View style={styles.memberActions}>
            <TouchableOpacity onPress={() => setRoleMenuMember(member)} style={styles.memberActionBtn} activeOpacity={0.6}>
              <Settings size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleKick(member)} style={styles.memberActionBtn} activeOpacity={0.6}>
              <Trash2 size={14} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [userId, alliance.myRole, handleKick]);

  return (
    <>
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={styles.tabContentInner}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={alliance.refreshAll} tintColor={Colors.primary} />}
      >
        {alliance.canManage && (
          <TouchableOpacity
            style={styles.invitePlayerBtn}
            onPress={openInviteModal}
            activeOpacity={0.7}
          >
            <View style={styles.invitePlayerIconWrap}>
              <UserPlus size={18} color={Colors.xenogas} />
            </View>
            <Text style={styles.invitePlayerBtnText}>Inviter un joueur</Text>
          </TouchableOpacity>
        )}

        {founders.length > 0 && (
          <View style={styles.roleGroup}>
            <Text style={styles.roleGroupTitle}>Fondateur</Text>
            {founders.map(renderMember)}
          </View>
        )}
        {officers.length > 0 && (
          <View style={styles.roleGroup}>
            <Text style={styles.roleGroupTitle}>Officiers</Text>
            {officers.map(renderMember)}
          </View>
        )}
        {diplomats.length > 0 && (
          <View style={styles.roleGroup}>
            <Text style={styles.roleGroupTitle}>Diplomates</Text>
            {diplomats.map(renderMember)}
          </View>
        )}
        {members.length > 0 && (
          <View style={styles.roleGroup}>
            <Text style={styles.roleGroupTitle}>Membres</Text>
            {members.map(renderMember)}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      <Modal visible={showInviteModal} transparent animationType="fade" onRequestClose={closeInviteModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={closeInviteModal}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <InviteModalContent onClose={closeInviteModal} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!roleMenuMember} transparent animationType="fade" onRequestClose={() => setRoleMenuMember(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setRoleMenuMember(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rôle de {roleMenuMember?.username}</Text>
              <Pressable onPress={() => setRoleMenuMember(null)} hitSlop={8}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.roleMenuDesc}>Chaque rôle dispose de permissions distinctes :</Text>
            {(['officer', 'diplomat', 'member'] as const).map((role) => {
              const badge = getRoleBadge(role);
              const BadgeIcon = badge.icon;
              const isCurrentRole = roleMenuMember?.role === role;
              const descriptions: Record<string, string> = {
                officer: 'Peut inviter des joueurs, gérer les candidatures et exclure des membres.',
                diplomat: 'Peut gérer les candidatures et recruter au nom de l\'alliance.',
                member: 'Peut discuter et participer aux activités de l\'alliance.',
              };
              return (
                <TouchableOpacity
                  key={role}
                  style={[styles.roleOption, isCurrentRole && styles.roleOptionActive, { borderColor: isCurrentRole ? badge.color + '40' : Colors.border }]}
                  onPress={() => {
                    if (!isCurrentRole && roleMenuMember) {
                      handleChangeRole(roleMenuMember, role);
                      setRoleMenuMember(null);
                    }
                  }}
                  disabled={isCurrentRole}
                  activeOpacity={0.7}
                >
                  <View style={[styles.roleOptionBadge, { backgroundColor: badge.color + '15' }]}>
                    <BadgeIcon size={16} color={badge.color} />
                  </View>
                  <View style={styles.roleOptionInfo}>
                    <Text style={[styles.roleOptionLabel, { color: isCurrentRole ? badge.color : Colors.text }]}>
                      {badge.label} {isCurrentRole ? '(actuel)' : ''}
                    </Text>
                    <Text style={styles.roleOptionDesc}>{descriptions[role]}</Text>
                  </View>
                  {isCurrentRole && <Check size={16} color={badge.color} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ChatTab() {
  const alliance = useAlliance();
  const { userId } = useGame();
  const [message, setMessage] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const refetchMessages = alliance.refetchMessages;
  useEffect(() => {
    const interval = setInterval(() => {
      refetchMessages();
    }, 8000);
    return () => clearInterval(interval);
  }, [refetchMessages]);

  useEffect(() => {
    if (alliance.messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [alliance.messages.length]);

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (!content) return;
    setMessage('');
    try {
      await alliance.sendMessage(content);
    } catch (err: unknown) {
      console.log('[Alliance Chat] Send error:', err);
    }
  }, [message, alliance]);

  const renderMessage = useCallback(({ item }: { item: AllianceMessage }) => {
    const isMe = item.sender_id === userId;
    return (
      <View style={[styles.chatBubbleWrap, isMe && styles.chatBubbleWrapMe]}>
        {!isMe && <Text style={styles.chatSender}>{item.sender_username}</Text>}
        <View style={[styles.chatBubble, isMe ? styles.chatBubbleMe : styles.chatBubbleOther]}>
          <Text style={[styles.chatText, isMe && styles.chatTextMe]}>{item.content}</Text>
        </View>
        <Text style={[styles.chatTime, isMe && styles.chatTimeMe]}>{formatChatTime(item.created_at)}</Text>
      </View>
    );
  }, [userId]);

  return (
    <KeyboardAvoidingView
      style={styles.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 150 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={alliance.messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.chatEmpty}>
            <MessageCircle size={32} color={Colors.textMuted} />
            <Text style={styles.chatEmptyText}>Aucun message</Text>
            <Text style={styles.chatEmptySubtext}>Soyez le premier à écrire !</Text>
          </View>
        }
      />
      <View style={styles.chatInputRow}>
        <TextInput
          style={styles.chatInput}
          value={message}
          onChangeText={setMessage}
          placeholder="Écrire un message..."
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={500}
          selectionColor={Colors.primary}
        />
        <TouchableOpacity
          style={[styles.chatSendBtn, !message.trim() && styles.chatSendBtnDisabled]}
          onPress={handleSend}
          disabled={!message.trim() || alliance.isSendingMessage}
          activeOpacity={0.7}
        >
          <Send size={18} color={message.trim() ? '#0A0A14' : Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function SettingsTab() {
  const alliance = useAlliance();
  const { userId } = useGame();
  const isFounder = alliance.myRole === 'founder';

  const handleLeave = useCallback(() => {
    const title = isFounder ? 'Dissoudre l\'alliance' : 'Quitter l\'alliance';
    const msg = isFounder
      ? 'Cela supprimera l\'alliance et tous ses membres. Cette action est irréversible.'
      : 'Êtes-vous sûr de vouloir quitter cette alliance ?';

    showGameAlert(title, msg, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: isFounder ? 'Dissoudre' : 'Quitter',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isFounder) {
              await alliance.dissolveAlliance();
            } else {
              await alliance.leaveAlliance();
            }
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Erreur';
            showGameAlert('Erreur', errMsg);
          }
        },
      },
    ], 'confirm');
  }, [isFounder, alliance]);

  const handleTransfer = useCallback((member: AllianceMember) => {
    showGameAlert(
      'Transférer le leadership',
      `Êtes-vous sûr de transférer le leadership à ${member.username} ? Vous deviendrez officier.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Transférer', onPress: async () => {
            try {
              await alliance.transferLeadership(member.id);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Erreur';
              showGameAlert('Erreur', errMsg);
            }
          },
        },
      ],
      'confirm',
    );
  }, [alliance]);

  const otherMembers = alliance.members.filter(m => m.user_id !== userId);

  const permissionsInfo = [
    { role: 'Fondateur', perms: 'Tout (invitations, kicks, rôles, candidatures, dissolution)' },
    { role: 'Officier', perms: 'Invitations, candidatures, exclusion de membres' },
    { role: 'Diplomate', perms: 'Candidatures, recrutement' },
    { role: 'Membre', perms: 'Chat, participation aux activités' },
  ];

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsSection}>
        <Text style={styles.settingsLabel}>Alliance</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsKey}>Nom</Text>
            <Text style={styles.settingsValue}>{alliance.myAlliance?.name}</Text>
          </View>
          <View style={styles.settingsDivider} />
          <View style={styles.settingsRow}>
            <Text style={styles.settingsKey}>Tag</Text>
            <Text style={[styles.settingsValue, { color: Colors.xenogas }]}>[{alliance.myAlliance?.tag}]</Text>
          </View>
          <View style={styles.settingsDivider} />
          <View style={styles.settingsRow}>
            <Text style={styles.settingsKey}>Membres</Text>
            <Text style={styles.settingsValue}>{alliance.members.length}</Text>
          </View>
        </View>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.settingsLabel}>Permissions par rôle</Text>
        <View style={styles.settingsCard}>
          {permissionsInfo.map((p, i) => (
            <React.Fragment key={p.role}>
              {i > 0 && <View style={styles.settingsDivider} />}
              <View style={styles.permRow}>
                <Text style={styles.permRole}>{p.role}</Text>
                <Text style={styles.permDesc}>{p.perms}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {isFounder && otherMembers.length > 0 && (
        <View style={styles.settingsSection}>
          <Text style={styles.settingsLabel}>Transférer le leadership</Text>
          {otherMembers.map(m => (
            <TouchableOpacity
              key={m.id}
              style={styles.transferRow}
              onPress={() => handleTransfer(m)}
              activeOpacity={0.7}
            >
              <Crown size={14} color={Colors.primary} />
              <Text style={styles.transferName}>{m.username}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.leaveBtn}
        onPress={handleLeave}
        activeOpacity={0.7}
      >
        <LogOut size={18} color={Colors.danger} />
        <Text style={styles.leaveBtnText}>
          {isFounder ? 'Dissoudre l\'alliance' : 'Quitter l\'alliance'}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  notchSpacer: {
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 13,
    marginTop: 12,
  },
  heroCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heroIconSmall: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.xenogas + '10',
    borderWidth: 1,
    borderColor: Colors.xenogas + '25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitleSmall: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
  },
  heroSubSmall: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  createBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  createBtnCompactText: {
    color: '#0A0A14',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  noAllianceTabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noAllianceTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 4,
  },
  noAllianceTabActive: {
    backgroundColor: Colors.xenogas + '12',
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
  },
  noAllianceTabText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  noAllianceTabTextActive: {
    color: Colors.xenogas,
  },
  tabBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginLeft: 2,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700' as const,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 30,
  },
  tabScrollContent: {
    flex: 1,
  },
  allianceListCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  allianceListCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  allianceListTagWrap: {
    backgroundColor: Colors.xenogas + '12',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.xenogas + '25',
  },
  allianceListTag: {
    color: Colors.xenogas,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  allianceListCardInfo: {
    flex: 1,
  },
  allianceListName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  allianceListMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  allianceListMetaText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  allianceListDesc: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  applyBtnText: {
    color: '#0A0A14',
    fontSize: 12,
    fontWeight: '700' as const,
  },
  searchContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  emptySubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    textAlign: 'center' as const,
    paddingHorizontal: 32,
  },
  invitationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.xenogas + '25',
    marginBottom: 8,
  },
  invitationInfo: {
    flex: 1,
  },
  invitationName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  invitationFrom: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  invitationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.danger + '15',
    borderWidth: 1,
    borderColor: Colors.danger + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  applicationTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  applicationInfo: {
    flex: 1,
  },
  applicationAllianceName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  applicationDate: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  applicationMessage: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
  applicationManageCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  applicationManageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  applicationManageAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.xenogas + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationManageInfo: {
    flex: 1,
  },
  applicationManageName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  applicationManageDate: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  applicationManageMessageWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  applicationManageMessage: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic' as const,
  },
  applicationManageActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  applicationAcceptBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingVertical: 10,
  },
  applicationAcceptBtnText: {
    color: '#0A0A14',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  applicationRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.danger + '12',
    borderRadius: 8,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  applicationRejectBtnText: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  applyTargetInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.xenogas + '25',
  },
  applyTargetTag: {
    color: Colors.xenogas,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  applyTargetName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  allianceHeader: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTagWrap: {
    backgroundColor: Colors.xenogas + '15',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
    marginBottom: 6,
  },
  headerTag: {
    color: Colors.xenogas,
    fontSize: 14,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
  headerName: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  headerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerStatText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  headerDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
  },
  headerRoleText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  headerDesc: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  subTabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 4,
  },
  subTabActive: {
    backgroundColor: Colors.xenogas + '12',
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
  },
  subTabText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  subTabTextActive: {
    color: Colors.xenogas,
  },
  tabContent: {
    flex: 1,
  },
  tabContentInner: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  roleGroup: {
    marginBottom: 16,
  },
  roleGroupTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  memberBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 6,
  },
  memberActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatContainer: {
    flex: 1,
  },
  chatList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  chatEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  chatEmptyText: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '600' as const,
    marginTop: 12,
  },
  chatEmptySubtext: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  chatBubbleWrap: {
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  chatBubbleWrapMe: {
    alignItems: 'flex-end',
  },
  chatSender: {
    color: Colors.xenogas,
    fontSize: 11,
    fontWeight: '600' as const,
    marginBottom: 3,
    marginLeft: 8,
  },
  chatBubble: {
    maxWidth: '80%' as unknown as number,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chatBubbleMe: {
    backgroundColor: Colors.xenogas + '20',
    borderBottomRightRadius: 4,
  },
  chatBubbleOther: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  chatText: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  chatTextMe: {
    color: Colors.text,
  },
  chatTime: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 3,
    marginLeft: 8,
  },
  chatTimeMe: {
    marginRight: 8,
    marginLeft: 0,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 80,
  },
  chatSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.xenogas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendBtnDisabled: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  settingsSection: {
    marginBottom: 20,
  },
  settingsLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingsCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 14,
  },
  settingsKey: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  settingsValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  permRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  permRole: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 2,
  },
  permDesc: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  transferName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.danger + '12',
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  leaveBtnText: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '92%' as unknown as number,
    maxWidth: 420,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
    marginBottom: 6,
    marginTop: 10,
  },
  modalInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalTextArea: {
    minHeight: 60,
    textAlignVertical: 'top' as const,
  },
  charCount: {
    color: Colors.textMuted,
    fontSize: 10,
    textAlign: 'right' as const,
    marginTop: 4,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 16,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnText: {
    color: '#0A0A14',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  inlineInviteInputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  inviteModalInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inviteSuggestionsScroll: {
    maxHeight: 200,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
    marginTop: 8,
  },
  inlineResolvedBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.success + '20',
    borderWidth: 1,
    borderColor: Colors.success + '50',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inlineSuggestionsLoading: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 8,
  },
  inlineSuggestionsLoadingText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  inlineSuggestionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  inlineSuggestionAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.xenogas + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inlineSuggestionText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500' as const,
  },
  invitePlayerBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.xenogas + '25',
    gap: 12,
  },
  invitePlayerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.xenogas + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  invitePlayerBtnText: {
    color: Colors.xenogas,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  roleBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
    alignSelf: 'flex-start' as const,
  },
  roleBannerText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  roleMenuDesc: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 17,
  },
  roleOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
    backgroundColor: Colors.card,
  },
  roleOptionActive: {
    backgroundColor: Colors.surface,
  },
  roleOptionBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  roleOptionInfo: {
    flex: 1,
  },
  roleOptionLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  roleOptionDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
});
