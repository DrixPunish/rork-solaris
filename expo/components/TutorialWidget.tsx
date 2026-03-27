import React, { useRef, useEffect, useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Modal, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { BookOpen, ChevronRight, Gift, X, Minimize2, Maximize2, CheckCircle, Circle, Lock, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useTutorial } from '@/contexts/TutorialContext';
import { useGame } from '@/contexts/GameContext';
import { TUTORIAL_CATEGORIES, TutorialReward } from '@/constants/tutorial';
import { formatNumber } from '@/utils/gameCalculations';

function RewardBadge({ reward }: { reward: TutorialReward }) {
  const parts: string[] = [];
  if (reward.type === 'resources') {
    if (reward.fer) parts.push(`${formatNumber(reward.fer)} Fer`);
    if (reward.silice) parts.push(`${formatNumber(reward.silice)} Silice`);
    if (reward.xenogas) parts.push(`${formatNumber(reward.xenogas)} Xenogas`);
  } else if (reward.type === 'solar') {
    if (reward.solar) parts.push(`${reward.solar} Solar`);
  }
  return (
    <View style={styles.rewardBadge}>
      <Gift size={10} color={Colors.solar} />
      <Text style={styles.rewardText}>{parts.join(' + ')}</Text>
    </View>
  );
}

function TutorialFullModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const {
    allSteps, completedStepIds, claimedRewards, currentStepIndex,
    claimReward, isFinished, completedCount, totalSteps, progress,
  } = useTutorial();
  const { applyTutorialReward } = useGame() as ReturnType<typeof useGame> & { applyTutorialReward?: (r: TutorialReward, stepId?: string) => Promise<void> };
  const router = useRouter();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const claimAnim = useRef(new Animated.Value(1)).current;

  const handleClaimFromList = useCallback((stepId: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setClaimingId(stepId);
    Animated.sequence([
      Animated.timing(claimAnim, { toValue: 1.15, duration: 150, useNativeDriver: true }),
      Animated.timing(claimAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      const reward = claimReward(stepId);
      if (reward && applyTutorialReward) {
        console.log('[TUTORIAL CLAIM] Calling server for step:', stepId);
        void applyTutorialReward(reward, stepId).finally(() => {
          setClaimingId(null);
        });
      } else {
        setClaimingId(null);
      }
    });
  }, [claimReward, claimAnim, applyTutorialReward]);

  const handleNavigate = useCallback((navigateTo?: string) => {
    if (navigateTo) {
      onClose();
      setTimeout(() => {
        router.push(navigateTo as any);
      }, 300);
    }
  }, [router, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <BookOpen size={20} color={Colors.primary} />
              <Text style={styles.modalTitle}>Guide du Commandant</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.progressSection}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {completedCount} / {totalSteps} missions{isFinished ? ' — Terminé !' : ''}
            </Text>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {allSteps.map((step, index) => {
              const isCompleted = completedStepIds.has(step.id);
              const isClaimed = claimedRewards.includes(step.id);
              const isCurrent = index === currentStepIndex;
              const isLocked = index > currentStepIndex && !isCompleted;
              const canClaim = isCompleted && !isClaimed;
              const category = TUTORIAL_CATEGORIES[step.category];

              return (
                <Animated.View
                  key={step.id}
                  style={[
                    styles.stepCard,
                    isCurrent && styles.stepCardCurrent,
                    isClaimed && styles.stepCardDone,
                    isLocked && styles.stepCardLocked,
                    claimingId === step.id ? { transform: [{ scale: claimAnim }] } : undefined,
                  ]}
                >
                  <View style={styles.stepLeftIcon}>
                    {isClaimed ? (
                      <CheckCircle size={20} color={Colors.success} />
                    ) : isCompleted ? (
                      <Gift size={20} color={Colors.primary} />
                    ) : isLocked ? (
                      <Lock size={12} color={Colors.textMuted} />
                    ) : (
                      <Circle size={18} color={isCurrent ? Colors.primary : Colors.textMuted} />
                    )}
                  </View>

                  <View style={styles.stepContent}>
                    <View style={styles.stepTopRow}>
                      <Text style={[
                        styles.stepTitle,
                        isClaimed && styles.stepTitleDone,
                        isLocked && styles.stepTitleLocked,
                      ]}>
                        {step.title}
                      </Text>
                      <View style={[styles.categoryBadge, { backgroundColor: category.color + '20' }]}>
                        <Text style={[styles.categoryText, { color: category.color }]}>
                          {category.label}
                        </Text>
                      </View>
                    </View>

                    <Text style={[
                      styles.stepDesc,
                      isLocked && styles.stepDescLocked,
                    ]}>
                      {isLocked ? 'Complétez les missions précédentes...' : step.description}
                    </Text>

                    {!isLocked && <RewardBadge reward={step.reward} />}

                    {canClaim && (
                      <Pressable
                        style={styles.claimButtonList}
                        onPress={() => handleClaimFromList(step.id)}
                      >
                        <Sparkles size={14} color="#000" />
                        <Text style={styles.claimButtonListText}>Récupérer</Text>
                      </Pressable>
                    )}

                    {isCurrent && !isCompleted && step.navigateTo && (
                      <Pressable
                        style={styles.goButton}
                        onPress={() => handleNavigate(step.navigateTo)}
                      >
                        <Text style={styles.goButtonText}>Y aller</Text>
                        <ChevronRight size={14} color={Colors.primary} />
                      </Pressable>
                    )}
                  </View>
                </Animated.View>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function TutorialWidget() {
  const {
    currentStep, isCurrentStepCompleted, isCurrentStepClaimed,
    isDismissed, isMinimized, isLoaded, isFinished,
    claimReward, dismissTutorial, toggleMinimized,
    completedCount, totalSteps, progress,
  } = useTutorial();
  const { state } = useGame();
  const router = useRouter();
  const [showFullModal, setShowFullModal] = useState(false);
  const [showRewardAnimation, setShowRewardAnimation] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rewardScaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoaded && !isDismissed && !isFinished) {
      Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 8 }).start();
    }
  }, [isLoaded, isDismissed, isFinished, slideAnim]);

  useEffect(() => {
    if (isCurrentStepCompleted && !isCurrentStepClaimed) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isCurrentStepCompleted, isCurrentStepClaimed, pulseAnim]);

  const { applyTutorialReward } = useGame() as ReturnType<typeof useGame> & { applyTutorialReward?: (r: TutorialReward, stepId?: string) => Promise<void> };

  const handleClaim = useCallback(() => {
    if (!currentStep) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setShowRewardAnimation(true);
    Animated.sequence([
      Animated.spring(rewardScaleAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 6 }),
      Animated.delay(600),
      Animated.timing(rewardScaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setShowRewardAnimation(false);
      rewardScaleAnim.setValue(0);
    });

    const reward = claimReward(currentStep.id);
    if (reward && applyTutorialReward) {
      console.log('[TUTORIAL CLAIM] Calling server for step:', currentStep.id);
      void applyTutorialReward(reward, currentStep.id);
    }
  }, [currentStep, claimReward, applyTutorialReward, rewardScaleAnim]);

  const handleNavigate = useCallback(() => {
    if (currentStep?.navigateTo) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(currentStep.navigateTo as any);
    }
  }, [currentStep, router]);

  const handleDismiss = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      dismissTutorial();
    });
  }, [dismissTutorial, slideAnim]);

  if (!isLoaded || isDismissed || isFinished || !currentStep || !state.username) return null;

  const category = TUTORIAL_CATEGORIES[currentStep.category];
  const canClaim = isCurrentStepCompleted && !isCurrentStepClaimed;

  if (isMinimized) {
    return (
      <Animated.View style={[
        styles.minimizedContainer,
        { transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }] },
      ]}>
        <Pressable
          style={styles.minimizedButton}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            toggleMinimized();
          }}
        >
          <BookOpen size={16} color={Colors.primary} />
          <View style={styles.minimizedProgress}>
            <View style={[styles.minimizedProgressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.minimizedText}>{completedCount}/{totalSteps}</Text>
          {canClaim && <View style={styles.claimDot} />}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <>
      <Animated.View style={[
        styles.container,
        {
          transform: [
            { translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [200, 0] }) },
            { scale: canClaim ? pulseAnim : 1 },
          ],
        },
      ]}>
        <View style={[styles.categoryStrip, { backgroundColor: category.color }]} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <BookOpen size={14} color={Colors.primary} />
            <Text style={styles.headerTitle}>Mission {completedCount + 1}/{totalSteps}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => setShowFullModal(true)} hitSlop={8} style={styles.headerBtn}>
              <Maximize2 size={14} color={Colors.textSecondary} />
            </Pressable>
            <Pressable onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMinimized(); }} hitSlop={8} style={styles.headerBtn}>
              <Minimize2 size={14} color={Colors.textSecondary} />
            </Pressable>
            <Pressable onPress={handleDismiss} hitSlop={8} style={styles.headerBtn}>
              <X size={14} color={Colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.stepName}>{currentStep.title}</Text>
          <Text style={styles.stepDescription}>{currentStep.description}</Text>

          {!isCurrentStepCompleted && (
            <Text style={styles.hintText}>{currentStep.hint}</Text>
          )}

          <RewardBadge reward={currentStep.reward} />
        </View>

        <View style={styles.footer}>
          {canClaim ? (
            <Pressable style={styles.claimButton} onPress={handleClaim}>
              <Sparkles size={16} color="#000" />
              <Text style={styles.claimButtonText}>Récupérer la récompense</Text>
            </Pressable>
          ) : !isCurrentStepCompleted && currentStep.navigateTo ? (
            <Pressable style={styles.navigateButton} onPress={handleNavigate}>
              <Text style={styles.navigateButtonText}>Y aller</Text>
              <ChevronRight size={16} color={Colors.primary} />
            </Pressable>
          ) : (
            <View style={styles.inProgressBar}>
              <View style={styles.inProgressDot} />
              <Text style={styles.inProgressText}>En cours...</Text>
            </View>
          )}
        </View>

        <View style={styles.progressBarSmall}>
          <View style={[styles.progressBarSmallFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </Animated.View>

      {showRewardAnimation && (
        <View style={styles.rewardOverlay} pointerEvents="none">
          <Animated.View style={[
            styles.rewardPopup,
            { transform: [{ scale: rewardScaleAnim }] },
          ]}>
            <Gift size={32} color={Colors.primary} />
            <Text style={styles.rewardPopupText}>Récompense récupérée !</Text>
          </Animated.View>
        </View>
      )}

      <TutorialFullModal visible={showFullModal} onClose={() => setShowFullModal(false)} />
    </>
  );
}

