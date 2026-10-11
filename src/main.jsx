import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initMockAPI } from './lib/mockAPI'
import { initTheme } from './lib/theme'

// Initialize mock API for browser testing (only when not in Electron)
initMockAPI()

// Light or dark theme before the first paint
initTheme()

// Errors of the window go into the program's log (Settings › About › support file)
if (typeof window !== 'undefined' && window.electronAPI?.support?.log) {
    const send = (message) => { try { window.electronAPI.support.log('error', message) } catch { /* never in the way */ } }
    window.addEventListener('error', (e) => send(`${e.message} @ ${e.filename}:${e.lineno}`))
    window.addEventListener('unhandledrejection', (e) => send(`Unhandled: ${e.reason?.stack || e.reason}`))
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

