import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, trpcClient } from "@/lib/trpc";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { GameProvider, useGame } from "@/contexts/GameContext";
import { FleetProvider } from "@/contexts/FleetContext";
import { AllianceProvider } from "@/contexts/AllianceContext";
import { TutorialProvider } from "@/contexts/TutorialContext";
import TutorialWidget from "@/components/TutorialWidget";
import Colors from "@/constants/colors";
import NotificationToast from "@/components/NotificationToast";
import GameAlertProvider from "@/components/GameAlert";

void SplashScreen.preventAutoHideAsync();

if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
  try {
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
      if (key.includes('EXPO_ROUTER') || key.includes('expo-router')) {
        sessionStorage.removeItem(key);
        console.log('[Layout] Cleared stale router state:', key);
      }
    }
  } catch (e) {
    console.log('[Layout] Error clearing router state:', e);
  }
}

const queryClient = new QueryClient();

class NavigationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.log('[NavigationErrorBoundary] Caught error:', error.message);
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.clear();
      } catch (e) {
        console.log('[NavigationErrorBoundary] Error clearing sessionStorage:', e);
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Erreur de navigation</Text>
          <Text style={errorStyles.subtitle}>L'état de navigation est devenu invalide.</Text>
          <TouchableOpacity
            style={errorStyles.button}
            onPress={() => {
              if (Platform.OS === 'web') {
                try { sessionStorage.clear(); } catch { }
                window.location.href = '/';
              } else {
                this.setState({ hasError: false });
              }
            }}
          >
            <Text style={errorStyles.buttonText}>Recharger</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 8,
  },
  subtitle: {
    color: '#8899aa',
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center' as const,
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600' as const,
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { needsUsername, isLoading: gameLoading } = useGame();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || gameLoading) return;

    const inLogin = segments[0] === 'login';
    const inChooseUsername = segments[0] === 'choose-username';

    if (!isAuthenticated && !inLogin) {
      console.log('[AuthGate] Not authenticated, redirecting to login');
      router.replace('/login');
    } else if (isAuthenticated && inLogin) {
      if (needsUsername) {
        console.log('[AuthGate] Needs username, redirecting to choose-username');
        router.replace('/choose-username');
      } else {
        console.log('[AuthGate] Authenticated, redirecting to home');
        router.replace('/');
      }
    } else if (isAuthenticated && needsUsername && !inChooseUsername) {
      console.log('[AuthGate] Needs username, redirecting to choose-username');
      router.replace('/choose-username');
    } else if (isAuthenticated && !needsUsername && inChooseUsername) {
      console.log('[AuthGate] Has username, redirecting to home');
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, gameLoading, needsUsername, segments, router]);

  useEffect(() => {
    if (!isLoading) {
      void SplashScreen.hideAsync();
    }
  }, [isLoading]);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="choose-username" options={{ headerShown: false }} />
      <Stack.Screen name="messages" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="compose-message" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="message-detail" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="friends" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="send-fleet" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="fleet-overview" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="reports" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="espionage-report" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="combat-report" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="transport-report" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="statistics" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="colonies" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="colony-detail" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <NavigationErrorBoundary>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <AuthProvider>
            <GameProvider>
              <FleetProvider>
                <AllianceProvider>
                  <TutorialProvider>
                    <StatusBar style="light" />
                    <GameAlertProvider>
                      <AuthGate>
                        <RootLayoutNav />
                        <TutorialWidget />
                        <NotificationToast />
                      </AuthGate>
                    </GameAlertProvider>
                  </TutorialProvider>
                </AllianceProvider>
              </FleetProvider>
            </GameProvider>
          </AuthProvider>
        </GestureHandlerRootView>
        </QueryClientProvider>
      </trpc.Provider>
    </NavigationErrorBoundary>
  );
}
