/** Browsers can't schedule reliable background notifications; the web build is reminder-free. */
export async function setupChannels() {}
export async function notificationsGranted() {
  return false;
}
export async function requestNotificationPermission() {
  return false;
}
export function reschedule() {
  return Promise.resolve();
}
export function startScheduler() {
  return () => {};
}
