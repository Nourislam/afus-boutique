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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

