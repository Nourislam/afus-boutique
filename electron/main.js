console.log('=== MAIN.JS LOADED ===');
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase, runQuery, runInsert, runTransaction, getOne, addDatabaseChangeListener } = require('./database/init');
const dbApi = require('./database/api');
const catalog = require('./services/catalogService');
const dashboard = require('./services/dashboardService');
const i18n = require('./i18n');
const { v4: uuid } = require('uuid');
const { getImagesDir } = require('./services/imageService');
const ReceiptService = require('./services/receiptService');
const ShiftService = require('./services/shiftService');
const printDocument = require('./services/printDocument');
const SyncManager = require('./sync/SyncManager');
const EcommerceSyncManager = require('./ecommerce/EcommerceSyncManager');
const GeminiManager = require('./ai/GeminiManager');

const receiptService = new ReceiptService();
const shiftService = new ShiftService();

function logSystemAction(actionType, description, details = null, employeeId = null) {
  try {
    runInsert(`
      INSERT INTO system_logs (id, action_type, description, details, employee_id)
      VALUES (?, ?, ?, ?, ?)
    `, [uuid(), actionType, description, details ? JSON.stringify(details) : null, employeeId]);
  } catch (error) {
    console.error('Failed to write system log:', error);
  }
}

// Read one JSON-encoded value from the settings table
function getSettingValue(key) {
  const row = getOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

// All settings with store_config merged in at top level (the shape the
// receipt/label templates expect)
// Text for native dialogs in the shop's language
function shopT(key, params) {
  let lang;
  try { lang = getStoreSettings().defaultLanguage; } catch { lang = undefined; }
  return i18n.translate(i18n.normalizeLanguage(lang), key, params);
}

function getStoreSettings() {
  const settings = {};
  runQuery('SELECT key, value FROM settings').forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  });
  Object.assign(settings, settings.store_config || {});
  return settings;
}

let mainWindow;

// Window colours per theme (title bar buttons on Windows, background while loading)
const WINDOW_THEME = {
  dark: { background: '#0b0b0d', bar: '#131316', symbols: '#a1a1aa' },
  light: { background: '#f3f4f7', bar: '#ffffff', symbols: '#52525b' },
};
const themeFile = () => path.join(app.getPath('userData'), 'ui-theme.json');

function savedWindowTheme() {
  try {
    const saved = JSON.parse(fs.readFileSync(themeFile(), 'utf8'));
    return saved.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function createWindow() {
  const colors = WINDOW_THEME[savedWindowTheme()];
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    // Native window buttons on every system, drawn over our own title bar:
    // macOS keeps its traffic lights, Windows/Linux get the standard
    // minimise / maximise / close buttons. No duplicated buttons.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: colors.bar, symbolColor: colors.symbols, height: 40 } }),
    backgroundColor: colors.background,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // public/ is copied into dist/ by Vite; only dist/ is packaged
    icon: path.join(__dirname, app.isPackaged ? '../dist/icon.ico' : '../public/icon.ico')
  });

  // Links with target="_blank" open in the user's browser, never inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app. Only the packaged state decides: an installed copy always
  // loads its bundled files, even if NODE_ENV is set on the customer's PC.
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    SyncManager.setWindow(null);
  });

  SyncManager.setWindow(mainWindow);
}


// ------------------------------------------------------------------
// Data folder
// ------------------------------------------------------------------
// The database and images live in a fixed folder under %APPDATA% so that
// renaming the application never "loses" a shop's data. Installations made
// under the previous product name are copied (not moved) on first start.
const DATA_DIR_NAME = 'StorePOS';
const LEGACY_DATA_DIR_NAMES = ['pos-by-cirvex', 'Cirvex One', 'POS by Cirvex'];

function configureDataDirectory() {
  const appData = app.getPath('appData');
  const target = path.join(appData, DATA_DIR_NAME);
  const targetDb = path.join(target, 'pos-database.sqlite');

  if (!fs.existsSync(targetDb)) {
    for (const name of LEGACY_DATA_DIR_NAMES) {
      const legacyDir = path.join(appData, name);
      const legacyDb = path.join(legacyDir, 'pos-database.sqlite');
      if (!fs.existsSync(legacyDb)) continue;
      try {
        fs.mkdirSync(target, { recursive: true });
        fs.copyFileSync(legacyDb, targetDb);
        const legacyImages = path.join(legacyDir, 'images');
        if (fs.existsSync(legacyImages)) {
          fs.cpSync(legacyImages, path.join(target, 'images'), { recursive: true, force: false });
        }
        console.log(`Copied existing shop data from ${legacyDir} to ${target}`);
      } catch (error) {
        console.error('Failed to copy existing data folder:', error);
      }
      break;
    }
  }

  app.setPath('userData', target);
}

configureDataDirectory();

// Register scheme as privileged
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
]);

// Request single instance lock - prevents multiple app instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // A second launch (e.g. double-clicking the shortcut again) focuses the running window
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App lifecycle
  app.whenReady().then(async () => {
    printDocument.cleanTempFiles();
    // Initialize database. If it cannot be opened, tell the user instead of
    // hanging without a window.
    try {
      await initDatabase();
    } catch (error) {
      console.error('Database initialization failed:', error);
      // The shop's language is not known yet: show the message in the three languages
      const lines = ['ar', 'fr', 'en'].map(l => `${i18n.translate(l, 'dialog.dbFailed')}\n${i18n.translate(l, 'dialog.dataFolder')}: ${app.getPath('userData')}`);
      dialog.showErrorBox(i18n.translate('fr', 'dialog.startFailed', { app: 'afus boutique' }),
        `${lines.join('\n\n')}\n\n${error.message}`);
      app.quit();
      return;
    }

    // Initialize the (optional, currently disabled) sync boundary
    await SyncManager.init();

    // Initialize E-commerce Sync Manager
    EcommerceSyncManager.init(null, null); // Will set mainWindow after createWindow()
    
    // Initialize AI Manager
    await GeminiManager.init();

  // Register app protocol for serving images
  protocol.registerFileProtocol('app', (request, callback) => {
    let url = request.url.substr(6); // Remove 'app://'
    // Remove trailing slashes
    url = url.replace(/\/+$/, '');
    // Decode URL to handle spaces and special characters
    const decodedUrl = decodeURI(url);
    const imagesDir = getImagesDir();
    const filePath = path.join(imagesDir, decodedUrl);
    console.log('App protocol request:', request.url, '-> File:', filePath);
    callback({ path: filePath });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  });
}

// App lifecycle


// Register Global DB Change Listener for Auto-Sync
addDatabaseChangeListener(() => {
  // Debounce or just trigger
  // SyncManager handles its own "isSyncing" lock so calling frequently is safe
  SyncManager.triggerSync();
});

// ==========================================
// Cloud Sync IPC (REALTIME)
// ==========================================
ipcMain.handle('sync:trigger', async () => {
  if (SyncManager) {
    SyncManager.triggerSync();
    return true;
  }
  return false;
});

ipcMain.handle('sync:incoming', async (_, data) => {
  await SyncManager.handleIncoming(data);
});

ipcMain.handle('sync:ack', async (_, data) => {
  await SyncManager.handleAck(data);
});

// Batch ACK (optimized)
ipcMain.handle('sync:batch-ack', async (_, data) => {
  await SyncManager.handleBatchAck(data);
});

// Batch incoming (optimized)
ipcMain.handle('sync:incoming-batch', async (_, data) => {
  await SyncManager.handleIncomingBatch(data);
});

// Online/offline status
ipcMain.handle('sync:set-online', async (_, isOnline) => {
  SyncManager.setOnlineStatus(isOnline);
  return true;
});

// Get sync status
ipcMain.handle('sync:get-status', async () => {
  return SyncManager.getStatus();
});

ipcMain.handle('sync:set-token', async () => {
  // No-op in Realtime mode
  return true;
});

ipcMain.handle('sync:force-push', async () => {
  const tables = [
    'products', 'customers', 'sales', 'employees', 'inventory_logs',
    'gift_cards', 'bundles', 'promotions',
    'categories', 'suppliers', 'purchase_orders', 'receivings', 'supplier_invoices',
    'sale_items', 'purchase_order_items', 'receiving_items',
    'credit_sales', 'credit_payments',
    'quotations', 'quotation_items',
    'returns', 'return_items', 'supplier_payments'
  ];

  // Reset is_synced to 0 for all records to force a re-upload
  for (const table of tables) {
    try {
      runInsert(`UPDATE ${table} SET is_synced = 0`);
    } catch (e) {
      console.error(`Failed to reset sync status for ${table}`, e);
    }
  }

  SyncManager.forceSyncNow();
  return true;
});

// ==========================================
// AI / Gemini IPC
// ==========================================

ipcMain.handle('ai:get-insights', async (_, salesData) => {
  return await GeminiManager.generateInsights(salesData);
});

ipcMain.handle('ai:update-config', async (_, config) => {
  await GeminiManager.updateConfig(config);
  return true;
});

ipcMain.on('ai:chat-stream', async (event, { history, message, model, images }) => {
  try {
    await GeminiManager.chatStream(history, message, (chunk) => {
      event.sender.send('ai:chat-chunk', chunk);
    }, { model, images });
    event.sender.send('ai:chat-complete');
  } catch (error) {
    console.error('AI Chat Error:', error);
    event.sender.send('ai:chat-error', error.message);
  }
});

// Supabase API Proxy







app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Window controls IPC
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

// Shell (for opening external URLs)
ipcMain.handle('shell:openExternal', async (_, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return { success: false, error: error.message };
  }
});

// Shifts
ipcMain.handle('db:shifts:start', (_, { employeeId, openingCash, notes }) => {
  const shift = shiftService.startShift(employeeId, openingCash, notes);
  logSystemAction('shift_start', `Shift Started`, { shiftId: shift.id, openingCash }, employeeId);
  return shift;
});

ipcMain.handle('db:shifts:end', (_, { shiftId, closingCash, notes, closedBy }) => {
  const expected = shiftService.getShiftStats(shiftId).expected_cash;
  const shift = shiftService.endShift(shiftId, closingCash, notes);
  logSystemAction('shift_end', `Shift Ended`, { shiftId: shift.id, closingCash, expectedCash: expected, closedBy: closedBy || shift.employee_id }, closedBy || shift.employee_id);
  return shift;
});

ipcMain.handle('db:shifts:getOpen', () => shiftService.getOpenShifts());

ipcMain.handle('db:shifts:getLastClosed', () => shiftService.getLastClosedShift());

ipcMain.handle('db:shifts:getActivity', (_, { startDate, endDate }) => shiftService.getEmployeeActivity(startDate, endDate));

ipcMain.handle('db:shifts:getCurrent', (_, employeeId) => {
  return shiftService.getCurrentShift(employeeId);
});

ipcMain.handle('db:shifts:getStats', (_, shiftId) => {
  return shiftService.getShiftStats(shiftId);
});

ipcMain.handle('db:shifts:getHistory', (_, { startDate, endDate }) => shiftService.getShiftHistory(startDate, endDate));

// Categories
ipcMain.handle('db:categories:getAll', () => {
  return runQuery(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.is_active = 1 AND p.category_id = c.id) AS product_count
    FROM categories c
    ORDER BY c.name
  `);
});

// ==========================================
// BACKUP & RESTORE
// ==========================================
ipcMain.handle('backup:create', async () => {
  const dbPath = path.join(app.getPath('userData'), 'pos-database.sqlite');

  const { filePath } = await dialog.showSaveDialog({
    title: shopT('dialog.exportBackup'),
    defaultPath: `hanout-backup-${new Date().toISOString().split('T')[0]}.sqlite`,
    filters: [{ name: shopT('dialog.backupFiles'), extensions: ['sqlite'] }]
  });

  if (filePath) {
    try {
      fs.copyFileSync(dbPath, filePath);
      return { success: true, path: filePath };
    } catch (error) {
      console.error('Backup failed:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, canceled: true };
});

ipcMain.handle('backup:restore', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: shopT('dialog.importBackup'),
    filters: [{ name: shopT('dialog.backupFiles'), extensions: ['sqlite'] }],
    properties: ['openFile']
  });

  if (filePaths && filePaths.length > 0) {
    const backupPath = filePaths[0];
    const dbPath = path.join(app.getPath('userData'), 'pos-database.sqlite');

    try {
      fs.copyFileSync(backupPath, dbPath);
      await initDatabase();
      return { success: true };
    } catch (error) {
      console.error('Restore failed:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, canceled: true };
});

ipcMain.handle('backup:reset', async () => {
  const dbPath = path.join(app.getPath('userData'), 'pos-database.sqlite');
  try {
    if (fs.existsSync(dbPath)) {
      // Keep a copy so an accidental reset can still be recovered
      const safetyCopy = `${dbPath}.before-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(dbPath, safetyCopy);
      console.log('Database copied before reset:', safetyCopy);
      fs.unlinkSync(dbPath);
    }
    await initDatabase();
    return { success: true };
  } catch (error) {
    console.error('Reset failed:', error);
    return { success: false, error: error.message };
  }
});

// Light / dark theme chosen in Settings
ipcMain.handle('app:setTheme', (_, { theme, preference } = {}) => {
  const value = theme === 'light' ? 'light' : 'dark';
  const colors = WINDOW_THEME[value];
  nativeTheme.themeSource = preference === 'system' ? 'system' : value;
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(colors.background);
    if (process.platform !== 'darwin' && typeof win.setTitleBarOverlay === 'function') {
      try { win.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.symbols, height: 40 }); } catch { /* no overlay on this window */ }
    }
  }
  try { fs.writeFileSync(themeFile(), JSON.stringify({ theme: value, preference })); } catch { /* only the start-up colour */ }
  return true;
});

ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  dataPath: app.getPath('userData'),
  databasePath: path.join(app.getPath('userData'), 'pos-database.sqlite'),
  platform: process.platform,
  electron: process.versions.electron,
}));

// ------------------------------------------------------------------
// Brands (list used to pick a brand quickly when entering products)
// ------------------------------------------------------------------
ipcMain.handle('db:brands:getAll', () => {
  return runQuery(`
    SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.is_active = 1 AND LOWER(TRIM(p.brand)) = LOWER(b.name)) AS product_count
    FROM brands b
    ORDER BY b.is_active DESC, b.name COLLATE NOCASE
  `);
});

