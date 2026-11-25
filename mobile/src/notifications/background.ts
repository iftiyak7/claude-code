/**
 * Periodic background work (Android WorkManager / iOS BGTask, roughly every
 * 30+ minutes when the OS allows): pick up admin notifications and keep the
 * next days of reminders scheduled even if the app is never opened.
 * Must be imported from the app entry so the task exists in headless runs.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useData } from '@/store/data';
import { checkAnnouncements } from './announcements';
import { reschedule } from './scheduler';

export const BG_TASK = 'tadbeer-background';

TaskManager.defineTask(BG_TASK, async () => {
  try {
    if (!useData.getState().ready) useData.getState().hydrate();
    await checkAnnouncements();
    await reschedule();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundTask() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BG_TASK)) return;
    await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 30 });
  } catch {
    /* unsupported (e.g. Expo Go) */
  }
}
