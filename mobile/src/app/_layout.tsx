import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { reschedule, startScheduler } from '@/notifications/scheduler';
import { LockGate } from '@/security/LockGate';
import { useData } from '@/store/data';
import { startAutoSync, syncNow } from '@/sync/engine';
import { FONT_ASSETS } from '@/ui/fonts';
import { useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Load the local database synchronously before the first frame — the UI
// never shows a loading spinner for local data.
useData.getState().hydrate();

export default function RootLayout() {
  const t = useTheme();
  const ready = useData((s) => s.ready);
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const fontsReady = fontsLoaded || !!fontError; // fall back to system fonts rather than block

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg).catch(() => undefined);
  }, [t.bg]);

  useEffect(() => {
    if (!ready) return;
    const stopScheduler = startScheduler();
    const stopSync = startAutoSync();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void reschedule();
        void syncNow();
      }
    });
    let notifSub: { remove(): void } | undefined;
    if (Platform.OS !== 'web') {
      notifSub = Notifications.addNotificationResponseReceivedListener((r) => {
        const route = r.notification.request.content.data?.route;
        if (typeof route === 'string' && route.startsWith('/')) router.push(route as never);
      });
    }
    return () => {
      stopScheduler();
      stopSync();
      app.remove();
      notifSub?.remove();
    };
  }, [ready]);

  useEffect(() => {
    if (ready && fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, fontsReady]);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <LockGate>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: t.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="zikr/[id]" options={{ animation: 'fade_from_bottom' }} />
            <Stack.Screen name="amal/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="task/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="reminder/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="medicine/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="routine/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
        </LockGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
