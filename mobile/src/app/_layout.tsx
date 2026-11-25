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
import { markAutoPrompted, shouldAutoPrompt } from '@/permissions/reminderSetup';
import { checkAnnouncements, registerForPush } from '@/notifications/announcements';
import { registerBackgroundTask } from '@/notifications/background';
import { LockGate } from '@/security/LockGate';
import { useData } from '@/store/data';
import { startAutoSync, syncNow } from '@/sync/engine';
import { FONT_ASSETS } from '@/ui/fonts';
import { ToastHost } from '@/ui/toast';
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
        void checkAnnouncements();
      }
    });
    // Ask for notification permission right away on open (system dialog),
    // then pick up admin notifications and keep the background task alive.
    void (async () => {
      if (Platform.OS !== 'web') {
        const p = await Notifications.getPermissionsAsync();
        if (!p.granted && p.canAskAgain) {
          const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
          if (r.granted) void reschedule();
        }
      }
      await registerForPush();
      await checkAnnouncements();
      await registerBackgroundTask();
    })();
    let notifSub: { remove(): void } | undefined;
    if (Platform.OS !== 'web') {
      notifSub = Notifications.addNotificationResponseReceivedListener((r) => {
        const route = r.notification.request.content.data?.route;
        if (typeof route === 'string' && route.startsWith('/')) router.push(route as never);
        if (r.notification.request.content.data?.announcementId) void checkAnnouncements();
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

  // On open, if reminders can't work reliably yet, show the setup screen (max once a day).
  useEffect(() => {
    if (!ready || !fontsReady) return;
    const id = setTimeout(async () => {
      const st = useData.getState();
      if (!st.settings.onboarded) {
        // people who already used the app don't need the wizard
        if (Object.keys(st.logs).length > 0) st.updateSettings({ onboarded: true });
        else {
          router.replace('/welcome');
          return;
        }
      }
      if (await shouldAutoPrompt()) {
        markAutoPrompted();
        router.push('/setup');
      }
    }, 300);
    return () => clearTimeout(id);
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
            <Stack.Screen name="setup" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="inbox" />
          </Stack>
        </LockGate>
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