export function TutorialReopenButton() {
  const { isDismissed, isFinished, reopenTutorial, isLoaded } = useTutorial();

  if (!isLoaded || !isDismissed || isFinished) return null;

  return (
    <Pressable
      style={styles.reopenButton}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        reopenTutorial();
      }}
    >
      <BookOpen size={14} color={Colors.primary} />
      <Text style={styles.reopenText}>Tutoriel</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute' as const,
    bottom: Platform.OS === 'web' ? 90 : 100,
    left: 12,
    right: 12,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...(Platform.OS !== 'web' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 20,
    } : {}),
  },
  categoryStrip: {
    height: 3,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    padding: 4,
  },
  body: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  stepName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 3,
  },
  stepDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 6,
  },
  hintText: {
    fontSize: 11,
    color: Colors.primary,
    fontStyle: 'italic' as const,
    marginBottom: 6,
    opacity: 0.8,
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.solar + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start' as const,
  },
  rewardText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.solar,
  },
  footer: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 2,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    gap: 8,
  },
  claimButtonText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#000',
  },
  navigateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '15',
    borderRadius: 10,
    paddingVertical: 9,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  navigateButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  inProgressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  inProgressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning,
  },
  inProgressText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  progressBarSmall: {
    height: 2,
    backgroundColor: Colors.border,
  },
  progressBarSmallFill: {
    height: 2,
    backgroundColor: Colors.primary,
  },
  minimizedContainer: {
    position: 'absolute' as const,
    bottom: Platform.OS === 'web' ? 90 : 100,
    right: 12,
  },
  minimizedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    ...(Platform.OS !== 'web' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 10,
    } : {}),
  },
  minimizedProgress: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  minimizedProgressFill: {
    height: 4,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  minimizedText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  claimDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  progressSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  modalScroll: {
    paddingHorizontal: 16,
  },
  stepCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 12,
    marginBottom: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepCardCurrent: {
    borderColor: Colors.primary + '50',
    backgroundColor: Colors.primary + '08',
  },
  stepCardDone: {
    opacity: 0.6,
  },
  stepCardLocked: {
    opacity: 0.35,
  },
  stepLeftIcon: {
    width: 28,
    alignItems: 'center',
    paddingTop: 2,
  },
  stepContent: {
    flex: 1,
  },
  stepTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  stepTitleDone: {
    textDecorationLine: 'line-through' as const,
    color: Colors.textSecondary,
  },
  stepTitleLocked: {
    color: Colors.textMuted,
  },
  categoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  categoryText: {
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
  stepDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15,
    marginBottom: 6,
  },
  stepDescLocked: {
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  claimButtonList: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 4,
    gap: 6,
    alignSelf: 'flex-start' as const,
  },
  claimButtonListText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#000',
  },
  goButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
    alignSelf: 'flex-start' as const,
  },
  goButtonText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  rewardOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  rewardPopup: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: Colors.primary,
    ...(Platform.OS !== 'web' ? {
      shadowColor: Colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 20,
      elevation: 30,
    } : {}),
  },
  rewardPopupText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  reopenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  reopenText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
