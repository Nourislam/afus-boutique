import { useSettingsStore } from '../stores/settingsStore';
import { isTaxEnabled } from './tax';

/** True while the shop uses TVA (Settings › Language & tax). */
export function useTaxEnabled() {
    return useSettingsStore(state => isTaxEnabled(state.settings));
}
