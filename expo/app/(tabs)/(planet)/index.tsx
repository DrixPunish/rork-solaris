import React, { useMemo, useState, useCallback } from 'react';
import ClickableCoords from '@/components/ClickableCoords';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Shield, Rocket, FlaskConical, Building2, Gem, Pencil, X, Check, Mail, ChevronRight, Navigation, FileText, UserCircle, Users, LogOut, Settings, BarChart3, MapPin } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/utils/supabase';
import { useGame } from '@/contexts/GameContext';
import { useFleet } from '@/contexts/FleetContext';
import { formatNumber } from '@/utils/gameCalculations';
import ResourceBar from '@/components/ResourceBar';
import PlanetVisual from '@/components/PlanetVisual';
import StarField from '@/components/StarField';
import Colors from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { showGameAlert } from '@/components/GameAlert';
import { TutorialReopenButton } from '@/components/TutorialWidget';
import QuantumShieldCard from '@/components/QuantumShieldCard';

const LAST_USERNAME_CHANGE_KEY = 'solaris_last_username_change';

export default function PlanetScreen() {
  const { state, activePlanet, activeRenamePlanet, setUsername, userEmail, setActivePlanetId } = useGame();
  const router = useRouter();
  const { user } = useAuth();
  const { signOut } = useAuth();
  const { activeMissions } = useFleet();
  const { userId } = useGame();
  const fleetCount = activeMissions.filter(m => {
    if (m.sender_id === userId) return true;
    if (m.target_player_id === userId && m.mission_phase === 'en_route') return true;
    return false;
  }).length;

  const unreadQuery = useQuery({
    queryKey: ['messages', 'unread-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('read', false);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 15000,
  });
  const unreadCount = unreadQuery.data ?? 0;

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [newPlanetName, setNewPlanetName] = useState('');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(state.username ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const openRenameModal = useCallback(() => {
    setNewPlanetName(activePlanet.planetName);
    setRenameModalVisible(true);
  }, [activePlanet.planetName]);

  const confirmRename = useCallback(() => {
    const trimmed = newPlanetName.trim();
    if (trimmed && trimmed.length <= 24) {
      activeRenamePlanet(trimmed);
    }
    setRenameModalVisible(false);
  }, [newPlanetName, activeRenamePlanet]);

  const handleEditUsername = useCallback(() => {
    setNewUsername(state.username ?? '');
    setIsEditingUsername(true);
  }, [state.username]);

  const handleCancelEdit = useCallback(() => {
    setIsEditingUsername(false);
    setNewUsername(state.username ?? '');
  }, [state.username]);

  const handleSaveUsername = useCallback(async () => {
    const trimmed = newUsername.trim();
    if (trimmed.length < 3) {
      showGameAlert('Erreur', 'Le pseudo doit contenir au moins 3 caractères.');
      return;
    }
    if (trimmed.length > 20) {
      showGameAlert('Erreur', 'Le pseudo ne peut pas dépasser 20 caractères.');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      showGameAlert('Erreur', 'Le pseudo ne peut contenir que des lettres, chiffres, tirets et underscores.');
      return;
    }
    const lastChangeStr = await AsyncStorage.getItem(LAST_USERNAME_CHANGE_KEY);
    if (lastChangeStr) {
      const lastChange = parseInt(lastChangeStr, 10);
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (Date.now() - lastChange < oneDayMs) {
        const hoursLeft = Math.ceil((oneDayMs - (Date.now() - lastChange)) / (60 * 60 * 1000));
        showGameAlert('Limite atteinte', `Vous pourrez changer votre pseudo dans ${hoursLeft}h.`);
        return;
      }
    }
    setIsSaving(true);
    try {
      setUsername(trimmed);
      await AsyncStorage.setItem(LAST_USERNAME_CHANGE_KEY, String(Date.now()));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditingUsername(false);
      console.log('[Planet] Username changed to:', trimmed);
    } catch (err) {
      console.log('[Planet] Error saving username:', err);
      showGameAlert('Erreur', 'Impossible de sauvegarder le pseudo.');
    } finally {
      setIsSaving(false);
    }
  }, [newUsername, setUsername]);

  const handleSignOut = useCallback(() => {
    showGameAlert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déconnexion',
          style: 'destructive',
          onPress: () => {
            console.log('[Planet] Signing out');
            void signOut();
          },
        },
      ],
      'confirm',
    );
  }, [signOut]);

  const totalBuildings = useMemo(
    () => Object.values(activePlanet.buildings).reduce((sum, level) => sum + level, 0),
    [activePlanet.buildings],
  );

  const totalResearch = useMemo(
    () => Object.values(state.research).reduce((sum, level) => sum + level, 0),
    [state.research],
  );

  const totalShips = useMemo(
    () => Object.values(activePlanet.ships).reduce((sum, count) => sum + count, 0),
    [activePlanet.ships],
  );

  const activeTimerCount = activePlanet.activeTimers.length;

  return (
    <View style={styles.container}>
      <ResourceBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activePlanet.isColony && (
          <TouchableOpacity
            style={styles.colonyBanner}
            onPress={() => setActivePlanetId(null)}
            activeOpacity={0.7}
          >
            <View style={styles.colonyBannerLeft}>
              <MapPin size={14} color={Colors.xenogas} />
              <Text style={styles.colonyBannerText}>Colonie active : <Text style={styles.colonyBannerName}>{activePlanet.planetName}</Text></Text>
            </View>
            <Text style={styles.colonyBannerAction}>Retour planète principale</Text>
          </TouchableOpacity>
        )}

        <View style={styles.planetSection}>
          <StarField starCount={35} height={200} />
          <View style={styles.planetGlowOuter}>
            <PlanetVisual size={130} />
          </View>
          <Pressable onPress={openRenameModal} style={styles.planetNameRow}>
            <Text style={styles.planetName}>{activePlanet.planetName}</Text>
            <View style={styles.editIconCircle}>
              <Pencil size={11} color={Colors.textMuted} />
            </View>
          </Pressable>
          <ClickableCoords coords={activePlanet.coordinates} style={styles.coordinates} center />
          {activeTimerCount > 0 && (
            <View style={styles.timerBadge}>
              <View style={styles.timerDot} />
              <Text style={styles.timerBadgeText}>
                {activeTimerCount} construction{activeTimerCount > 1 ? 's' : ''} en cours
              </Text>
            </View>
          )}
        </View>

        <View style={styles.solarCard}>
          <View style={styles.solarRow}>
            <Gem size={18} color={Colors.solar} />
            <Text style={styles.solarLabel}>Solar</Text>
            <Text style={styles.solarValue}>{formatNumber(state.solar)}</Text>
          </View>
          <Text style={styles.solarDesc}>Token crypto du jeu - Échangeable on-chain</Text>
        </View>

        <Text style={styles.sectionTitle}>Vue d{"'"}ensemble</Text>
        <View style={styles.grid}>
          <View style={styles.overviewCard}>
            <Building2 size={18} color={Colors.primary} />
            <Text style={styles.overviewValue}>{totalBuildings}</Text>
            <Text style={styles.overviewLabel}>Bâtiments</Text>
          </View>
          <View style={styles.overviewCard}>
            <FlaskConical size={18} color={Colors.silice} />
            <Text style={styles.overviewValue}>{totalResearch}</Text>
            <Text style={styles.overviewLabel}>Recherche</Text>
          </View>
          <View style={styles.overviewCard}>
            <Rocket size={18} color={Colors.accent} />
            <Text style={styles.overviewValue}>{totalShips}</Text>
            <Text style={styles.overviewLabel}>Flotte</Text>
          </View>
          <View style={styles.overviewCard}>
            <Shield size={18} color={Colors.success} />
            <Text style={styles.overviewValue}>{Object.values(activePlanet.defenses).reduce((sum, count) => sum + count, 0)}</Text>
            <Text style={styles.overviewLabel}>Défense</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.fleetCard}
          onPress={() => router.push('/fleet-overview')}
          activeOpacity={0.7}
        >
          <View style={styles.fleetIconWrap}>
            <Navigation size={20} color={Colors.accent} />
            {fleetCount > 0 && (
              <View style={styles.fleetBadge}>
                <Text style={styles.fleetBadgeText}>{fleetCount}</Text>
              </View>
            )}
          </View>
          <View style={styles.messagesTextWrap}>
            <Text style={styles.messagesTitle}>Mouvements de Flotte</Text>
            <Text style={styles.messagesDesc}>
              {fleetCount > 0 ? `${fleetCount} flotte${fleetCount > 1 ? 's' : ''} en mouvement` : 'Aucune flotte en mouvement'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reportsCard}
          onPress={() => router.push('/reports')}
          activeOpacity={0.7}
        >
          <View style={styles.reportsIconWrap}>
            <FileText size={20} color={Colors.silice} />
          </View>
          <View style={styles.messagesTextWrap}>
            <Text style={styles.messagesTitle}>Rapports</Text>
            <Text style={styles.messagesDesc}>Espionnage, Combat & Transport</Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <QuantumShieldCard />

        <View style={styles.web3Card}>
          <LinearGradient
            colors={['rgba(212, 168, 71, 0.06)', 'rgba(139, 37, 37, 0.06)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.web3Gradient}
          >
            <View style={styles.web3Header}>
              <Wallet size={22} color={Colors.primary} />
              <View style={styles.web3TextWrap}>
                <Text style={styles.web3Title}>Intégration Web3</Text>
                <Text style={styles.web3Sub}>
                  Connectez votre wallet pour échanger des ressources on-chain, minter des NFTs de planètes et rejoindre la galaxie décentralisée.
                </Text>
              </View>
            </View>
            <Pressable style={styles.web3Button}>
              <Text style={styles.web3ButtonText}>Connecter le Wallet</Text>
            </Pressable>
          </LinearGradient>
        </View>

        <TouchableOpacity
          style={styles.messagesCard}
          onPress={() => router.push('/messages')}
          activeOpacity={0.7}
        >
          <View style={styles.messagesIconWrap}>
            <Mail size={20} color={Colors.primary} />
            {unreadCount > 0 && (
              <View style={styles.messagesBadge}>
                <Text style={styles.messagesBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <View style={styles.messagesTextWrap}>
            <Text style={styles.messagesTitle}>Messages</Text>
            <Text style={styles.messagesDesc}>
              {unreadCount > 0 ? `${unreadCount} non lu${unreadCount > 1 ? 's' : ''}` : 'Aucun nouveau message'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statsCard}
          onPress={() => router.push('/statistics')}
          activeOpacity={0.7}
        >
          <View style={styles.statsIconWrap}>
            <BarChart3 size={20} color={Colors.energy} />
          </View>
          <View style={styles.messagesTextWrap}>
            <Text style={styles.messagesTitle}>Statistiques</Text>
            <Text style={styles.messagesDesc}>Production, scores, combat</Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.coloniesCard}
          onPress={() => router.push('/colonies')}
          activeOpacity={0.7}
        >
          <View style={styles.coloniesIconWrap}>
            <MapPin size={20} color={Colors.xenogas} />
            {(state.colonies?.length ?? 0) > 0 && (
              <View style={styles.coloniesBadge}>
                <Text style={styles.coloniesBadgeText}>{state.colonies?.length}</Text>
              </View>
            )}
          </View>
          <View style={styles.messagesTextWrap}>
            <Text style={styles.messagesTitle}>Colonies</Text>
            <Text style={styles.messagesDesc}>
              {(state.colonies?.length ?? 0) > 0 ? `${state.colonies?.length} colonie${(state.colonies?.length ?? 0) > 1 ? 's' : ''} active${(state.colonies?.length ?? 0) > 1 ? 's' : ''}` : 'Gérer vos colonies'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TutorialReopenButton />

        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => setShowSettings(!showSettings)}
          activeOpacity={0.7}
        >
          <View style={styles.settingsBtnLeft}>
            <View style={[styles.settingsIconWrap, { backgroundColor: Colors.textMuted + '12' }]}>
              <Settings size={18} color={Colors.textMuted} />
            </View>
            <Text style={styles.settingsBtnLabel}>Paramètres</Text>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} style={showSettings ? { transform: [{ rotate: '90deg' }] } : undefined} />
        </TouchableOpacity>

        {showSettings && (<View>
        <View style={styles.settingsCard}>
          <View style={styles.settingsRow}>
            <View style={styles.settingsIconWrap}>
              <Mail size={18} color={Colors.primary} />
            </View>
            <View style={styles.settingsContent}>
              <Text style={styles.settingsLabel}>Email</Text>
              <Text style={styles.settingsValue}>{userEmail || '—'}</Text>
            </View>
          </View>

          <View style={styles.settingsDivider} />

          <View style={styles.settingsRow}>
            <View style={styles.settingsIconWrap}>
              <UserCircle size={18} color={Colors.accent} />
            </View>
            <View style={styles.settingsContent}>
              <Text style={styles.settingsLabel}>Pseudo</Text>
              {isEditingUsername ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInput}
                    value={newUsername}
                    onChangeText={setNewUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    placeholder="Nouveau pseudo"
                    placeholderTextColor={Colors.textMuted}
                    testID="edit-username-input"
                  />
                  <TouchableOpacity
                    onPress={handleSaveUsername}
                    style={styles.editBtn}
                    disabled={isSaving}
                    activeOpacity={0.6}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color={Colors.success} />
                    ) : (
                      <Check size={16} color={Colors.success} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    style={styles.editBtn}
                    activeOpacity={0.6}
                  >
                    <X size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.valueRow}>
                  <Text style={styles.settingsValue}>{state.username || '—'}</Text>
                  <TouchableOpacity onPress={handleEditUsername} style={styles.editIconBtn} activeOpacity={0.6}>
                    <Pencil size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          <View style={styles.settingsDivider} />

          <View style={styles.settingsRow}>
            <View style={styles.settingsIconWrap}>
              <Wallet size={18} color={Colors.solar} />
            </View>
            <View style={styles.settingsContent}>
              <Text style={styles.settingsLabel}>Wallet</Text>
              <Text style={[styles.settingsValue, { color: Colors.textMuted, fontStyle: 'italic' as const }]}>Non connecté</Text>
            </View>
          </View>
        </View>

        <Text style={styles.usernameHint}>Le pseudo peut être changé une fois par jour.</Text>

        <TouchableOpacity
          style={styles.friendsCard}
          onPress={() => router.push('/friends')}
          activeOpacity={0.7}
        >
          <View style={[styles.settingsIconWrap, { backgroundColor: Colors.success + '15' }]}>
            <Users size={18} color={Colors.success} />
          </View>
          <View style={styles.settingsContent}>
            <Text style={styles.friendsTitle}>Amis</Text>
            <Text style={styles.friendsSub}>Gérer votre liste d{"'"}amis</Text>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <LogOut size={18} color={Colors.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </TouchableOpacity>
        </View>)}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={renameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setRenameModalVisible(false)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{activePlanet.isColony ? 'Renommer la colonie' : 'Renommer la planète'}</Text>
                <Pressable onPress={() => setRenameModalVisible(false)} hitSlop={8}>
                  <X size={20} color={Colors.textMuted} />
                </Pressable>
              </View>
              <TextInput
                style={styles.renameInput}
                value={newPlanetName}
                onChangeText={setNewPlanetName}
                maxLength={24}
                autoFocus
                placeholderTextColor={Colors.textMuted}
                placeholder={activePlanet.isColony ? 'Nom de la colonie' : 'Nom de la planète'}
                selectionColor={Colors.primary}
              />
              <Text style={styles.charCount}>{newPlanetName.length}/24</Text>
              <Pressable
                style={[styles.confirmBtn, !newPlanetName.trim() && styles.confirmBtnDisabled]}
                onPress={confirmRename}
                disabled={!newPlanetName.trim()}
              >
                <Check size={16} color="#fff" />
                <Text style={styles.confirmBtnText}>Confirmer</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  planetSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  planetGlowOuter: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  planetNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  editIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  planetName: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700' as const,
  },
  coordinates: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '500' as const,
    marginTop: 4,
    letterSpacing: 1,
  },
  timerBadge: {
    marginTop: 8,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  timerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  timerBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  solarCard: {
    backgroundColor: Colors.solar + '10',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.solar + '25',
  },
  solarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  solarLabel: {
    color: Colors.solar,
    fontSize: 14,
    fontWeight: '700' as const,
    flex: 1,
  },
  solarValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
  },
  solarDesc: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },

  overviewCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    width: '48%' as unknown as number,
    flexGrow: 1,
    flexBasis: '45%' as unknown as number,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  overviewValue: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const,
    marginTop: 8,
    letterSpacing: -0.5,
  },
  overviewLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500' as const,
    marginTop: 3,
    letterSpacing: 0.3,
  },
  web3Card: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    marginBottom: 16,
  },
  web3Gradient: {
    padding: 16,
  },
  web3Header: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  web3TextWrap: {
    flex: 1,
  },
  web3Title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  web3Sub: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  web3Button: {
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '35',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  web3ButtonText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
  },

  messagesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  messagesIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  messagesBadgeText: {
    color: '#0A0A14',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  messagesTextWrap: {
    flex: 1,
  },
  messagesTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  messagesDesc: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  colonyBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.xenogas + '12',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.xenogas + '30',
  },
  colonyBannerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    flex: 1,
  },
  colonyBannerText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  colonyBannerName: {
    color: Colors.xenogas,
    fontWeight: '700' as const,
  },
  colonyBannerAction: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  fleetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  fleetIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.accent + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  fleetBadgeText: {
    color: '#0A0A14',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  reportsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  reportsIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.silice + '12',
    alignItems: 'center',
    justifyContent: 'center',
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
    padding: 20,
    width: '85%' as unknown as number,
    maxWidth: 340,
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
    fontSize: 16,
    fontWeight: '700' as const,
  },
  renameInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  charCount: {
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'right' as const,
    marginTop: 6,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnText: {
    color: '#0A0A14',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  settingsCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden' as const,
    marginBottom: 4,
  },
  settingsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  settingsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  settingsContent: {
    flex: 1,
  },
  settingsLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  settingsValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 62,
  },
  editRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  editInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  valueRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  editIconBtn: {
    padding: 4,
  },
  usernameHint: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 12,
    marginLeft: 4,
  },
  friendsCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  friendsTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  friendsSub: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.danger + '12',
    borderWidth: 1,
    borderColor: Colors.danger + '30',
  },
  logoutText: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  statsCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  statsIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.energy + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  coloniesCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  coloniesIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.xenogas + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  coloniesBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    backgroundColor: Colors.xenogas,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
  },
  coloniesBadgeText: {
    color: '#0A0A14',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  settingsBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  settingsBtnLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  settingsBtnLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