ipcMain.handle('db:brands:create', (_, { name }) => {
  const clean = String(name || '').trim();
  if (!clean) throw catalog.codedError('BRAND_NAME_REQUIRED');
  const existing = getOne('SELECT * FROM brands WHERE name = ? COLLATE NOCASE', [clean]);
  if (existing) {
    if (!existing.is_active) dbApi.run('UPDATE brands SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
    return { ...existing, is_active: 1 };
  }
  const id = uuid();
  dbApi.run('INSERT INTO brands (id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM brands))', [id, clean]);
  return getOne('SELECT * FROM brands WHERE id = ?', [id]);
});

// Renaming a brand also renames it on the products that use it
ipcMain.handle('db:brands:update', (_, { id, name, is_active }) => {
  const brand = getOne('SELECT * FROM brands WHERE id = ?', [id]);
  if (!brand) throw catalog.codedError('BRAND_NOT_FOUND');
  const clean = String(name ?? brand.name).trim();
  if (!clean) throw catalog.codedError('BRAND_NAME_REQUIRED');
  const clash = getOne('SELECT id FROM brands WHERE name = ? COLLATE NOCASE AND id <> ?', [clean, id]);
  if (clash) throw catalog.codedError('BRAND_EXISTS');
  runTransaction(() => {
    dbApi.run('UPDATE brands SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?',
      [clean, is_active === undefined ? brand.is_active : (is_active ? 1 : 0), id]);
    if (clean !== brand.name) {
      dbApi.run('UPDATE products SET brand = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE LOWER(TRIM(brand)) = LOWER(?)', [clean, brand.name]);
    }
  });
  return getOne('SELECT * FROM brands WHERE id = ?', [id]);
});

// Removing a brand from the list does not change existing products
ipcMain.handle('db:brands:delete', (_, id) => {
  dbApi.run('DELETE FROM brands WHERE id = ?', [id]);
  return true;
});

ipcMain.handle('db:categories:create', (_, category) => {
  dbApi.run('INSERT INTO categories (id, name, color, icon, is_synced) VALUES (?, ?, ?, ?, 0)',
    [category.id || uuid(), category.name, category.color ?? null, category.icon ?? null]);
  SyncManager.triggerSync();
  return category;
});

ipcMain.handle('db:categories:update', (_, category) => {
  dbApi.run('UPDATE categories SET name = ?, color = ?, icon = COALESCE(?, icon), updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?',
    [category.name, category.color ?? null, category.icon ?? null, category.id]);
  SyncManager.triggerSync();
  return category;
});

// Deleting a category keeps its products; they simply become uncategorised
ipcMain.handle('db:categories:delete', (_, id) => {
  runTransaction(() => {
    dbApi.run('UPDATE products SET category_id = NULL, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE category_id = ?', [id]);
    dbApi.run('DELETE FROM categories WHERE id = ?', [id]);
  });
  return true;
});

// Products
const PRODUCT_LIST_COLUMNS = `
    p.*, c.name as category_name, c.color as category_color,
    (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
    (SELECT MIN(COALESCE(v.price, p.price)) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS min_variant_price,
    (SELECT MAX(COALESCE(v.price, p.price)) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS max_variant_price,
    (SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(v.color_code, ''), v.color)) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active = 1 AND v.color IS NOT NULL AND v.color <> '') AS variant_colors,
    (SELECT GROUP_CONCAT(DISTINCT v.size) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active = 1 AND v.stock_quantity > 0 AND v.size IS NOT NULL AND v.size <> '') AS sizes_in_stock
`;

ipcMain.handle('db:products:getAll', () => {
  return runQuery(`
    SELECT ${PRODUCT_LIST_COLUMNS}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
    ORDER BY p.name
  `);
});

ipcMain.handle('db:products:getById', (_, id) => {
  const product = getOne(`
    SELECT ${PRODUCT_LIST_COLUMNS}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `, [id]);
  if (!product) return null;
  return { ...product, variants: catalog.getVariants(dbApi, id) };
});

// ------------------------------------------------------------------
// Product variants, identifiers and code lookup (clothing catalog)
// ------------------------------------------------------------------
ipcMain.handle('catalog:getVariants', (_, { productId, includeInactive = false }) => {
  return catalog.getVariants(dbApi, productId, { includeInactive });
});

ipcMain.handle('catalog:saveProduct', (_, { product, variants, employeeId, isNew }) => {
  const result = catalog.saveProduct(dbApi, product, variants || [], { employeeId, isNew: !!isNew });
  logSystemAction(isNew ? 'create' : 'update', `${isNew ? 'Created' : 'Updated'} product: ${product.name}`,
    { id: product.id, variants: (variants || []).length }, employeeId || null);
  SyncManager.triggerSync();
  return result;
});

ipcMain.handle('catalog:generateSkus', (_, { product, variants, reserved }) => {
  return catalog.generateSkus(dbApi, product, variants, getSettingValue('sku_settings') || {}, new Set(reserved || []));
});

ipcMain.handle('catalog:generateBarcodes', (_, { count = 1, reserved = [] } = {}) => {
  return catalog.generateInternalBarcodes(dbApi, Math.min(Math.max(parseInt(count, 10) || 1, 1), 500), new Set(reserved));
});

ipcMain.handle('catalog:generateFreeCodes', (_, { type = 'ean13', count = 1, reserved = [] } = {}) => {
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 500);
  return dbApi.transaction(() => catalog.generateFreeCodes(dbApi, { type, count: n, reserved }));
});

// Which of these codes are already used by an article, a variant or a gift card
ipcMain.handle('catalog:findUsedCodes', (_, codes = []) => {
  return (codes || []).slice(0, 1000).filter(code => code && catalog.isCodeUsed(dbApi, code));
});

ipcMain.handle('catalog:checkIdentifier', (_, { code, excludeVariantId, excludeProductId }) => {
  const formatError = catalog.validateIdentifier(code, 'code');
  if (formatError) return { valid: false, message: formatError };
  const owner = catalog.findIdentifierOwner(dbApi, code, { excludeVariantId, excludeProductId });
  return owner
    ? { valid: false, message: catalog.coded('ID_TAKEN', { field: 'code', value: String(code).toUpperCase(), owner: catalog.describeOwner(owner) }), owner }
    : { valid: true };
});

ipcMain.handle('catalog:missingCodes', () => {
  const layout = getLabelSettings();
  return catalog.findMissingCodes(dbApi, { scope: layout.codeScope, codeType: layout.codeType });
});

ipcMain.handle('catalog:lookupCode', (_, code) => {
  // With one code per article, scanning sells a piece without asking colour/size
  return catalog.lookupCode(dbApi, code, { articleScope: getLabelSettings().codeScope === 'article' });
});

ipcMain.handle('catalog:searchVariants', (_, { query, limit }) => {
  return catalog.searchVariants(dbApi, query, limit);
});

ipcMain.handle('catalog:regenerateQr', (_, variantId) => {
  const variant = catalog.regenerateQrCode(dbApi, variantId);
  SyncManager.triggerSync();
  return variant;
});

ipcMain.handle('db:products:search', (_, query) => {
  const searchTerm = `%${query}%`;
  return runQuery(`
    SELECT p.*, c.name as category_name, c.color as category_color 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?
    ORDER BY p.name
  `, [searchTerm, searchTerm, searchTerm]);
});

ipcMain.handle('db:products:getByBarcode', (_, barcode) => {
  return getOne(`
    SELECT p.*, c.name as category_name, c.color as category_color 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.barcode = ?
  `, [barcode]);
});

ipcMain.handle('db:products:getByCategory', (_, categoryId) => {
  return runQuery(`
    SELECT p.*, c.name as category_name, c.color as category_color 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.category_id = ?
    ORDER BY p.name
  `, [categoryId]);
});

// Simple (non-variant) product create/update, e.g. from the Excel import.
// Both go through the catalog service so identifiers are checked for
// duplicates and stock changes are written to inventory_logs.
ipcMain.handle('db:products:create', (_, product) => {
  const { product: saved } = catalog.saveProduct(dbApi, product, product.variants || [], { isNew: true });
  logSystemAction('create', `Created product: ${product.name}`, { id: product.id, sku: product.sku });
  SyncManager.triggerSync();
  return saved;
});

ipcMain.handle('db:products:update', (_, product) => {
  // Callers that do not send variants must not wipe a product's variants
  let variants = product.variants;
  if (variants === undefined) {
    const current = getOne('SELECT has_variants FROM products WHERE id = ?', [product.id]);
    variants = current && current.has_variants ? catalog.getVariants(dbApi, product.id) : [];
  }
  const { product: saved } = catalog.saveProduct(dbApi, product, variants);
  logSystemAction('update', `Updated product: ${product.name}`, { id: product.id });
  SyncManager.triggerSync();
  return saved;
});

