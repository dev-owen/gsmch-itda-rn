import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const webMemory = new Map<string, string>();
export const secureStorage = {
  getItem(key: string) { return Platform.OS === 'web' ? webMemory.get(key) || null : SecureStore.getItem(key); },
  setItem(key: string, value: string) { if (Platform.OS === 'web') webMemory.set(key, value); else SecureStore.setItem(key, value); },
  async getItemAsync(key: string) { return Platform.OS === 'web' ? webMemory.get(key) || null : SecureStore.getItemAsync(key); },
  async setItemAsync(key: string, value: string) { if (Platform.OS === 'web') webMemory.set(key, value); else await SecureStore.setItemAsync(key, value); },
};

export async function removeSecureValue(key: string) {
  if (Platform.OS === 'web') webMemory.delete(key); else await SecureStore.deleteItemAsync(key);
}
