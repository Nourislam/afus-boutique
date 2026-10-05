# afus-boutique

A complete, offline-capable Point of Sale system for retail businesses built with Electron, React, and SQLite.

## Features

- 🛒 **POS/Checkout** - Real-time product search, barcode scanning, multiple payment methods
- 📦 **Product Management** - Full CRUD, categories, SKU/barcode support
- 📊 **Inventory** - Stock tracking, low stock alerts, adjustment history
- 👥 **Customers** - Customer database, loyalty points, purchase history
- 👨‍💼 **Employees** - Role-based access (Admin, Manager, Cashier), PIN login
- 📈 **Reports** - Sales analytics, charts, export options
- ⚙️ **Settings** - Business info, tax configuration, receipt customization

## Tech Stack

- **Electron** - Cross-platform desktop app
- **React 18** + **Vite** - Fast, modern frontend
- **Tailwind CSS** - Utility-first styling
- **better-sqlite3** - Fast SQLite for Electron
- **Zustand** - Lightweight state management
- **Recharts** - Data visualization
- **Lucide React** - Beautiful icons

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run electron:build
```

### Default Login

- **Default Admin PIN**: `1234`

## Project Structure

```
├── electron/           # Electron main process
│   ├── main.js        # Main process entry
│   ├── preload.js     # IPC bridge
│   └── database/      # SQLite initialization
├── src/               # React frontend
│   ├── components/    # UI components
│   ├── pages/         # Page components
│   ├── stores/        # Zustand stores
│   └── lib/           # Utilities
├── package.json
└── vite.config.js
```

## License

© afus
