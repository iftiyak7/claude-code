/** Auth tokens live in the OS keychain/keystore, never in plain storage. */
import * as SecureStore from 'expo-secure-store';

const ACCESS = 'tadbeer.access';
const REFRESH = 'tadbeer.refresh';
const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const tokens = {
  async get() {
    const [access, refresh] = await Promise.all([SecureStore.getItemAsync(ACCESS, opts), SecureStore.getItemAsync(REFRESH, opts)]);
    return { access, refresh };
  },
  async set(access: string, refresh: string) {
    await Promise.all([SecureStore.setItemAsync(ACCESS, access, opts), SecureStore.setItemAsync(REFRESH, refresh, opts)]);
  },
  async clear() {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS, opts), SecureStore.deleteItemAsync(REFRESH, opts)]);
  },
};