ipcMain.handle('db:products:delete', (_, id) => {
  runInsert('UPDATE products SET is_active = 0, is_synced = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  logSystemAction('delete', `Deleted product (set inactive)`, { id });
  SyncManager.triggerSync();
  return true;
});

ipcMain.handle('db:products:updateStock', (_, { id, variantId, quantity, type, reason, employeeId }) => {
  const qty = Math.abs(parseInt(quantity, 10) || 0);
  const result = runTransaction(() => catalog.adjustStock(dbApi, {
    productId: id,
    variantId: variantId || null,
    delta: type === 'add' ? qty : -qty,
    type,
    reason,
    employeeId,
  }));

  SyncManager.triggerSync();
  return { id, variant_id: result.variantId, stock_quantity: result.after };
});

// Customers
ipcMain.handle('db:customers:getAll', () => {
  return runQuery('SELECT * FROM customers WHERE is_active = 1 ORDER BY name');
});

ipcMain.handle('db:customers:getById', (_, id) => {
  return getOne('SELECT * FROM customers WHERE id = ?', [id]);
});

ipcMain.handle('db:customers:search', (_, query) => {
  const searchTerm = `%${query}%`;
  return runQuery('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name',
    [searchTerm, searchTerm, searchTerm]);
});

ipcMain.handle('db:customers:create', (_, customer) => {
  runInsert(`
    INSERT INTO customers (id, name, email, phone, address, loyalty_points, notes, credit_enabled, credit_limit, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    customer.id,
    customer.name,
    customer.email,
    customer.phone,
    customer.address,
    customer.loyalty_points || 0,
    customer.notes,
    customer.credit_enabled ? 1 : 0,
    customer.credit_limit || 0
  ]);
  SyncManager.triggerSync();
  return customer;
});

ipcMain.handle('db:customers:update', (_, customer) => {
  runInsert(`
    UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, loyalty_points = ?, notes = ?, credit_enabled = ?, credit_limit = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0
    WHERE id = ?
  `, [
    customer.name,
    customer.email,
    customer.phone,
    customer.address,
    customer.loyalty_points,
    customer.notes,
    customer.credit_enabled ? 1 : 0,
    customer.credit_limit || 0,
    customer.id
  ]);
  logSystemAction('update', `Updated Customer: ${customer.name}`, { id: customer.id });
  SyncManager.triggerSync();
  return customer;
});

ipcMain.handle('db:customers:delete', (_, id) => {
  runInsert('UPDATE customers SET is_active = 0, is_synced = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  SyncManager.triggerSync();
  return true;
});

// Employees
ipcMain.handle('db:employees:getAll', () => {
  return runQuery('SELECT id, name, email, role, is_active, avatar_path, created_at FROM employees WHERE is_active = 1 ORDER BY name');
});

ipcMain.handle('db:employees:getById', (_, id) => {
  return getOne('SELECT id, name, email, role, is_active, avatar_path, created_at FROM employees WHERE id = ?', [id]);
});

ipcMain.handle('db:employees:verifyPin', (_, { id, pin }) => {
  const employee = getOne('SELECT * FROM employees WHERE id = ? AND pin = ? AND is_active = 1', [id, pin]);
  if (employee) {
    logSystemAction('login', `Employee Login: ${employee.name}`, null, employee.id);
    return { id: employee.id, name: employee.name, role: employee.role };
  }
  return null;
});

ipcMain.handle('db:employees:create', (_, employee) => {
  runInsert(`
    INSERT INTO employees (id, name, email, pin, role, is_active, avatar_path, is_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    employee.id,
    employee.name,
    employee.email || null,
    employee.pin,
    employee.role,
    employee.is_active ? 1 : 0,
    employee.avatar_path || null
  ]);
  SyncManager.triggerSync();
  return { ...employee, pin: undefined };
});

ipcMain.handle('db:employees:update', (_, employee) => {
  if (employee.pin) {
    runInsert(`
      UPDATE employees SET name = ?, email = ?, pin = ?, role = ?, is_active = ?, avatar_path = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0
      WHERE id = ?
    `, [
      employee.name,
      employee.email || null,
      employee.pin,
      employee.role,
      employee.is_active ? 1 : 0,
      employee.avatar_path || null,
      employee.id
    ]);
  } else {
    runInsert(`
      UPDATE employees SET name = ?, email = ?, role = ?, is_active = ?, avatar_path = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0
      WHERE id = ?
    `, [
      employee.name,
      employee.email || null,
      employee.role,
      employee.is_active ? 1 : 0,
      employee.avatar_path || null,
      employee.id
    ]);
  }
  SyncManager.triggerSync();
  return { ...employee, pin: undefined };
});

ipcMain.handle('db:employees:delete', (_, id) => {
  runInsert('UPDATE employees SET is_active = 0, is_synced = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  SyncManager.triggerSync();
  return true;
});

// Sales
ipcMain.handle('db:sales:create', (_, sale) => {
  // The whole sale (header, lines, stock movements, payments, gift card
  // redemptions) is written in one transaction: if anything fails - e.g. a
  // gift card without enough balance or a variant that no longer exists -
  // nothing is saved and stock is left untouched.
  runTransaction(() => {
    runInsert(`
      INSERT INTO sales (id, receipt_number, employee_id, customer_id, subtotal, tax_amount, discount_amount, total, status, notes, service_charge, tax_exempt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sale.id, sale.receipt_number, sale.employee_id ?? null, sale.customer_id ?? null,
    sale.subtotal ?? 0, sale.tax_amount ?? 0, sale.discount_amount ?? 0, sale.total ?? 0, sale.status || 'completed', sale.notes ?? null,
    sale.service_charge || 0, sale.tax_exempt ? 1 : 0]);

    for (const item of sale.items) {
      const product = getOne('SELECT id, cost, has_variants FROM products WHERE id = ?', [item.product_id]);
      const variant = item.variant_id
        ? getOne('SELECT * FROM product_variants WHERE id = ?', [item.variant_id])
        : null;
      if (item.variant_id && !variant) {
        throw catalog.codedError('VARIANT_GONE', { product: item.product_name });
      }
      if (product && product.has_variants && !variant) {
        throw catalog.codedError('VARIANT_REQUIRED', { product: item.product_name });
      }

      // Cost snapshot for profit reports: variant cost if set, else product cost
      let unitCost = 0;
      if (variant && variant.cost !== null && variant.cost !== undefined) unitCost = variant.cost;
      else if (product) unitCost = product.cost || 0;

      runInsert(`
        INSERT INTO sale_items (id, sale_id, product_id, variant_id, variant_label, sku, product_name, quantity, unit_price, discount, tax_amount, total, unit_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [item.id, sale.id, item.product_id, variant ? variant.id : null,
      variant ? catalog.variantLabel(variant) : (item.variant_label || null),
      variant ? variant.sku : (item.sku || null),
      item.product_name, item.quantity, item.unit_price, item.discount || 0, item.tax_amount || 0, item.total, unitCost]);

      if (product) {
        // Regular product or one variant of it
        catalog.adjustStock(dbApi, {
          productId: item.product_id,
          variantId: variant ? variant.id : null,
          delta: -item.quantity,
          type: 'sale',
          reason: `Sale #${sale.receipt_number}`,
          employeeId: sale.employee_id || null,
        });
        continue;
      }

      // Not a product: check if it's a bundle
      const bundle = getOne('SELECT * FROM bundles WHERE id = ?', [item.product_id]);
      if (bundle && bundle.deduct_component_stock === 1) {
        const bundleItems = runQuery('SELECT * FROM bundle_items WHERE bundle_id = ?', [bundle.id]);
        for (const bItem of bundleItems) {
          catalog.adjustStock(dbApi, {
            productId: bItem.product_id,
            delta: -(bItem.quantity * item.quantity),
            type: 'sale_bundle',
            reason: `Bundle Sale: ${bundle.name} (Sale #${sale.receipt_number})`,
            employeeId: sale.employee_id || null,
          });
        }
      } else if (bundle) {
        // Deduct stock from bundle itself (Pre-packed)
        runInsert('UPDATE bundles SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, bundle.id]);
      }
    }

    for (const payment of sale.payments || []) {
      runInsert(`
        INSERT INTO payments (id, sale_id, method, amount, reference)
        VALUES (?, ?, ?, ?, ?)
      `, [payment.id, sale.id, payment.method, payment.amount, payment.reference ?? null]);

      // Handle Gift Card Redemption
      if (payment.method === 'gift_card') {
        const code = payment.reference; // Reference holds the gift card code
        const amount = payment.amount;

        const card = getOne('SELECT * FROM gift_cards WHERE code = ?', [code]);
        if (!card) throw catalog.codedError('GIFT_CARD_NOT_FOUND', { code });
        const newBalance = card.current_balance - amount;
        if (newBalance < 0) throw catalog.codedError('GIFT_CARD_BALANCE', { code });

        runInsert('UPDATE gift_cards SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newBalance, card.id]);

        // Update payment reference with balance info for receipt
        const refData = JSON.stringify({ code: code, remaining: newBalance });
        runInsert('UPDATE payments SET reference = ? WHERE id = ?', [refData, payment.id]);
        payment.reference = refData;

        // Log transaction
        runInsert(`
          INSERT INTO gift_card_transactions (id, gift_card_id, sale_id, amount, type, balance_before, balance_after, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [uuid(), card.id, sale.id, amount, 'redeem', card.current_balance, newBalance]);
      }
    }

    // Loyalty: 1 point per 100 DA, and the customer's total spent. Done here,
    // in the same transaction, so the customer record is never overwritten.
    if (sale.customer_id) {
      runInsert(`
        UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ?, total_spent = COALESCE(total_spent, 0) + ?,
          updated_at = CURRENT_TIMESTAMP, is_synced = 0
        WHERE id = ?
      `, [Math.floor((Number(sale.total) || 0) / 100), Number(sale.total) || 0, sale.customer_id]);
    }

    // Promotion used by this sale
    if (sale.promotion_id) {
      runInsert('UPDATE promotions SET current_uses = COALESCE(current_uses, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sale.promotion_id]);
    }
  });

  logSystemAction('create', `New Sale #${sale.receipt_number}`, { id: sale.id, total: sale.total }, sale.employee_id);
  SyncManager.triggerSync();

  // Return the sale with the variant snapshots the receipt needs
  const items = runQuery('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
  return { ...sale, items: sale.items.map(i => ({ ...i, ...(items.find(r => r.id === i.id) || {}) })) };
});

ipcMain.handle('db:sales:getAll', (_, params = {}) => {
  let query = `
    SELECT s.*, e.name as employee_name, c.name as customer_name
    FROM sales s
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE 1=1
  `;
  const queryParams = [];

  if (params?.startDate && params?.endDate) {
    query += ' AND s.created_at BETWEEN ? AND ?';
    queryParams.push(params.startDate, params.endDate);
  }

  if (params?.employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(params.employeeId);
  }

  query += ' ORDER BY s.created_at DESC';

  // Limit if no date range to avoid fetching everything
  if (!params?.startDate) {
    query += ' LIMIT 100';
  }

  return runQuery(query, queryParams);
});

ipcMain.handle('db:sales:getById', (_, id) => {
  const sale = getOne(`
    SELECT s.*, e.name as employee_name, c.name as customer_name
    FROM sales s
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `, [id]);

  if (sale) {
    sale.items = runQuery('SELECT * FROM sale_items WHERE sale_id = ?', [id]);
    sale.payments = runQuery('SELECT * FROM payments WHERE sale_id = ?', [id]);
  }

  return sale;
});

ipcMain.handle('db:sales:getToday', (_, params = {}) => {
  // "Today" in the shop's local time (timestamps are stored in UTC)
  let query = `
    SELECT s.*, e.name as employee_name
    FROM sales s
    LEFT JOIN employees e ON s.employee_id = e.id
    WHERE date(s.created_at, 'localtime') = date('now', 'localtime')
  `;
  const queryParams = [];

  if (params?.employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(params.employeeId);
  }

  query += ' ORDER BY s.created_at DESC';
  return runQuery(query, queryParams);
});

ipcMain.handle('db:sales:getStats', (_, { startDate, endDate, employeeId }) => {
  // Profit = what the customer paid (after every discount, without TVA) minus
  // the purchase cost of the pieces; returns are taken off both.
  const emp = employeeId ? ' AND s.employee_id = ?' : '';
  const params = employeeId ? [startDate, endDate, employeeId] : [startDate, endDate];
  const sales = getOne(`
    SELECT
      COUNT(s.id) AS total_transactions,
      COALESCE(SUM(s.total), 0) AS total_revenue,
      COALESCE(AVG(s.total), 0) AS average_sale,
      COALESCE(SUM(s.tax_amount), 0) AS total_tax,
      COALESCE(SUM(s.discount_amount), 0) AS total_discount,
      COALESCE(SUM(c.cost), 0) AS total_cost,
      COALESCE(SUM(c.pieces), 0) AS items_sold
    FROM sales s
    LEFT JOIN (
      SELECT sale_id, SUM(COALESCE(unit_cost, 0) * quantity) AS cost, SUM(quantity) AS pieces
      FROM sale_items GROUP BY sale_id
    ) c ON c.sale_id = s.id
    WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)${emp}
  `, params) || {};
  const returns = getOne(`
    SELECT
      COUNT(DISTINCT r.id) AS count,
      COALESCE(SUM(r.total_refund), 0) AS refunds
    FROM returns r
    LEFT JOIN sales s ON s.id = r.sale_id
    WHERE datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)${employeeId ? ' AND r.employee_id = ?' : ''}
  `, params) || {};
  const returnedCost = getOne(`
    SELECT COALESCE(SUM(ri.quantity * COALESCE(si.unit_cost, 0)), 0) AS cost
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    LEFT JOIN sale_items si ON si.id = ri.sale_item_id
    WHERE datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)${employeeId ? ' AND r.employee_id = ?' : ''}
  `, params) || {};

  const revenue = sales.total_revenue || 0;
  const refunds = returns.refunds || 0;
  const netRevenue = revenue - refunds;
  const cost = (sales.total_cost || 0) - (returnedCost.cost || 0);
  const profit = (revenue - (sales.total_tax || 0)) - refunds - cost;
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    total_transactions: sales.total_transactions || 0,
    total_revenue: r2(revenue),
    average_sale: r2(sales.average_sale || 0),
    total_tax: r2(sales.total_tax || 0),
    total_discount: r2(sales.total_discount || 0),
    items_sold: sales.items_sold || 0,
    total_refunds: r2(refunds),
    refunds_count: returns.count || 0,
    net_revenue: r2(netRevenue),
    total_cost: r2(cost),
    total_profit: r2(profit),
    margin_percent: netRevenue > 0 ? r2((profit / netRevenue) * 100) : 0,
  };
});

// Held Transactions
ipcMain.handle('db:held:getAll', () => {
  return runQuery(`
    SELECT h.*, e.name as employee_name, c.name as customer_name
    FROM held_transactions h
    LEFT JOIN employees e ON h.employee_id = e.id
    LEFT JOIN customers c ON h.customer_id = c.id
    ORDER BY h.created_at DESC
  `);
});

ipcMain.handle('db:held:create', (_, held) => {
  runInsert(`
    INSERT INTO held_transactions (id, employee_id, customer_id, items_json, subtotal, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [held.id, held.employee_id, held.customer_id, JSON.stringify(held.items), held.subtotal, held.notes]);
  return held;
});

ipcMain.handle('db:held:delete', (_, id) => {
  runInsert('DELETE FROM held_transactions WHERE id = ?', [id]);
  return true;
});

// Settings
ipcMain.handle('db:settings:get', (_, key) => {
  const row = getOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? JSON.parse(row.value) : null;
});

ipcMain.handle('db:settings:set', (_, { key, value }) => {
  const jsonValue = JSON.stringify(value);
  const existing = getOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    runInsert('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [jsonValue, key]);
  } else {
    runInsert('INSERT INTO settings (key, value) VALUES (?, ?)', [key, jsonValue]);
  }
  return true;
});

ipcMain.handle('db:settings:delete', (_, key) => {
  runInsert('DELETE FROM settings WHERE key = ?', [key]);
  return true;
});

ipcMain.handle('db:settings:getAll', () => {
  const rows = runQuery('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(row => {
    settings[row.key] = JSON.parse(row.value);
  });
  return settings;
});

// Inventory Logs
ipcMain.handle('db:inventory:getLogs', (_, productId) => {
  const select = `
    SELECT il.*, p.name as product_name, e.name as employee_name,
           v.color as variant_color, v.size as variant_size, v.sku as variant_sku
    FROM inventory_logs il
    LEFT JOIN products p ON il.product_id = p.id
    LEFT JOIN product_variants v ON il.variant_id = v.id
    LEFT JOIN employees e ON il.employee_id = e.id
  `;
  if (productId) {
    return runQuery(`${select} WHERE il.product_id = ? ORDER BY il.created_at DESC`, [productId]);
  }
  return runQuery(`${select} ORDER BY il.created_at DESC LIMIT 100`);
});

// Low stock at the most specific level: one row per variant for clothing
// products, one row per product for simple products.
ipcMain.handle('db:inventory:getLowStock', () => {
  return catalog.getLowStock(dbApi);
});

// System Logs
ipcMain.handle('db:logs:getAll', (_, { startDate, endDate, type, limit = 100 } = {}) => {
  let query = `
    SELECT l.*, e.name as employee_name 
    FROM system_logs l
    LEFT JOIN employees e ON l.employee_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    query += ' AND l.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND l.created_at <= ?';
    params.push(endDate);
  }
  if (type && type !== 'all') {
    query += ' AND l.action_type = ?';
    params.push(type);
  }

  query += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(limit);

  return runQuery(query, params);
});

// Reports
ipcMain.handle('db:reports:salesByDate', (_, { startDate, endDate, employeeId }) => {
  let query = `
    SELECT 
      date(s.created_at, 'localtime') as date,
      COUNT(s.id) as transactions,
      SUM(s.total) as revenue,
      SUM(s.tax_amount) as tax,
      COALESCE(SUM(s.total - s.tax_amount - COALESCE(p.cost, 0)), 0) as profit
    FROM sales s
    LEFT JOIN (
        SELECT sale_id, SUM(COALESCE(unit_cost, 0) * quantity) as cost
        FROM sale_items
        GROUP BY sale_id
    ) p ON s.id = p.sale_id
    WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
  `;
  const queryParams = [startDate, endDate];

  if (employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(employeeId);
  }

  query += `
    GROUP BY date(s.created_at, 'localtime')
    ORDER BY date ASC
  `;

  return runQuery(query, queryParams);
});

// Clothing dashboard: best sizes/colours, stock value, low-stock variants
ipcMain.handle('db:reports:clothingDashboard', (_, range) => {
  return dashboard.getClothingDashboard(dbApi, range || {});
});

ipcMain.handle('db:reports:topProducts', (_, { startDate, endDate, limit = 10, employeeId }) => {
  let query = `
    SELECT 
      si.product_id,
      si.product_name,
      SUM(si.quantity) as total_quantity,
      SUM(si.total) as total_revenue
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
  `;
  const queryParams = [startDate, endDate];

  if (employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(employeeId);
  }

  query += `
    GROUP BY si.product_id
    ORDER BY total_quantity DESC
    LIMIT ?
  `;
  queryParams.push(limit);

  return runQuery(query, queryParams);
});

ipcMain.handle('db:reports:salesByCategory', (_, { startDate, endDate, employeeId }) => {
  let query = `
    SELECT 
      c.name as category_name,
      c.color as category_color,
      SUM(si.quantity) as total_quantity,
      SUM(si.total) as total_revenue
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
  `;
  const queryParams = [startDate, endDate];

  if (employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(employeeId);
  }

  query += `
    GROUP BY p.category_id
    ORDER BY total_revenue DESC
  `;

  return runQuery(query, queryParams);
});

ipcMain.handle('db:reports:paymentMethods', (_, { startDate, endDate, employeeId }) => {
  let query = `
    SELECT 
      p.method,
      COUNT(*) as count,
      SUM(p.amount) as total
    FROM payments p
    JOIN sales s ON p.sale_id = s.id
    WHERE datetime(s.created_at) BETWEEN datetime(?) AND datetime(?)
  `;
  const queryParams = [startDate, endDate];

  if (employeeId) {
    query += ' AND s.employee_id = ?';
    queryParams.push(employeeId);
  }

  query += ' GROUP BY p.method';

  return runQuery(query, queryParams);
});

// Generate receipt number
ipcMain.handle('db:generateReceiptNumber', () => {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const results = runQuery(`
    SELECT receipt_number FROM sales 
    WHERE receipt_number LIKE ?
    ORDER BY receipt_number DESC LIMIT 1
  `, [`${today}%`]);

  let sequence = 1;
  if (results.length > 0) {
    const lastSequence = parseInt(results[0].receipt_number.slice(-4));
    sequence = lastSequence + 1;
  }

  return `${today}${sequence.toString().padStart(4, '0')}`;
});

// ==========================================
// RETURNS
// ==========================================
ipcMain.handle('db:returns:getAll', (_, params = {}) => {
  let query = `
    SELECT r.*, e.name as employee_name, s.receipt_number
    FROM returns r
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN sales s ON r.sale_id = s.id
    WHERE 1=1
  `;
  const queryParams = [];

  if (params?.employeeId) {
    // If filtering by employee, we arguably want see returns PROCESSED by this employee 
    // OR returns of sales MADE by this employee.
    // Requirement says "History should each users transaction not all". 
    // Usually means "transactions I performed". 
    // For Returns, it's the person who processed the return.
    query += ' AND r.employee_id = ?';
    queryParams.push(params.employeeId);
  }

  query += ' ORDER BY r.created_at DESC';

  return runQuery(query, queryParams);
});

ipcMain.handle('db:returns:getItems', (_, returnId) => {
  return runQuery(`
    SELECT ri.*, p.name as product_name
    FROM return_items ri
    LEFT JOIN products p ON ri.product_id = p.id
    WHERE ri.return_id = ?
  `, [returnId]);
});

ipcMain.handle('db:returns:create', (_, returnData) => {
  // Insert the return record
  runInsert(`
    INSERT INTO returns (id, sale_id, return_number, total_refund, reason, employee_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [returnData.id, returnData.sale_id, returnData.return_number, returnData.total_refund, returnData.reason, returnData.employee_id]);

  // Insert return items and restock the exact variant that was sold
  runTransaction(() => {
    for (const item of returnData.items) {
      const saleItem = item.sale_item_id
        ? getOne('SELECT product_id, variant_id FROM sale_items WHERE id = ?', [item.sale_item_id])
        : null;
      const variantId = item.variant_id || (saleItem && saleItem.variant_id) || null;
      const productId = item.product_id || (saleItem && saleItem.product_id);

      runInsert(`
        INSERT INTO return_items (id, return_id, sale_item_id, product_id, variant_id, quantity, refund_amount, condition)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuid(), returnData.id, item.sale_item_id, productId, variantId, item.quantity, item.refund_amount, item.condition]);

      // Restock if sellable
      if (item.condition === 'sellable' && productId && getOne('SELECT id FROM products WHERE id = ?', [productId])) {
        catalog.adjustStock(dbApi, {
          productId,
          variantId,
          delta: item.quantity,
          type: 'return',
          reason: `Return: ${returnData.return_number}`,
          employeeId: returnData.employee_id || null,
        });
      }
    }
  });

  // Check if sale is fully or partially refunded
  const sale = getOne('SELECT total FROM sales WHERE id = ?', [returnData.sale_id]);
  const allReturns = runQuery('SELECT SUM(total_refund) as total_returned FROM returns WHERE sale_id = ?', [returnData.sale_id]);
  const totalReturned = allReturns[0]?.total_returned || 0;

  // Get original sale items total (before any discounts)
  const saleItems = runQuery('SELECT SUM(quantity * unit_price) as items_total FROM sale_items WHERE sale_id = ?', [returnData.sale_id]);
  const itemsTotal = saleItems[0]?.items_total || sale.total;

  // Determine status: fully refunded if total returned >= items total
  const newStatus = totalReturned >= itemsTotal ? 'refunded' : 'partially_refunded';

  runInsert('UPDATE sales SET status = ? WHERE id = ?', [newStatus, returnData.sale_id]);

  logSystemAction('return_processed', `Processed Return: ${returnData.return_number}`, { returnId: returnData.id, saleId: returnData.sale_id, amount: returnData.total_refund }, returnData.employee_id);

  return returnData;
});

// ================================================
// PHASE 2: ADVANCED FEATURES
// ================================================

const { saveImage, saveImageFromPath, deleteImage, getImageBase64 } = require('./services/imageService');
const { testEmailConnection, sendTestEmail, initEmailService } = require('./services/emailService');

// Image Service
ipcMain.handle('images:save', async (_, { base64Data, originalName }) => {
  return saveImage(base64Data, originalName);
});

ipcMain.handle('images:saveLogo', async (_, { base64Data, originalName }) => {
  return require('./services/imageService').saveLogo(base64Data, originalName);
});

ipcMain.handle('images:saveFromPath', async (_, sourcePath) => {
  return saveImageFromPath(sourcePath);
});

ipcMain.handle('images:delete', (_, fileName) => {
  return deleteImage(fileName);
});

ipcMain.handle('images:get', (_, fileName) => {
  return getImageBase64(fileName);
});

ipcMain.handle('images:getPath', (_, fileName) => {
  const { getImagePath } = require('./services/imageService');
  return getImagePath(fileName);
});

// File Dialog for selecting an image
ipcMain.handle('dialog:selectImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: shopT('dialog.selectSignature'),
    filters: [
      { name: shopT('dialog.imageFiles'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  // Save the image to app data
  const imageService = require('./services/imageService');
  const savedImage = await imageService.saveImageFromPath(result.filePaths[0]);
  return savedImage;
});

// Email Service
ipcMain.handle('email:testConnection', async (_, settings) => {
  return testEmailConnection(settings);
});

ipcMain.handle('email:sendTest', async (_, { settings, toEmail }) => {
  return sendTestEmail(settings, toEmail);
});

// Send Purchase Order Email
const nodemailer = require('nodemailer');
ipcMain.handle('email:sendPurchaseOrder', async (_, { to, po }) => {
  // Get business settings including SMTP
  const settingsRows = runQuery('SELECT key, value FROM settings');
  const settings = {};
  settingsRows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  });

  console.log('Email settings loaded:', {
    email_host: settings.email_host,
    email_user: settings.email_user,
    email_password: settings.email_password ? '***SET***' : 'NOT SET',
    email_port: settings.email_port,
  });

  // Check SMTP settings
  if (!settings.email_host || !settings.email_user || !settings.email_password) {
    throw new Error(`Email not configured. Missing: ${!settings.email_host ? 'host ' : ''}${!settings.email_user ? 'user ' : ''}${!settings.email_password ? 'password' : ''}`);
  }

  // Fetch full PO with items if items are missing
  let fullPO = po;
  if (!po.items || po.items.length === 0) {
    fullPO = getOne(`
      SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone, s.address as supplier_address, s.contact_person as supplier_contact_person
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = ?
    `, [po.id]);

    if (fullPO) {
      fullPO.items = runQuery(`
        SELECT poi.*, p.name as product_name, p.sku
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        WHERE poi.purchase_order_id = ?
      `, [po.id]);
    }
  }

  // Create transporter with settings
  const transporter = nodemailer.createTransport({
    host: settings.email_host,
    port: settings.email_port || 587,
    secure: settings.email_secure || false,
    auth: {
      user: settings.email_user,
      pass: settings.email_password,
    },
  });

  // Build modern email HTML
  const itemsHtml = (fullPO.items || []).map((item, index) => `
    <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f8fafc'};">
      <td style="padding: 12px 16px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${item.product_name}</td>
      <td class="mobile-hide" style="padding: 12px 16px; color: #475569; text-align: center; border-bottom: 1px solid #e2e8f0;">${item.quantity}</td>
      <td class="mobile-hide" style="padding: 12px 16px; color: #475569; text-align: right; border-bottom: 1px solid #e2e8f0;">$${(item.unit_cost || 0).toFixed(2)}</td>
      <td style="padding: 12px 16px; color: #0f172a; text-align: right; font-weight: 600; border-bottom: 1px solid #e2e8f0;">$${(item.total_cost || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Purchase Order</title>
      <style>
        @media only screen and (max-width: 600px) {
          .container { width: 100% !important; margin: 20px 0 !important; border-radius: 0 !important; }
          .content { padding: 20px !important; }
          .header { padding: 20px !important; }
          .info-grid { flex-direction: column !important; gap: 20px; }
          .info-grid > div { text-align: left !important; padding: 0 !important; }
          .mobile-hide { display: none !important; }
          h1 { font-size: 20px !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9;">
      <div class="container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); margin-top: 40px; margin-bottom: 40px;">
        
        <!-- Header -->
        <div class="header" style="background-color: #10b981; padding: 32px 40px; text-align: center;">
          <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Purchase Order</h1>
          <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px;">#${fullPO.po_number || fullPO.id?.slice(0, 8)}</p>
        </div>

        <!-- Content -->
        <div class="content" style="padding: 40px;">
          
          <!-- Context -->
          <div style="margin-bottom: 32px; text-align: center; color: #64748b; font-size: 16px; line-height: 1.5;">
            <p>Hello ${fullPO.supplier_contact_person || fullPO.supplier_name || 'Supplier'},</p>
            <p>Please find attached our purchase order. We would appreciate if you could process this order at your earliest convenience.</p>
          </div>

          <!-- Info Grid -->
          <div class="info-grid" style="display: flex; justify-content: space-between; margin-bottom: 32px; background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="flex: 1; padding-right: 20px;">
              <h3 style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">From</h3>
              <p style="margin: 0; color: #0f172a; font-weight: 600;">${settings.businessName || 'Our Company'}</p>
              <p style="margin: 4px 0 0; color: #475569; font-size: 14px;">${settings.businessEmail || ''}</p>
            </div>
            <div style="flex: 1; text-align: right;">
              <h3 style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">To</h3>
              <p style="margin: 0; color: #0f172a; font-weight: 600;">${fullPO.supplier_name || 'Supplier'}</p>
              <p style="margin: 4px 0 0; color: #475569; font-size: 14px;">${fullPO.supplier_email || ''}</p>
            </div>
          </div>

          <!-- Table -->
          <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 32px;">
            <thead>
              <tr>
                <th style="background-color: #f8fafc; padding: 12px 16px; text-align: left; color: #64748b; font-weight: 600; font-size: 13px; border-bottom: 2px solid #e2e8f0; border-top-left-radius: 6px;">ITEM</th>
                <th class="mobile-hide" style="background-color: #f8fafc; padding: 12px 16px; text-align: center; color: #64748b; font-weight: 600; font-size: 13px; border-bottom: 2px solid #e2e8f0;">QTY</th>
                <th class="mobile-hide" style="background-color: #f8fafc; padding: 12px 16px; text-align: right; color: #64748b; font-weight: 600; font-size: 13px; border-bottom: 2px solid #e2e8f0;">UNIT COST</th>
                <th style="background-color: #f8fafc; padding: 12px 16px; text-align: right; color: #64748b; font-weight: 600; font-size: 13px; border-bottom: 2px solid #e2e8f0; border-top-right-radius: 6px;">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="mobile-hide" style="padding: 20px 16px; text-align: right; font-weight: 600; color: #64748b;">Total Amount:</td>
                <td colspan="1" style="padding: 20px 16px; text-align: right; font-weight: 700; color: #0f172a; font-size: 18px;">$${(fullPO.total || 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          ${fullPO.notes ? `
            <div style="background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 16px; margin-bottom: 32px;">
              <h4 style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">Notes:</h4>
              <p style="margin: 0; color: #b45309; font-size: 14px;">${fullPO.notes}</p>
            </div>
          ` : ''}

          <!-- Footer -->
          <div style="text-align: center; border-top: 1px solid #e2e8f0; padding-top: 32px;">
            <p style="margin: 0 0 8px; color: #64748b; font-weight: 500;">Please verify this order and confirm receipt.</p>
            <p style="margin: 0; color: #94a3b8; font-size: 14px;">${settings.businessName || ''} &bull; ${settings.businessPhone || ''}</p>
          </div>
          
        </div>
      </div>
      
      <div style="text-align: center; padding-bottom: 40px; color: #94a3b8; font-size: 12px;">
        <p>Sent from our point of sale system</p>
      </div>
    </body>
    </html>
  `;

  // Generate PDF to attach
  let pdfPath = null;
  try {
    console.log('Generating PDF for email attachment...');
    pdfPath = await receiptService.generatePurchaseOrderPdf(fullPO, { type: 'purchase_order', ...settings });
    console.log('Email PDF generated at:', pdfPath);
  } catch (pdfError) {
    console.error('PDF generation failed, sending email without attachment:', pdfError);
  }

  // Build attachments array
  const attachments = [];
  if (pdfPath) {
    const fs = require('fs');
    if (fs.existsSync(pdfPath)) {
      console.log('Attaching PDF to email:', pdfPath);
      attachments.push({
        filename: `PO_${fullPO.po_number || 'draft'}.pdf`,
        path: pdfPath,
      });
    } else {
      console.error('Generated PDF file not found at path:', pdfPath);
    }
  } else {
    console.warn('pdfPath is null or undefined');
  }

  // Send email
  await transporter.sendMail({
    from: settings.email_user,
    to,
    subject: `Purchase Order #${fullPO.po_number || fullPO.id?.slice(0, 8)} from ${settings.businessName || 'our store'}`,
    html,
    attachments,
  });

  return { success: true };
});

// ==========================================
// RECEIPTS
// ==========================================

const DEFAULT_PRINTER_SETTINGS = {
  receipt: { printerName: '', paperWidthMm: 80, copies: 1, autoPrint: false, silent: false },
  label: { printerName: '', copies: 1, silent: false, dpi: 0 },
};

function getPrinterSettings() {
  const saved = getSettingValue('printer_settings') || {};
  return {
    receipt: { ...DEFAULT_PRINTER_SETTINGS.receipt, ...(saved.receipt || {}) },
    label: { ...DEFAULT_PRINTER_SETTINGS.label, ...(saved.label || {}) },
  };
}

// Shop settings plus the logo as a data URI, for receipts and labels
function getShopSettingsForPrint() {
  const settings = getStoreSettings();
  const { getImageBase64: imageAsBase64 } = require('./services/imageService');
  settings.shopLogoDataUri = settings.shopLogo ? imageAsBase64(settings.shopLogo) : null;
  settings.receiptPaperWidthMm = getPrinterSettings().receipt.paperWidthMm;
  return settings;
}

// Receipt lines carry the variant's colour code and size so colours are
// printed in the shop's language ("Noir" / "أسود"), whatever the label stored.
function enrichSaleForPrint(sale) {
  if (!sale || !Array.isArray(sale.items)) return sale;
  const items = sale.items.map(item => {
    if (!item.variant_id || item.color_code) return item;
    const variant = getOne('SELECT color, color_code, size FROM product_variants WHERE id = ?', [item.variant_id]);
    return variant ? { ...item, color: item.color || variant.color, color_code: variant.color_code, size: item.size || variant.size } : item;
  });
  return { ...sale, items };
}

// A printer removed or renamed in Windows/macOS: say so in the shop's language
function printerError(error, printerName) {
  const message = String(error && error.message || error);
  if (/deviceName|printer.*not found|no printer/i.test(message)) return catalog.codedError('PRINTER_NOT_FOUND', { name: printerName || '' });
  return error;
}

/**
 * The installed printer to send a job to: the saved name is checked against
 * the printers Windows/macOS report, so a printer that was removed gives a
 * clear message instead of a silent failure. Without a selected printer the
 * system print dialog is shown.
 */
async function resolvePrinterOptions(options) {
  const printer = { ...options };
  if (!printer.printerName) {
    printer.silent = false;
    return printer;
  }
  let installed = [];
  try {
    installed = mainWindow ? await mainWindow.webContents.getPrintersAsync() : [];
  } catch {
    return printer;
  }
  // The list can be empty when the print spooler is not answering: try anyway
  if (!installed.length) return printer;
  const name = printDocument.matchPrinter(installed, printer.printerName);
  if (name === null) throw catalog.codedError('PRINTER_NOT_FOUND', { name: printer.printerName });
  printer.printerName = name;
  return printer;
}

ipcMain.handle('receipts:print', async (_, sale, overrides = {}) => {
  const printer = await resolvePrinterOptions({ ...getPrinterSettings().receipt, ...overrides });
  try {
    return await receiptService.print(enrichSaleForPrint(sale), getShopSettingsForPrint(), printer);
  } catch (error) {
    throw printerError(error, printer.printerName);
  }
});

ipcMain.handle('receipts:getHtml', async (_, sale) => {
  return receiptService.getHtml(enrichSaleForPrint(sale), getShopSettingsForPrint());
});

ipcMain.handle('receipts:savePdf', async (_, sale) => {
  try {
    const settings = getShopSettingsForPrint();
    const dialogResult = await dialog.showSaveDialog({
      title: shopT('dialog.saveReceipt'),
      defaultPath: `Receipt_${sale.receipt_number || sale.id}.pdf`,
      filters: [{ name: shopT('dialog.pdfFiles'), extensions: ['pdf'] }]
    });

    if (dialogResult.canceled) return null;
    return await receiptService.generatePdf(enrichSaleForPrint(sale), settings, dialogResult.filePath);
  } catch (error) {
    console.error('savePdf error:', error);
    throw error;
  }
});

// ==========================================
// PRINTERS
// ==========================================
// Lists the printers installed in the operating system (Windows printers,
// including thermal receipt/label printers that have a Windows driver).
ipcMain.handle('printers:list', async () => {
  if (!mainWindow) return [];
  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map(p => ({
    name: p.name,
    displayName: p.displayName || p.name,
    description: p.description || '',
    isDefault: !!p.isDefault,
    status: p.status,
  }));
});

ipcMain.handle('printers:getSettings', () => getPrinterSettings());

// ==========================================
// QR LABELS
// ==========================================
const labelService = require('./services/labelService');

function getLabelSettings(overrides = {}) {
  return { ...labelService.DEFAULT_LABEL_SETTINGS, ...(getSettingValue('label_settings') || {}), ...overrides };
}

// Code printed on an article label when the layout asks for a barcode instead of the QR
function articleSymbology(layout, value) {
  const type = layout && layout.codeType;
  if (!type || type === 'qr') return null;
  if (type === 'ean13' && !/^\d{12,13}$/.test(String(value || ''))) return 'code128';
  return type;
}

// What an article label prints: the code and, when the layout asks for a
// barcode, the symbology (EAN-13 needs digits, otherwise Code 128 is used)
function articleCode(layout, { qrValue, barcode, sku }) {
  const type = articleSymbology(layout, barcode || sku);
  return type ? { symbology: type, qrValue: barcode || sku } : { qrValue };
}

// items: [{ variantId?, productId?, quantity, article?, previewBarcode? }],
// free labels [{ code, symbology, title?, price?, quantity }] or { sample: true }
function buildLabelData(items, layout = {}) {
  const settings = getStoreSettings();
  const articleScope = layout.codeScope === 'article';
  const money = { currency: settings.currency, currencySymbol: settings.currencySymbol };
  const labels = [];
  for (const item of items || []) {
    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
    if (item.sample) {
      // Example shown in Settings while the layout is being chosen
      const lang = i18n.normalizeLanguage(getStoreSettings().defaultLanguage);
      const body = '200123456789';
      const barcode = body + catalog.gs1CheckDigit(body);
      labels.push({
        productName: i18n.translate(lang, 'labels.sampleName'),
        variantLabel: articleScope ? '' : i18n.variantLabel({ color: 'black', color_code: 'black', size: 'M' }, lang),
        sku: articleScope ? barcode : 'TSH-BLK-M-001',
        ...articleCode(layout, { qrValue: articleScope ? barcode : 'TSH-BLK-M-001', barcode, sku: 'TSH-BLK-M-001' }),
        price: 2500,
        ...money,
        quantity,
      });
    } else if (item.code) {
      labels.push({
        productName: item.title || '',
        variantLabel: '',
        sku: String(item.code),
        qrValue: String(item.code),
        symbology: item.symbology || 'code128',
        price: item.price === '' || item.price === undefined || item.price === null ? null : Number(item.price),
        currency: settings.currency,
        quantity,
      });
    } else if (item.variantId && !articleScope) {
      const variant = getOne('SELECT * FROM product_variants WHERE id = ?', [item.variantId]);
      if (!variant) throw catalog.codedError('VARIANT_GONE', { product: '' });
      const product = getOne('SELECT * FROM products WHERE id = ?', [variant.product_id]);
      const barcode = item.previewBarcode || variant.barcode;
      labels.push({
        productName: product ? product.name : '',
        variantLabel: catalog.variantLabel(variant),
        sku: variant.sku,
        ...articleCode(layout, { qrValue: variant.qr_code || variant.sku, barcode, sku: variant.sku }),
        price: catalog.effectivePrice(product || {}, variant),
        ...money,
        quantity,
      });
    } else if (item.productId || item.variantId) {
      let productId = item.productId;
      if (!productId) productId = (getOne('SELECT product_id FROM product_variants WHERE id = ?', [item.variantId]) || {}).product_id;
      const product = getOne('SELECT * FROM products WHERE id = ?', [productId]);
      if (!product) throw new Error('Product not found');
      if (product.has_variants && !articleScope) throw catalog.codedError('VARIANT_REQUIRED', { product: product.name });
      const barcode = item.previewBarcode || product.barcode;
      const code = barcode || product.sku;
      if (!code) throw catalog.codedError('LABEL_NO_CODE', { product: product.name });
      // One code for the whole article: price from the article (lowest piece price when unset)
      let price = product.price;
      if (product.has_variants && !(Number(price) > 0)) {
        const min = getOne('SELECT MIN(price) AS p FROM product_variants WHERE product_id = ? AND is_active = 1 AND price IS NOT NULL', [product.id]);
        if (min && min.p !== null) price = min.p;
      }
      labels.push({
        productName: product.name,
        variantLabel: '',
        sku: product.sku || barcode,
        ...articleCode(layout, { qrValue: code, barcode, sku: product.sku || barcode }),
        price,
        ...money,
        quantity,
      });
    }
  }
  return labels;
}

function buildLabelsDocument(items, layoutOverrides, { preview = false } = {}) {
  const layout = getLabelSettings(layoutOverrides);
  const shop = getShopSettingsForPrint();
  // Articles without a code get one (saved when printing, only shown in a preview)
  const article = (items || []).filter(i => !i.code && !i.sample);
  const ensure = (list) => catalog.ensureLabelCodes(dbApi, list, { scope: layout.codeScope, codeType: layout.codeType, dryRun: preview });
  const prepared = article.length ? (preview ? ensure(article) : dbApi.transaction(() => ensure(article))) : { items: [], created: 0 };
  const allItems = [...(items || []).filter(i => i.code || i.sample), ...prepared.items];
  const html = labelService.buildLabelsHtml(buildLabelData(allItems, layout), layout, {
    name: shop.businessName,
    logo: shop.shopLogoDataUri,
    lang: i18n.normalizeLanguage(shop.defaultLanguage),
    preview,
  });
  return { html, layout, created: prepared.created };
}

ipcMain.handle('labels:getTemplates', () => ({
  templates: labelService.LABEL_TEMPLATES,
  defaults: labelService.DEFAULT_LABEL_SETTINGS,
}));

ipcMain.handle('labels:getSettings', () => getLabelSettings());

ipcMain.handle('labels:preview', (_, { items, layout }) => {
  const doc = buildLabelsDocument(items, layout, { preview: true });
  return { html: doc.html, page: labelService.getPageSize(labelService.resolveLayout(doc.layout)) };
});

ipcMain.handle('labels:print', async (_, { items, layout, printer }) => {
  // Printer first: no codes are created for a job that cannot print
  const options = await resolvePrinterOptions({ ...getPrinterSettings().label, ...(printer || {}) });
  const doc = buildLabelsDocument(items, layout);
  const result = await labelService.printLabels(BrowserWindow, doc.html, doc.layout, options)
    .catch((error) => { throw printerError(error, options.printerName); });
  return { ...result, created: doc.created };
});

ipcMain.handle('labels:savePdf', async (_, { items, layout }) => {
  const doc = buildLabelsDocument(items, layout);
  const result = await dialog.showSaveDialog({
    title: shopT('dialog.saveLabels'),
    defaultPath: 'labels.pdf',
    filters: [{ name: shopT('dialog.pdfFiles'), extensions: ['pdf'] }],
  });
  if (result.canceled) return null;
  const pdf = await labelService.labelsToPdf(BrowserWindow, doc.html, doc.layout);
  await fs.promises.writeFile(result.filePath, pdf);
  return result.filePath;
});

// Print an HTML document prepared by the renderer (used by the generic barcode
// generator). Rendered in a sandboxed window with scripts disabled; the system
// print dialog is always shown.
ipcMain.handle('print:html', async (_, { html }) => {
  if (typeof html !== 'string' || html.length > 20 * 1024 * 1024) throw new Error('Invalid document');
  const win = printDocument.hiddenWindow(BrowserWindow, { javascript: false });
  try {
    await printDocument.loadHtml(win, html);
    const result = await printDocument.printContents(win.webContents, { silent: false, printBackground: true });
    return result.success;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// QR image (SVG) for an identifier, for on-screen previews
ipcMain.handle('labels:qrSvg', (_, text) => labelService.qrSvg(text));

ipcMain.handle('db:receipts:getBySale', (_, saleId) => {
  return runQuery('SELECT * FROM receipts WHERE sale_id = ? ORDER BY created_at DESC', [saleId]);
});


// ==========================================  
// EMAIL: SEND RECEIPT
// ==========================================
ipcMain.handle('email:sendReceipt', async (_, sale, toEmail) => {
  const settingsRows = runQuery('SELECT key, value FROM settings');
  const settings = {};
  settingsRows.forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  });

  // Merge store_config if it exists
  const storeConfig = settings['store_config'] || {};
  Object.assign(settings, storeConfig);

  if (!settings.email_host || !settings.email_user || !settings.email_password) {
    throw new Error('Email not configured. Please configure SMTP settings in Settings > Email.');
  }

  // Determine if this is a credit payment
  const isCreditPayment = sale.type === 'credit_payment' || (sale.invoice_number && !sale.receipt_number);

  // Normalize data for email template
  const receiptNumber = sale.receipt_number || sale.invoice_number || 'N/A';
  const totalAmount = isCreditPayment ? (sale.amount || 0) : (sale.total || 0);
  const dateStr = new Date(sale.created_at).toLocaleString();

  // Ensure sale has items (only for standard sales)
  if (!isCreditPayment && (!sale.items || sale.items.length === 0)) {
    const items = runQuery('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
    sale.items = items;
  }

  const transporter = nodemailer.createTransport({
    host: settings.email_host,
    port: settings.email_port || 587,
    secure: settings.email_secure || false,
    auth: { user: settings.email_user, pass: settings.email_password },
  });

  let itemsHtml = '';
  if (isCreditPayment) {
    itemsHtml = `
      <tr>
        <td>Payment for Invoice #${sale.invoice_number}</td>
        <td>1</td>
        <td>$${totalAmount.toFixed(2)}</td>
        <td>$${totalAmount.toFixed(2)}</td>
      </tr>
    `;
  } else {
    itemsHtml = (sale.items || []).map(item => `
      <tr><td>${item.product_name}</td><td>${item.quantity}</td><td>$${(item.unit_price || 0).toFixed(2)}</td><td>$${(item.total || 0).toFixed(2)}</td></tr>
    `).join('');
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6366f1;">${settings.businessName || 'Receipt'}</h1>
      <p><strong>Receipt #:</strong> ${receiptNumber}</p>
      <p><strong>Date:</strong> ${dateStr}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead><tr style="background: #f3f4f6;"><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="font-size: 20px; font-weight: bold;">Total: $${totalAmount.toFixed(2)}</p>
      <p style="color: #6b7280; margin-top: 30px;">${settings.receiptFooter || 'Thank you for your business!'}</p>
    </div>
  `;

  // Generate PDF to attach
  let pdfPath = null;
  try {
    // Pass the correct type to generatePdf so it uses the right template logic
    const pdfType = isCreditPayment ? 'credit_payment' : 'receipt';
    pdfPath = await receiptService.generatePdf(sale, { ...settings, type: pdfType });
  } catch (pdfError) {
    console.error('Receipt PDF generation failed, sending email without attachment:', pdfError);
  }

  // Build attachments array
  const attachments = [];
  if (pdfPath) {
    const fs = require('fs');
    if (fs.existsSync(pdfPath)) {
      attachments.push({
        filename: `Receipt_${receiptNumber}.pdf`,
        path: pdfPath,
      });
    }
  }

  await transporter.sendMail({
    from: settings.email_user,
    to: toEmail,
    subject: `Receipt #${receiptNumber} from ${settings.businessName || 'our store'}`,
    html,
    attachments,
  });

  return { success: true };
});

// ==========================================
// PURCHASE ORDERS: SAVE PDF
// ==========================================
ipcMain.handle('purchaseOrders:savePdf', async (_, po) => {
  try {
    const settingsRows = runQuery('SELECT key, value FROM settings');
    const storeSettings = {};
    settingsRows.forEach(row => {
      try { storeSettings[row.key] = JSON.parse(row.value); } catch { storeSettings[row.key] = row.value; }
    });
    storeSettings.type = 'purchase_order';

    // Fetch full PO with items if missing
    let fullPO = po;
    if (!po.items || po.items.length === 0) {
      fullPO = getOne(`
        SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone, s.address as supplier_address
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
      `, [po.id]);

      if (fullPO) {
        fullPO.items = runQuery(`
          SELECT poi.*, p.name as product_name, p.sku
          FROM purchase_order_items poi
          LEFT JOIN products p ON poi.product_id = p.id
          WHERE poi.purchase_order_id = ?
        `, [po.id]);
      }
    }

    // Show save dialog
    const { shell } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: shopT('dialog.savePurchaseOrder'),
      defaultPath: `PO_${fullPO.po_number || 'draft'}.pdf`,
      filters: [{ name: shopT('dialog.pdfFiles'), extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    console.log('Generating PO PDF for:', fullPO?.po_number || fullPO?.id);
    const pdfPath = await receiptService.generatePurchaseOrderPdf(fullPO, storeSettings, result.filePath);
    console.log('PDF saved to:', pdfPath);

    // Open the PDF after saving
    shell.openPath(pdfPath);

    return pdfPath;
  } catch (error) {
    console.error('PO PDF generation error:', error);
    throw error;
  }
});

// ==========================================
// SUPPLIERS & RETURNS
// ==========================================
ipcMain.handle('db:suppliers:getAll', () => {
  const suppliers = runQuery('SELECT * FROM suppliers ORDER BY name');
  console.log('DEBUG: suppliers:getAll returned', suppliers.length, 'suppliers');
  return suppliers;
});

ipcMain.handle('db:suppliers:getById', (_, id) => {
  return getOne('SELECT * FROM suppliers WHERE id = ?', [id]);
});

// Get Supplier History (POs, Payments, Returns)
ipcMain.handle('db:suppliers:getHistory', (_, supplierId) => {
  const history = runQuery(`
    SELECT 
      'purchase_order' as type,
      id,
      po_number as reference,
      created_at as date,
      total as amount,
      status,
      payment_status
    FROM purchase_orders 
    WHERE supplier_id = ?
    
    UNION ALL
    
    SELECT 
      'payment' as type,
      id,
      payment_method as reference, -- e.g. "Bank Transfer"
      paid_at as date,
      amount,
      'completed' as status,
      NULL as payment_status
    FROM supplier_payments
    WHERE supplier_id = ?
    
    UNION ALL
    
    SELECT 
      'return' as type,
      id,
      return_number as reference,
      created_at as date,
      total_amount as amount,
      status,
      NULL as payment_status
    FROM purchase_returns
    WHERE supplier_id = ?
    
    ORDER BY date DESC
  `, [supplierId, supplierId, supplierId]);

  return history;
});

// Record Supplier Payment
ipcMain.handle('db:supplierPayments:create', (_, data) => { // data: { purchase_order_id, supplier_id, amount, payment_method, reference, notes }
  const id = uuid();
  const { purchase_order_id, supplier_id, amount, payment_method, reference, notes } = data;

  try {
    // 1. Record Payment
    runInsert(`
      INSERT INTO supplier_payments (id, purchase_order_id, supplier_id, amount, payment_method, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, purchase_order_id, supplier_id, amount, payment_method, reference, notes, 'system']); // TODO: pass user id

    // 2. Update Purchase Order (if linked)
    if (purchase_order_id) {
      const po = getOne('SELECT total, amount_paid FROM purchase_orders WHERE id = ?', [purchase_order_id]);
      if (po) {
        const newPaid = (po.amount_paid || 0) + amount;
        let newStatus = 'partial';
        if (newPaid >= po.total) newStatus = 'paid';
        if (newPaid === 0) newStatus = 'unpaid';

        runInsert('UPDATE purchase_orders SET amount_paid = ?, payment_status = ? WHERE id = ?',
          [newPaid, newStatus, purchase_order_id]);
      }
    }

    // 3. Update Supplier Balance (Reduce debt)
    // Note: Assuming 'balance' tracks what we OWE the supplier. Payment reduces it.
    // If balance tracks what they owe us, valid logic would be reversed. 
    // Convention: Supplier Balance = Amount We Owe.
    const supplier = getOne('SELECT balance FROM suppliers WHERE id = ?', [supplier_id]);
    const currentBalance = supplier ? (supplier.balance || 0) : 0;
    const newBalance = currentBalance - amount;
    runInsert('UPDATE suppliers SET balance = ? WHERE id = ?', [newBalance, supplier_id]);

    return { success: true, id };
  } catch (error) {
    console.error('Failed to record supplier payment:', error);
    throw error;
  }
});

// Create Purchase Return
ipcMain.handle('db:purchaseReturns:create', (_, data) => {
  const id = uuid();
  const { supplier_id, purchase_order_id, items, notes } = data; // items: [{product_id, quantity, unit_cost, reason}]

  try {
    // Calculate total
    const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_cost), 0);
    const returnNumber = 'RET-' + Date.now().toString().slice(-6);

    runTransaction(() => {
      // 1. Create Return Record
      runInsert(`
        INSERT INTO purchase_returns (id, return_number, purchase_order_id, supplier_id, total_amount, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [id, returnNumber, purchase_order_id, supplier_id, totalAmount, notes, 'complated']);

      // 2. Insert Items & Update Stock (returning to the supplier removes stock)
      items.forEach(item => {
        runInsert(`
          INSERT INTO purchase_return_items (id, return_id, product_id, variant_id, product_name, quantity, unit_cost, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [uuid(), id, item.product_id, item.variant_id || null, item.product_name, item.quantity, item.unit_cost, item.reason]);

        if (getOne('SELECT id FROM products WHERE id = ?', [item.product_id])) {
          catalog.adjustStock(dbApi, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            delta: -item.quantity,
            type: 'return_out',
            reason: `Return #${returnNumber}`,
          });
        }
      });
    });

    // 3. Update Supplier Balance (They owe us credit, or we owe them less)
    // Reduce what we owe them (Balance - Return Amount)
    const supplier = getOne('SELECT balance FROM suppliers WHERE id = ?', [supplier_id]);
    const currentBalance = supplier ? (supplier.balance || 0) : 0;
    const newBalance = currentBalance - totalAmount;
    runInsert('UPDATE suppliers SET balance = ? WHERE id = ?', [newBalance, supplier_id]);

    return { success: true, id, return_number: returnNumber };
  } catch (error) {
    console.error('Failed to create purchase return:', error);
    throw error;
  }
});

ipcMain.handle('db:suppliers:create', (_, supplier) => {
  const id = supplier.id || uuid();
  runInsert(`
    INSERT INTO suppliers (id, name, email, phone, address, contact_person, website, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, supplier.name, supplier.email || null, supplier.phone || null, supplier.address || null, supplier.contact_person || null, supplier.website || null, supplier.notes || null]);
  return { ...supplier, id };
});

ipcMain.handle('db:suppliers:update', (_, supplier) => {
  runInsert(`
    UPDATE suppliers SET 
      name = ?, email = ?, phone = ?, address = ?, contact_person = ?, website = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [supplier.name, supplier.email, supplier.phone, supplier.address, supplier.contact_person, supplier.website, supplier.notes, supplier.id]);
  return supplier;
});

ipcMain.handle('db:suppliers:delete', (_, id) => {
  runInsert('DELETE FROM suppliers WHERE id = ?', [id]);
  return true;
});

// ==========================================
// PURCHASE ORDERS
// ==========================================
ipcMain.handle('db:purchaseOrders:getAll', () => {
  return runQuery(`
    SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone, s.address as supplier_address
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    ORDER BY po.created_at DESC
  `);
});

ipcMain.handle('db:purchaseOrders:getById', (_, id) => {
  const po = getOne(`
    SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone, s.address as supplier_address
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = ?
  `, [id]);

  if (po) {
    po.items = runQuery(`
      SELECT poi.*, p.name as product_name, p.sku
      FROM purchase_order_items poi
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = ?
    `, [id]);
  }

  return po;
});

ipcMain.handle('db:purchaseOrders:create', (_, po) => {
  const id = po.id || uuid();
  runInsert(`
    INSERT INTO purchase_orders (
      id, po_number, supplier_id, expected_date, 
      subtotal, tax_rate, tax_amount, discount_type, discount_value, shipping_cost, 
      total, status, notes, amount_paid, payment_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid')
  `, [
    id, po.po_number, po.supplier_id, po.expected_date,
    po.subtotal, po.tax_rate || 0, po.tax_amount, po.discount_type || 'fixed', po.discount_value || 0, po.shipping_cost || 0,
    po.total, po.status || 'draft', po.notes
  ]);

  // Insert PO items
  for (const item of po.items) {
    runInsert(`
      INSERT INTO purchase_order_items (id, purchase_order_id, product_id, variant_id, variant_label, product_name, quantity, unit_cost, tax_rate, tax_amount, discount_amount, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.id || uuid(), id, item.product_id, item.variant_id || null, item.variant_label || null, item.product_name, item.quantity, item.unit_cost,
      item.tax_rate || 0, item.tax_amount || 0, item.discount_amount || 0, item.total_cost
    ]);
  }

  return { ...po, id };
});

ipcMain.handle('db:purchaseOrders:delete', (_, id) => {
  // Check validation rules
  const po = getOne('SELECT status, amount_paid FROM purchase_orders WHERE id = ?', [id]);

  if (!po) {
    throw new Error('Purchase Order not found');
  }

  if (po.status === 'received') {
    throw catalog.codedError('PO_RECEIVED_DELETE');
  }

  if (po.amount_paid > 0) {
    throw catalog.codedError('PO_PAID_DELETE');
  }

  try {
    // Delete items first
    runInsert('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [id]);
    // Delete PO
    runInsert('DELETE FROM purchase_orders WHERE id = ?', [id]);
    return true;
  } catch (error) {
    console.error('Failed to delete PO:', error);
    throw error;
  }
});

// GOODS RECEIVING (GRN)
ipcMain.handle('db:receivings:create', (_, data) => {
  const { poId, items, notes } = data;
  const receivingId = uuid();
  const receiveNumber = 'GRN-' + Date.now().toString().slice(-6);

  try {
    runTransaction(() => {
      // 1. Create Receiving Record
      runInsert(`
        INSERT INTO receivings (id, receive_number, purchase_order_id, supplier_id, notes)
        SELECT ?, ?, id, supplier_id, ? FROM purchase_orders WHERE id = ?
      `, [receivingId, receiveNumber, notes, poId]);

      // 2. Process Items (stock goes to the ordered variant)
      for (const item of items) {
        if (!(item.quantity_received > 0)) continue;
        const poItem = item.po_item_id
          ? getOne('SELECT variant_id FROM purchase_order_items WHERE id = ?', [item.po_item_id])
          : null;
        const variantId = item.variant_id || (poItem && poItem.variant_id) || null;

        runInsert(`
          INSERT INTO receiving_items (id, receiving_id, product_id, variant_id, product_name, quantity_ordered, quantity_received)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [uuid(), receivingId, item.product_id, variantId, item.product_name, item.quantity_ordered, item.quantity_received]);

        // Update PO Item Received Qty
        runInsert(`
          UPDATE purchase_order_items 
          SET received_quantity = received_quantity + ?
          WHERE id = ?
        `, [item.quantity_received, item.po_item_id]);

        catalog.adjustStock(dbApi, {
          productId: item.product_id,
          variantId,
          delta: item.quantity_received,
          type: 'purchase',
          reason: `GRN: ${receiveNumber}`,
        });
      }
    });

    // 3. Check PO Status
    // Get all items for this PO to check if everything is received
    const poItems = runQuery('SELECT quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
    const isFullyReceived = poItems.every(i => i.received_quantity >= i.quantity);
    const isPartial = poItems.some(i => i.received_quantity > 0);

    const newStatus = isFullyReceived ? 'received' : (isPartial ? 'partial' : 'sent');

    runInsert('UPDATE purchase_orders SET status = ? WHERE id = ?', [newStatus, poId]);

    return { id: receivingId, receive_number: receiveNumber };
  } catch (error) {
    console.error('Failed to create GRN:', error);
    throw error;
  }
});

// SUPPLIER INVOICES (Phase 3)
ipcMain.handle('db:supplierInvoices:create', (_, data) => {
  const id = uuid();
  const { purchase_order_id, invoice_number, invoice_date, due_date, subtotal, tax_amount, total_amount, notes } = data;

  try {
    // 1. Perform 3-Way Match Validation Check
    // Get PO Total
    const po = getOne('SELECT total FROM purchase_orders WHERE id = ?', [purchase_order_id]);

    // Get GRN Value (Sum of received items * unit cost)
    // Note: This relies on unit_cost from PO items. Detailed GRN valuation might need actual cost at receipt if different.
    // For now assuming PO cost.
    const grnValue = getOne(`
      SELECT SUM(quantity_received * unit_cost) as total_received_value 
      FROM purchase_order_items 
      WHERE purchase_order_id = ?
    `, [purchase_order_id]);

    const poTotal = po ? po.total : 0;
    const receivedValue = grnValue ? grnValue.total_received_value || 0 : 0;

    // The invoice matches when it equals the order total, or the value of what
    // was actually received (partial deliveries). Small rounding allowed.
    const difference = Math.min(Math.abs(total_amount - poTotal), receivedValue > 0 ? Math.abs(total_amount - receivedValue) : Infinity);
    const match_status = difference < 0.05 ? 'matched' : 'mismatched';

    runInsert(`
      INSERT INTO supplier_invoices (
        id, purchase_order_id, invoice_number, invoice_date, due_date,
        subtotal, tax_amount, total_amount, match_status, payment_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
    `, [id, purchase_order_id, invoice_number, invoice_date, due_date, subtotal, tax_amount, total_amount, match_status, notes]);

    return { id, match_status };
  } catch (error) {
    console.error('Failed to create Supplier Invoice:', error);
    throw error;
  }
});

ipcMain.handle('db:supplierInvoices:getByPoId', (_, poId) => {
  return runQuery('SELECT * FROM supplier_invoices WHERE purchase_order_id = ? ORDER BY invoice_date DESC', [poId]);
});

// INTELLIGENCE & REPORTS (Phase 4)
ipcMain.handle('db:reports:getLowStock', () => {
  return runQuery(`
    SELECT p.*, s.id as supplier_id, s.name as supplier_name 
    FROM products p 
    LEFT JOIN suppliers s ON p.supplier_id = s.id 
    WHERE p.stock_quantity <= p.min_stock_level AND p.is_active = 1
    ORDER BY s.name, p.name
  `);
});

ipcMain.handle('db:reports:getSupplierStats', () => {
  const summary = getOne(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(total) as total_purchased,
      SUM(amount_paid) as total_paid
    FROM purchase_orders
    WHERE status != 'cancelled'
  `);

  const topSuppliers = runQuery(`
    SELECT s.name, SUM(po.total) as total_spend, COUNT(po.id) as order_count
    FROM purchase_orders po
    JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.status != 'cancelled'
    GROUP BY s.id
    ORDER BY total_spend DESC
    LIMIT 5
  `);

  return { summary, topSuppliers };
});

// Gift Cards
ipcMain.handle('db:giftCards:getAll', () => {
  return runQuery(`
    SELECT gc.*, c.name as customer_name
    FROM gift_cards gc
    LEFT JOIN customers c ON gc.customer_id = c.id
    ORDER BY gc.created_at DESC
  `);
});

ipcMain.handle('db:giftCards:getById', (_, id) => {
  return getOne(`
    SELECT gc.*, c.name as customer_name
    FROM gift_cards gc
    LEFT JOIN customers c ON gc.customer_id = c.id
    WHERE gc.id = ?
  `, [id]);
});

ipcMain.handle('db:giftCards:getByCode', (_, code) => {
  return getOne(`
    SELECT gc.*, c.name as customer_name
    FROM gift_cards gc
    LEFT JOIN customers c ON gc.customer_id = c.id
    WHERE gc.code = ? AND gc.is_active = 1
  `, [code]);
});

ipcMain.handle('db:giftCards:create', (_, giftCard) => {
  runInsert(`
    INSERT INTO gift_cards (id, code, initial_balance, current_balance, customer_id, is_active, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    giftCard.id,
    giftCard.code,
    giftCard.initial_balance,
    giftCard.current_balance || giftCard.initial_balance,
    giftCard.customer_id || null,
    giftCard.is_active ? 1 : 0,
    giftCard.expires_at || null,
    giftCard.created_by || null
  ]);
  return giftCard;
});

ipcMain.handle('db:giftCards:update', (_, giftCard) => {
  runInsert(`
    UPDATE gift_cards SET
      current_balance = ?, customer_id = ?, is_active = ?, expires_at = ?
    WHERE id = ?
  `, [
    giftCard.current_balance,
    giftCard.customer_id || null,
    giftCard.is_active ? 1 : 0,
    giftCard.expires_at || null,
    giftCard.id
  ]);
  return giftCard;
});

ipcMain.handle('db:giftCards:redeem', (_, { giftCardId, amount, saleId, employeeId }) => {
  const giftCard = getOne('SELECT * FROM gift_cards WHERE id = ?', [giftCardId]);
  if (!giftCard || !giftCard.is_active) {
    throw new Error('Gift card not found or inactive');
  }
  if (giftCard.current_balance < amount) {
    throw new Error('Insufficient balance');
  }

  const newBalance = giftCard.current_balance - amount;

  // Auto-deactivate if fully redeemed
  const isActive = newBalance > 0 ? 1 : 0;

  runInsert('UPDATE gift_cards SET current_balance = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [newBalance, isActive, giftCardId]);

  // Log transaction
  runInsert(`
    INSERT INTO gift_card_transactions (id, gift_card_id, sale_id, amount, type, balance_before, balance_after, employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uuid(), giftCardId, saleId || null, amount, 'redeem', giftCard.current_balance, newBalance, employeeId || null]);

  SyncManager.triggerSync();
  return { ...giftCard, current_balance: newBalance, is_active: !!isActive };
});

ipcMain.handle('db:giftCards:reload', (_, { giftCardId, amount, employeeId }) => {
  const giftCard = getOne('SELECT * FROM gift_cards WHERE id = ?', [giftCardId]);
  if (!giftCard) {
    throw new Error('Gift card not found');
  }

  const newBalance = giftCard.current_balance + amount;
  runInsert('UPDATE gift_cards SET current_balance = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [newBalance, giftCardId]);

  // Log transaction
  runInsert(`
    INSERT INTO gift_card_transactions (id, gift_card_id, amount, type, balance_before, balance_after, employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uuid(), giftCardId, amount, 'reload', giftCard.current_balance, newBalance, employeeId || null]);

  SyncManager.triggerSync();
  return { ...giftCard, current_balance: newBalance, is_active: 1 };
});

ipcMain.handle('db:giftCards:getTransactions', (_, giftCardId) => {
  return runQuery(`
    SELECT gct.*, gc.code as gift_card_code, e.name as employee_name, s.receipt_number
    FROM gift_card_transactions gct
    LEFT JOIN gift_cards gc ON gct.gift_card_id = gc.id
    LEFT JOIN employees e ON gct.employee_id = e.id
    LEFT JOIN sales s ON gct.sale_id = s.id
    WHERE gct.gift_card_id = ?
    ORDER BY gct.created_at DESC
  `, [giftCardId]);
});

// Generate gift card code
ipcMain.handle('db:giftCards:generateCode', () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
});

// Bundles
ipcMain.handle('db:bundles:getAll', () => {
  return runQuery('SELECT * FROM bundles ORDER BY name');
});

ipcMain.handle('db:bundles:getById', (_, id) => {
  const bundle = getOne('SELECT * FROM bundles WHERE id = ?', [id]);
  if (bundle) {
    bundle.items = runQuery(`
      SELECT bi.*, p.name as product_name, p.price as product_price, p.image_path
      FROM bundle_items bi
      JOIN products p ON bi.product_id = p.id
      WHERE bi.bundle_id = ?
    `, [id]);
  }
  return bundle;
});

ipcMain.handle('db:bundles:getActive', () => {
  const bundles = runQuery('SELECT * FROM bundles WHERE is_active = 1 ORDER BY name');
  for (const bundle of bundles) {
    bundle.items = runQuery(`
      SELECT bi.*, p.name as product_name, p.price as product_price, p.image_path
      FROM bundle_items bi
      JOIN products p ON bi.product_id = p.id
      WHERE bi.bundle_id = ?
    `, [bundle.id]);
  }
  return bundles;
});

ipcMain.handle('db:bundles:create', (_, { bundle, items }) => {
  // Calculate original price and savings
  let originalPrice = 0;
  for (const item of items) {
    const product = getOne('SELECT price FROM products WHERE id = ?', [item.product_id]);
    if (product) {
      originalPrice += product.price * (item.quantity || 1);
    }
  }
  const savings = originalPrice - bundle.bundle_price;

  runInsert(`
    INSERT INTO bundles (id, name, description, bundle_price, original_price, savings, is_active, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    bundle.id,
    bundle.name,
    bundle.description || null,
    bundle.bundle_price,
    originalPrice,
    savings,
    bundle.is_active ? 1 : 0,
    bundle.image_path || null
  ]);

  // Add bundle items
  for (const item of items) {
    runInsert(`
      INSERT INTO bundle_items (id, bundle_id, product_id, quantity)
      VALUES (?, ?, ?, ?)
    `, [uuid(), bundle.id, item.product_id, item.quantity || 1]);
  }

  // Bundle Assembly Logic: If pre-packed and has initial stock, deduct components
  if (bundle.deduct_component_stock === 0 && (bundle.stock_quantity || 0) > 0) {
    for (const item of items) {
      const qtyNeeded = (item.quantity || 1) * bundle.stock_quantity;

      runInsert('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [qtyNeeded, item.product_id]);

      // Log inventory movement
      runInsert(`
              INSERT INTO inventory_logs (id, product_id, type, quantity_change, quantity_before, quantity_after, reason, created_at)
              SELECT ?, ?, 'assembly', ?, stock_quantity + ?, stock_quantity, ?, CURRENT_TIMESTAMP
              FROM products WHERE id = ?
          `, [uuid(), item.product_id, -qtyNeeded, qtyNeeded, `Bundle Assembly: ${bundle.name} (+${bundle.stock_quantity})`, item.product_id]);
    }
  }

  return { ...bundle, original_price: originalPrice, savings, items };
});

ipcMain.handle('db:bundles:update', (_, { bundle, items }) => {
  // Calculate original price and savings
  let originalPrice = 0;
  for (const item of items) {
    const product = getOne('SELECT price FROM products WHERE id = ?', [item.product_id]);
    if (product) {
      originalPrice += product.price * (item.quantity || 1);
    }
  }
  const savings = originalPrice - bundle.bundle_price;

  // Fetch old bundle to check for stock changes
  const oldBundle = getOne('SELECT stock_quantity, deduct_component_stock FROM bundles WHERE id = ?', [bundle.id]);

  runInsert(`
    UPDATE bundles SET
      name = ?, description = ?, bundle_price = ?, original_price = ?, savings = ?, is_active = ?, deduct_component_stock = ?, stock_quantity = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    bundle.name,
    bundle.description || null,
    bundle.bundle_price,
    originalPrice,
    savings,
    bundle.is_active ? 1 : 0,
    bundle.deduct_component_stock ? 1 : 0,
    bundle.stock_quantity || 0,
    bundle.image_path || null,
    bundle.id
  ]);

  // Replace bundle items
  runInsert('DELETE FROM bundle_items WHERE bundle_id = ?', [bundle.id]);
  for (const item of items) {
    runInsert(`
      INSERT INTO bundle_items (id, bundle_id, product_id, quantity)
      VALUES (?, ?, ?, ?)
    `, [uuid(), bundle.id, item.product_id, item.quantity || 1]);
  }

  // Bundle Assembly Logic (Update)
  if (bundle.deduct_component_stock === 0) { // Pre-packed
    const oldStock = oldBundle ? (oldBundle.stock_quantity || 0) : 0;
    const newStock = bundle.stock_quantity || 0;
    const stockDiff = newStock - oldStock;

    if (stockDiff > 0) {
      for (const item of items) {
        const qtyNeeded = (item.quantity || 1) * stockDiff;

        runInsert('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [qtyNeeded, item.product_id]);

        // Log inventory movement
        runInsert(`
                  INSERT INTO inventory_logs (id, product_id, type, quantity_change, quantity_before, quantity_after, reason, created_at)
                  SELECT ?, ?, 'assembly', ?, stock_quantity + ?, stock_quantity, ?, CURRENT_TIMESTAMP
                  FROM products WHERE id = ?
              `, [uuid(), item.product_id, -qtyNeeded, qtyNeeded, `Bundle Assembly: ${bundle.name} (+${stockDiff})`, item.product_id]);
      }
    }
  }

  return { ...bundle, original_price: originalPrice, savings, items };
});

ipcMain.handle('db:bundles:delete', (_, id) => {
  const bundle = getOne('SELECT * FROM bundles WHERE id = ?', [id]);
  if (!bundle) return true;

  // Restore component stock if it's a pre-assembled bundle
  if (bundle.deduct_component_stock === 0 && (bundle.stock_quantity || 0) > 0) {
    const items = runQuery('SELECT * FROM bundle_items WHERE bundle_id = ?', [id]);

    for (const item of items) {
      const qtyToRestore = (item.quantity || 1) * bundle.stock_quantity;

      runInsert('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [qtyToRestore, item.product_id]);

      runInsert(`
        INSERT INTO inventory_logs (id, product_id, type, quantity_change, quantity_before, quantity_after, reason, created_at)
        SELECT ?, ?, 'disassembly', ?, stock_quantity - ?, stock_quantity, ?, CURRENT_TIMESTAMP
        FROM products WHERE id = ?
      `, [uuid(), item.product_id, qtyToRestore, qtyToRestore, `Bundle Deleted: ${bundle.name}`, item.product_id]);
    }
  }

  runInsert('DELETE FROM bundles WHERE id = ?', [id]);
  return true;
});

ipcMain.handle('db:bundles:assemble', (_, { id, quantity }) => {
  const bundle = getOne('SELECT * FROM bundles WHERE id = ?', [id]);
  if (!bundle) throw new Error('Bundle not found');

  const items = runQuery('SELECT * FROM bundle_items WHERE bundle_id = ?', [id]);
  if (items.length === 0) throw new Error('Bundle has no items');

  // Check valid quantity
  if (quantity <= 0) throw new Error('Invalid quantity');

  // Verify component stock
  for (const item of items) {
    const product = getOne('SELECT stock_quantity, name FROM products WHERE id = ?', [item.product_id]);
    const required = (item.quantity || 1) * quantity;
    if (product.stock_quantity < required) {
      throw new Error(`Insufficient stock for ${product.name}. Need ${required}, have ${product.stock_quantity}`);
    }
  }

  // Deduct components and Log
  for (const item of items) {
    const required = (item.quantity || 1) * quantity;

    runInsert('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [required, item.product_id]);

    runInsert(`
      INSERT INTO inventory_logs (id, product_id, type, quantity_change, quantity_before, quantity_after, reason, created_at)
      SELECT ?, ?, 'assembly', ?, stock_quantity + ?, stock_quantity, ?, CURRENT_TIMESTAMP
      FROM products WHERE id = ?
    `, [uuid(), item.product_id, -required, required, `Bundle Assembly: ${bundle.name} (+${quantity})`, item.product_id]);
  }

  // Increase Bundle Stock
  runInsert('UPDATE bundles SET stock_quantity = COALESCE(stock_quantity, 0) + ? WHERE id = ?', [quantity, id]);

  return true;
});

ipcMain.handle('db:bundles:disassemble', (_, { id, quantity }) => {
  const bundle = getOne('SELECT * FROM bundles WHERE id = ?', [id]);
  if (!bundle) throw new Error('Bundle not found');

  const currentStock = bundle.stock_quantity || 0;
  if (currentStock < quantity) {
    throw new Error(`Insufficient bundle stock to disassemble. Have: ${currentStock}, Need: ${quantity}`);
  }

  const items = runQuery('SELECT * FROM bundle_items WHERE bundle_id = ?', [id]);

  // Decrease Bundle Stock
  runInsert('UPDATE bundles SET stock_quantity = COALESCE(stock_quantity, 0) - ? WHERE id = ?', [quantity, id]);

  // Restore Components
  for (const item of items) {
    const toRestore = (item.quantity || 1) * quantity;

    runInsert('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [toRestore, item.product_id]);

    runInsert(`
      INSERT INTO inventory_logs (id, product_id, type, quantity_change, quantity_before, quantity_after, reason, created_at)
      SELECT ?, ?, 'disassembly', ?, stock_quantity - ?, stock_quantity, ?, CURRENT_TIMESTAMP
      FROM products WHERE id = ?
    `, [uuid(), item.product_id, toRestore, toRestore, `Bundle Disassembly: ${bundle.name} (-${quantity})`, item.product_id]);
  }

  return true;
});

// Promotions
ipcMain.handle('db:promotions:getAll', () => {
  return runQuery('SELECT * FROM promotions ORDER BY created_at DESC');
});

ipcMain.handle('db:promotions:getActive', () => {
  const now = new Date().toISOString();
  return runQuery(`
    SELECT * FROM promotions
    WHERE is_active = 1
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
      AND (max_uses IS NULL OR current_uses < max_uses)
    ORDER BY created_at DESC
  `, [now, now]);
});

ipcMain.handle('db:promotions:getById', (_, id) => {
  return getOne('SELECT * FROM promotions WHERE id = ?', [id]);
});

ipcMain.handle('db:promotions:getByCode', (_, code) => {
  const now = new Date().toISOString();
  return getOne(`
    SELECT * FROM promotions
    WHERE coupon_code = ?
      AND is_active = 1
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
      AND (max_uses IS NULL OR current_uses < max_uses)
  `, [code, now, now]);
});

ipcMain.handle('db:promotions:incrementUse', (_, id) => {
  runInsert('UPDATE promotions SET current_uses = current_uses + 1, updated_at = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ?', [id]);
  SyncManager.triggerSync();
  return true;
});

ipcMain.handle('db:promotions:create', (_, promo) => {
  runInsert(`
    INSERT INTO promotions (id, name, description, type, value, min_purchase, max_discount, max_uses, start_date, end_date, is_active, applies_to, applies_to_ids, coupon_code, auto_apply)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    promo.id,
    promo.name,
    promo.description || null,
    promo.type,
    promo.value || 0,
    promo.min_purchase || 0,
    promo.max_discount || null,
    promo.max_uses || null,
    promo.start_date || null,
    promo.end_date || null,
    promo.is_active ? 1 : 0,
    promo.applies_to || 'all',
    promo.applies_to_ids ? (typeof promo.applies_to_ids === 'string' ? promo.applies_to_ids : JSON.stringify(promo.applies_to_ids)) : null,
    promo.coupon_code || null,
    promo.auto_apply ? 1 : 0
  ]);
  return promo;
});

ipcMain.handle('db:promotions:update', (_, promo) => {
  runInsert(`
    UPDATE promotions SET
      name = ?, description = ?, type = ?, value = ?, min_purchase = ?, max_discount = ?,
      max_uses = ?, start_date = ?, end_date = ?, is_active = ?, applies_to = ?,
      applies_to_ids = ?, coupon_code = ?, auto_apply = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    promo.name,
    promo.description || null,
    promo.type,
    promo.value || 0,
    promo.min_purchase || 0,
    promo.max_discount || null,
    promo.max_uses || null,
    promo.start_date || null,
    promo.end_date || null,
    promo.is_active ? 1 : 0,
    promo.applies_to || 'all',
    promo.applies_to_ids ? (typeof promo.applies_to_ids === 'string' ? promo.applies_to_ids : JSON.stringify(promo.applies_to_ids)) : null,
    promo.coupon_code || null,
    promo.auto_apply ? 1 : 0,
    promo.id
  ]);
  return promo;
});

ipcMain.handle('db:promotions:delete', (_, id) => {
  runInsert('DELETE FROM promotions WHERE id = ?', [id]);
  return true;
});

// Receipts tracking
ipcMain.handle('db:receipts:create', (_, receipt) => {
  runInsert(`
    INSERT INTO receipts (id, sale_id, type, email_to, status)
    VALUES (?, ?, ?, ?, ?)
  `, [receipt.id, receipt.sale_id, receipt.type, receipt.email_to || null, receipt.status || 'pending']);
  return receipt;
});

ipcMain.handle('db:receipts:updateStatus', (_, { id, status, errorMessage }) => {
  if (status === 'sent') {
    runInsert('UPDATE receipts SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
  } else {
    runInsert('UPDATE receipts SET status = ?, error_message = ? WHERE id = ?', [status, errorMessage || null, id]);
  }
  return true;
});



// ===== BARCODE SERVICE =====
const barcodeService = require('./services/barcodeService');

ipcMain.handle('barcode:getTypes', () => {
  return barcodeService.getBarcodeTypes();
});

ipcMain.handle('barcode:getPresets', () => {
  return barcodeService.getIndustryPresets();
});

ipcMain.handle('barcode:generate', async (_, options) => {
  return await barcodeService.generateBarcode(options);
});

ipcMain.handle('barcode:generateLabel', async (_, options) => {
  return await barcodeService.generateLabel(options);
});

ipcMain.handle('barcode:generateBatch', async (_, { products, preset, quantity }) => {
  return await barcodeService.generateBatchLabels(products, preset, quantity);
});

ipcMain.handle('barcode:generateGS1', (_, components) => {
  return barcodeService.generateGS1Data(components);
});

ipcMain.handle('barcode:generateRandom', (_, type) => {
  return barcodeService.generateRandomBarcode(type);
});

ipcMain.handle('barcode:calculateCheckDigit', (_, { data, type }) => {
  return barcodeService.calculateCheckDigit(data, type);
});

// ===== EXCEL SERVICE =====
const excelService = require('./services/excelService');

ipcMain.handle('excel:parseBuffer', (_, buffer) => {
  // Convert array to Buffer if needed
  const buf = Buffer.from(buffer);
  return excelService.parseBuffer(buf);
});

ipcMain.handle('excel:detectMappings', (_, { headers, dataType }) => {
  return excelService.detectColumnMappings(headers, dataType);
});

ipcMain.handle('excel:validateAndTransform', (_, { rows, mappings, dataType }) => {
  return excelService.validateAndTransform(rows, mappings, dataType);
});

ipcMain.handle('excel:getFieldMappings', (_, dataType) => {
  return excelService.getFieldMappings(dataType);
});

ipcMain.handle('excel:generateTemplate', (_, dataType) => {
  const buffer = excelService.generateTemplate(dataType);
  return Array.from(buffer);
});




ipcMain.handle('quotations:print', async (_, quote) => {
  // Print using the same service, it will auto-detect type 'quotation' via the update above
  return await receiptService.print(quote);
});

ipcMain.handle('quotations:savePdf', async (_, quote) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: shopT('dialog.saveQuotation'),
    defaultPath: `Quotation_${quote.quote_number}.pdf`,
    filters: [{ name: shopT('dialog.pdfFiles'), extensions: ['pdf'] }]
  });

  if (canceled || !filePath) return null;

  const settings = await getSettings(); // Helper or duplicate logic
  await receiptService.generateQuotationPdf(quote, settings, filePath);
  return filePath;
});



// Helper to get settings object
async function getSettings() {
  // Includes the shop information (store_config) at the top level
  return getStoreSettings();
}

ipcMain.handle('excel:export', (_, { data, dataType }) => {
  const buffer = excelService.exportData(data, dataType);
  return Array.from(buffer);
});


// ================================================
// QUOTATIONS
// ================================================
ipcMain.handle('db:quotations:create', (_, quote) => {
  runInsert(`
    INSERT INTO quotations (id, quote_number, customer_id, subtotal, tax_amount, discount_amount, total, notes, status, valid_until, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    quote.id,
    quote.quote_number,
    quote.customer_id || null,
    quote.subtotal || 0,
    quote.tax_amount || 0,
    quote.discount_amount || 0,
    quote.total || 0,
    quote.notes || null,
    quote.status || 'active',
    quote.valid_until || null,
    quote.created_by || null
  ]);

  for (const item of quote.items) {
    runInsert(`
      INSERT INTO quotation_items (id, quotation_id, product_id, variant_id, variant_label, product_name, quantity, unit_price, discount, tax_amount, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuid(),
      quote.id,
      item.product_id || null,
      item.variant_id || null,
      item.variant_label || null,
      item.product_name,
      item.quantity,
      item.unit_price || 0,
      item.discount || 0,
      item.tax_amount || 0,
      item.total || 0
    ]);
  }
  return quote;
});

ipcMain.handle('db:quotations:getAll', () => {
  return runQuery(`
    SELECT q.*, c.name as customer_name, e.name as employee_name
    FROM quotations q
    LEFT JOIN customers c ON q.customer_id = c.id
    LEFT JOIN employees e ON q.created_by = e.id
    ORDER BY q.created_at DESC
    `);
});

ipcMain.handle('db:quotations:getById', (_, id) => {
  const quote = getOne(`
    SELECT q.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, e.name as employee_name
    FROM quotations q
    LEFT JOIN customers c ON q.customer_id = c.id
    LEFT JOIN employees e ON q.created_by = e.id
    WHERE q.id = ?
    `, [id]);

  if (quote) {
    quote.items = runQuery('SELECT * FROM quotation_items WHERE quotation_id = ?', [id]);
  }
  return quote;
});

// ================================================
// RETURNS
// ================================================


ipcMain.handle('db:purchaseOrders:receiveStock', (_, { poId, receivedItems }) => {
  // 1. Update PO status
  runInsert("UPDATE purchase_orders SET status = 'received', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [poId]);

  // 2. Update Product/Variant Stock and Log. Quantities actually received
  // (receivedItems: [{ id | product_id, variant_id?, quantity }]) win over the ordered ones.
  const items = runQuery('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [poId]);
  const receivedQty = (item) => {
    if (!Array.isArray(receivedItems) || receivedItems.length === 0) return item.quantity;
    const match = receivedItems.find(r => (r.id && r.id === item.id)
      || (r.product_id === item.product_id && (r.variant_id || null) === (item.variant_id || null)));
    return match ? Math.max(0, parseInt(match.quantity, 10) || 0) : 0;
  };

  runTransaction(() => {
    for (const item of items) {
      const quantity = receivedQty(item);
      if (quantity > 0 && item.product_id && getOne('SELECT id FROM products WHERE id = ?', [item.product_id])) {
        catalog.adjustStock(dbApi, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          delta: quantity,
          type: 'receive_po',
          reason: `Received PO #${poId}`,
        });
      }
    }
  });
  return true;
});

// ==========================================
// CREDIT SALES HANDLERS
// ==========================================

console.log('Registering credit sales IPC handlers...');

// Generate invoice number
function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  // Get count of invoices today
  const todayStart = `${date.getFullYear()}-${month}-${day}`;
  const result = getOne(`SELECT COUNT(*) as count FROM credit_sales WHERE created_at >= ?`, [todayStart]);
  const count = (result?.count || 0) + 1;

  return `INV-${year}${month}${day}-${count.toString().padStart(4, '0')}`;
}

console.log('Registering db:creditSales:getAll handler explicitly...');

ipcMain.handle('db:creditSales:getAll', (_, params = {}) => {
  console.log('db:creditSales:getAll called with:', params);
  let query = `
    SELECT cs.*, s.receipt_number, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM credit_sales cs
    LEFT JOIN sales s ON cs.sale_id = s.id
    LEFT JOIN customers c ON cs.customer_id = c.id
  `;

  const conditions = [];
  const values = [];

  if (params.customerId) {
    conditions.push('cs.customer_id = ?');
    values.push(params.customerId);
  }

  if (params.status) {
    conditions.push('cs.status = ?');
    values.push(params.status);
  }

  if (params.startDate) {
    conditions.push('cs.created_at >= ?');
    values.push(params.startDate);
  }

  if (params.endDate) {
    conditions.push('cs.created_at <= ?');
    values.push(params.endDate);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY cs.created_at DESC';

  return runQuery(query, values);
});

ipcMain.handle('db:creditSales:getById', (_, id) => {
  const creditSale = getOne(`
    SELECT cs.*, s.receipt_number, s.subtotal, s.tax_amount, s.discount_amount,
           c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
    FROM credit_sales cs
    LEFT JOIN sales s ON cs.sale_id = s.id
    LEFT JOIN customers c ON cs.customer_id = c.id
    WHERE cs.id = ?
  `, [id]);

  if (creditSale) {
    // Get sale items
    creditSale.items = runQuery('SELECT * FROM sale_items WHERE sale_id = ?', [creditSale.sale_id]);
    // Get payments made
    creditSale.payments = runQuery(`
      SELECT cp.*, e.name as received_by_name
      FROM credit_payments cp
      LEFT JOIN employees e ON cp.received_by = e.id
      WHERE cp.credit_sale_id = ?
      ORDER BY cp.created_at DESC
    `, [id]);
  }

  return creditSale;
});

ipcMain.handle('db:creditSales:getByCustomer', (_, customerId) => {
  return runQuery(`
    SELECT cs.*, s.receipt_number
    FROM credit_sales cs
    LEFT JOIN sales s ON cs.sale_id = s.id
    WHERE cs.customer_id = ?
    ORDER BY cs.created_at DESC
  `, [customerId]);
});

ipcMain.handle('db:creditSales:create', (_, creditSale) => {
  const invoiceNumber = creditSale.invoice_number || generateInvoiceNumber();
  const id = creditSale.id || uuid();

  // Calculate due date (30 days from now by default)
  const dueDate = creditSale.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  runInsert(`
    INSERT INTO credit_sales (id, sale_id, customer_id, invoice_number, amount_due, amount_paid, status, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    creditSale.sale_id,
    creditSale.customer_id,
    invoiceNumber,
    creditSale.amount_due,
    creditSale.amount_paid || 0,
    creditSale.status || 'pending',
    dueDate,
    creditSale.notes || null
  ]);

  // Update customer credit_balance
  runInsert(`
    UPDATE customers 
    SET credit_balance = credit_balance + ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [creditSale.amount_due, creditSale.customer_id]);

  return { ...creditSale, id, invoice_number: invoiceNumber, due_date: dueDate };
});

ipcMain.handle('db:creditSales:update', (_, creditSale) => {
  runInsert(`
    UPDATE credit_sales 
    SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [creditSale.status, creditSale.notes || null, creditSale.id]);

  return creditSale;
});

// Credit Payments
ipcMain.handle('db:creditPayments:create', (_, payment) => {
  const id = payment.id || uuid();

  // Get the credit sale
  const creditSale = getOne('SELECT * FROM credit_sales WHERE id = ?', [payment.credit_sale_id]);
  if (!creditSale) {
    throw new Error('Credit sale not found');
  }

  // Record the payment
  runInsert(`
    INSERT INTO credit_payments (id, credit_sale_id, amount, payment_method, reference, received_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    payment.credit_sale_id,
    payment.amount,
    payment.payment_method,
    payment.reference || null,
    payment.received_by || null,
    payment.notes || null
  ]);

  // Update credit sale
  const newAmountPaid = (creditSale.amount_paid || 0) + payment.amount;
  let newStatus = 'partial';

  // Fix for floating point precision issues
  // Compare rounded values (cents)
  const paidCents = Math.round(newAmountPaid * 100);
  const dueCents = Math.round(creditSale.amount_due * 100);

  if (paidCents >= dueCents) {
    newStatus = 'paid';
  }

  runInsert(`
    UPDATE credit_sales 
    SET amount_paid = ?, status = ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0
    WHERE id = ?
  `, [newAmountPaid, newStatus, payment.credit_sale_id]);

  // Update customer credit_balance
  runInsert(`
    UPDATE customers 
    SET credit_balance = credit_balance - ?, updated_at = CURRENT_TIMESTAMP, is_synced = 0
    WHERE id = ?
  `, [payment.amount, creditSale.customer_id]);

  SyncManager.triggerSync();
  return { ...payment, id };
});

ipcMain.handle('db:creditPayments:getByCreditSale', (_, creditSaleId) => {
  return runQuery(`
    SELECT cp.*, e.name as received_by_name
    FROM credit_payments cp
    LEFT JOIN employees e ON cp.received_by = e.id
    WHERE cp.credit_sale_id = ?
    ORDER BY cp.created_at DESC
  `, [creditSaleId]);
});

ipcMain.handle('db:creditPayments:getById', (_, paymentId) => {
  return getOne(`
      SELECT cp.*, cs.invoice_number, c.name as customer_name,
             (cs.amount_due - cs.amount_paid) as remaining_balance
      FROM credit_payments cp
      JOIN credit_sales cs ON cp.credit_sale_id = cs.id
      JOIN customers c ON cs.customer_id = c.id
      WHERE cp.id = ?
    `, [paymentId]);
});

ipcMain.handle('creditPayments:printReceipt', async (_, paymentId) => {
  const payment = getOne(`
    SELECT cp.*, cs.invoice_number, c.name as customer_name,
           (cs.amount_due - cs.amount_paid) as remaining_balance
    FROM credit_payments cp
    JOIN credit_sales cs ON cp.credit_sale_id = cs.id
    JOIN customers c ON cs.customer_id = c.id
    WHERE cp.id = ?
  `, [paymentId]);

  if (!payment) {
    throw new Error('Payment not found');
  }

  return await receiptService.print(payment, { ...getShopSettingsForPrint(), type: 'credit_payment' });
});

// Customer Credit Info
ipcMain.handle('db:customers:getCreditInfo', (_, customerId) => {
  const customer = getOne(`
    SELECT id, name, email, phone, credit_enabled, credit_limit, credit_balance
    FROM customers WHERE id = ?
  `, [customerId]);

  if (customer) {
    customer.available_credit = (customer.credit_limit || 0) - (customer.credit_balance || 0);
    customer.pending_sales = runQuery(`
      SELECT COUNT(*) as count, SUM(amount_due - amount_paid) as total_pending
      FROM credit_sales
      WHERE customer_id = ? AND status IN ('pending', 'partial')
    `, [customerId])[0] || { count: 0, total_pending: 0 };
  }

  return customer;
});

ipcMain.handle('db:customers:updateCreditSettings', (_, { customerId, credit_enabled, credit_limit }) => {
  runInsert(`
    UPDATE customers 
    SET credit_enabled = ?, credit_limit = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [credit_enabled ? 1 : 0, credit_limit || 0, customerId]);

  return true;
});

// Generate invoice number handler
ipcMain.handle('db:creditSales:generateInvoiceNumber', () => {
  return generateInvoiceNumber();
});

// ==========================================
// CREDIT SALES
// ==========================================



// Credit Invoice Email
ipcMain.handle('creditInvoice:sendEmail', async (_, { creditSaleId, email }) => {
  const creditSale = getOne(`
    SELECT cs.*, s.receipt_number, s.subtotal, s.tax_amount, s.discount_amount,
           c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
    FROM credit_sales cs
    LEFT JOIN sales s ON cs.sale_id = s.id
    LEFT JOIN customers c ON cs.customer_id = c.id
    WHERE cs.id = ?
  `, [creditSaleId]);

  if (!creditSale) {
    throw new Error('Credit sale not found');
  }

  console.log('Sending Credit Invoice Email. Data:', JSON.stringify(creditSale, null, 2));

  creditSale.items = runQuery('SELECT * FROM sale_items WHERE sale_id = ?', [creditSale.sale_id]);
  creditSale.payments = runQuery('SELECT * FROM credit_payments WHERE credit_sale_id = ?', [creditSaleId]);

  // Get settings
  const rows = runQuery('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); }
    catch { settings[row.key] = row.value; }
  });

  // Initialize email service
  if (!initEmailService({
    smtp_host: settings.email_host,
    smtp_port: settings.email_port,
    smtp_user: settings.email_user,
    smtp_pass: settings.email_password,
    smtp_secure: settings.email_secure
  })) {
    throw new Error('Email service not configured');
  }

  // Generate invoice PDF
  const invoiceService = require('./services/invoiceService');
  const pdfPath = await invoiceService.generateInvoicePdf(creditSale, settings);

  try {
    const result = await invoiceService.sendInvoiceEmail({
      to: email || creditSale.customer_email,
      creditSale,
      businessInfo: {
        businessName: settings.businessName || 'afus boutique',
        businessAddress: settings.businessAddress,
        businessPhone: settings.businessPhone,
        businessEmail: settings.businessEmail
      },
      pdfPath
    });

    // Cleanup
    fs.unlink(pdfPath, () => { });

    return result;
  } catch (error) {
    fs.unlink(pdfPath, () => { });
    throw error;
  }
});

// Send payment reminder
ipcMain.handle('creditInvoice:sendReminder', async (_, { creditSaleId, email }) => {
  const creditSale = getOne(`
    SELECT cs.*, c.name as customer_name, c.email as customer_email
    FROM credit_sales cs
    LEFT JOIN customers c ON cs.customer_id = c.id
    WHERE cs.id = ?
  `, [creditSaleId]);

  if (!creditSale) {
    throw new Error('Credit sale not found');
  }

  const settings = await getSettings();

  if (!initEmailService({
    smtp_host: settings.email_host,
    smtp_port: settings.email_port,
    smtp_user: settings.email_user,
    smtp_pass: settings.email_password,
    smtp_secure: settings.email_secure
  })) {
    throw new Error('Email service not configured');
  }

  const invoiceService = require('./services/invoiceService');
  return await invoiceService.sendReminderEmail({
    to: email || creditSale.customer_email,
    creditSale,
    businessInfo: {
      businessName: settings.businessName || 'afus boutique',
      businessPhone: settings.businessPhone,
      businessEmail: settings.businessEmail
    }
  });
});

console.log('Electron main process started (Phase 5 - Credit Sales enabled)');



// ==========================================
// Receipt & Print Handlers
// ==========================================






// Gift Card PDF & Emailhandlers
ipcMain.handle('giftCards:savePdf', async (_, giftCard) => {
  try {
    const dialogResult = await dialog.showSaveDialog({
      title: shopT('dialog.saveGiftCard'),
      defaultPath: `GiftCard_${giftCard.code}.pdf`,
      filters: [{ name: shopT('dialog.pdfFiles'), extensions: ['pdf'] }]
    });

    if (dialogResult.canceled) return null;

    const receiptService = new ReceiptService();
    const settings = getOne("SELECT value FROM settings WHERE key = 'store_config'") || {};
    let storeSettings = {};
    try { storeSettings = JSON.parse(settings.value); } catch (e) { console.error(e); }

    const pdfPath = await receiptService.generateGiftCardPdf(giftCard, storeSettings, dialogResult.filePath);
    return pdfPath;
  } catch (error) {
    console.error('Failed to save Gift Card PDF:', error);
    throw error;
  }
});

ipcMain.handle('email:sendGiftCard', async (_, { giftCard, email }) => {
  try {
    const receiptService = new ReceiptService();

    // Get all settings (Same approach as creditInvoice:sendEmail for consistency)
    const rows = runQuery('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(row => {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    });

    // Merge structured settings if they exist (compatibility with new SettingsPage structure)
    // Structure from SettingsPage: { host, port, user, pass, secure }
    if (settings.email_settings) {
      settings.email_host = settings.email_settings.host || settings.email_host;
      settings.email_port = settings.email_settings.port || settings.email_port;
      settings.email_user = settings.email_settings.user || settings.email_user;
      settings.email_password = settings.email_settings.pass || settings.email_password;
      settings.email_secure = settings.email_settings.secure !== undefined ? settings.email_settings.secure : settings.email_secure;
    }

    // Structure from SettingsPage: { businessName, etc }
    if (settings.store_config) {
      Object.assign(settings, settings.store_config);
    }

    // Generate PDF to temp path
    const pdfPath = await receiptService.generateGiftCardPdf(giftCard, settings);

    // Init service
    // Using require here to ensure access if global scope is ambiguous
    const emailService = require('./services/emailService');

    const emailConfig = {
      smtp_host: settings.email_host,
      smtp_port: settings.email_port,
      smtp_user: settings.email_user,
      smtp_pass: settings.email_password,
      smtp_secure: settings.email_secure
    };

    if (emailService.initEmailService(emailConfig)) {
      await emailService.sendEmail({
        to: email,
        subject: `Your Gift Card from ${settings.businessName || 'afus boutique'}`,
        html: `
                <h2>Here is your Gift Card!</h2>
                <p>Enjoy your gift card of <strong>${receiptService.formatCurrency(giftCard.current_balance)}</strong>.</p>
                <p>Please find the printable card attached.</p>
                <br>
                <p>Thank you!</p>
            `,
        attachments: [{
          filename: `GiftCard_${giftCard.code}.pdf`,
          path: pdfPath
        }]
      });
      return true;
    } else {
      throw new Error("Failed to initialize email service");
    }

  } catch (error) {
    console.error('Failed to send Gift Card Email:', error);
    throw error;
  }
});

// End of file
