/**
 * Set the user's location from GPS. GPS needs no internet, so this works fully
 * offline; only the town name lookup needs a connection and is skipped if it
 * fails. Everything computed from the location (prayer times, sunrise/sunset,
 * qibla) is calculated on the device.
 */
import * as Location from 'expo-location';
import { useData } from '@/store/data';

export type LocateResult = 'ok' | 'denied' | 'failed';

export async function locateMe(): Promise<LocateResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return 'denied';
    const pos =
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ??
      (await Location.getLastKnownPositionAsync());
    if (!pos) return 'failed';
    let label: string | undefined;
    try {
      const [place] = await Location.reverseGeocodeAsync(pos.coords);
      label = place?.city ?? place?.district ?? place?.subregion ?? place?.region ?? undefined;
    } catch {
      /* offline — keep coordinates only */
    }
    useData.getState().updateSettings({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude, label } });
    return 'ok';
  } catch {
    return 'failed';
  }
}
