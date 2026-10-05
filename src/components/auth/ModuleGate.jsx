import { Navigate } from 'react-router-dom';
import { useSettingsStore } from '../../stores/settingsStore';

/** A screen of a module hidden in Settings › Modules: an old link goes home instead. */
export function ModuleGate({ module, children }) {
    const on = useSettingsStore(state => !!state.settings.features?.[module]);
    return on ? children : <Navigate to="/" replace />;
}

export default ModuleGate;
