/**
 * Who may call what. Every channel that changes the shop's data is checked
 * here, in the main process, against the employee logged in with a PIN
 * (session.js) and the same role table the window uses
 * (shared/permissions.mjs). A button hidden in the window is then also a call
 * refused if it is made by hand (developer tools, a modified window).
 *
 * A rule is:
 *   'login'           someone is logged in (any role)
 *   'admin'           the owner only
 *   '<permission>'    the role has this permission (e.g. 'products.edit')
 *   [a, b]            any one of these
 *   (args) => rule    decided from the call's arguments
 *
 * Before the shop is set up (setup wizard, nobody can log in yet) every call
 * is allowed: there is nothing to protect and the wizard creates the owner.
 */
const session = require('./session');
const { codedError } = require('./catalogService');
const { hasPermission, PERMISSIONS: P } = require('../shared/permissions.mjs');

/** Settings a manager may change (everything else is the owner's). */
const SETTING_RULES = {
    catalog_custom: P.PRODUCTS_EDIT,
    security: 'admin',
    pos_controls: 'admin',
    loyalty: 'admin',
};

const RULES = {
    // Employees and the shop's settings
    'db:employees:create': P.EMPLOYEES_MANAGE,
    'db:employees:update': P.EMPLOYEES_MANAGE,
    'db:employees:delete': P.EMPLOYEES_MANAGE,
    'db:settings:set': (args) => SETTING_RULES[args?.key] || P.SETTINGS_VIEW,
    'db:settings:delete': (key) => SETTING_RULES[key] || P.SETTINGS_VIEW,
    'images:saveLogo': P.SETTINGS_VIEW,

    // Backups and online store: the owner's
    'support:bundle': P.SETTINGS_VIEW,
    'license:set': 'admin',
    'demo:discard': 'admin',
    'update:open': P.SETTINGS_VIEW,
    'support:openLogs': P.SETTINGS_VIEW,
    'backup:list': 'admin',
    'backup:create': 'admin',
    'backup:inspect': 'admin',
    'backup:restore': 'admin',
    'backup:delete': 'admin',
    'backup:export': 'admin',
    'backup:import': 'admin',
    'backup:openFolder': 'admin',
    'backup:reset': 'admin',
    'backup:chooseExternal': 'admin',
    'backup:clearExternal': 'admin',
    'sync:set-token': 'admin',
    'sync:force-push': 'admin',
    'ecommerce:addConnection': 'admin',
    'ecommerce:testConnection': 'admin',
    'ecommerce:removeConnection': 'admin',
    'ecommerce:sync': 'admin',
    'ecommerce:syncAll': 'admin',
    'ecommerce:autoMapProducts': 'admin',
    'ecommerce:createMapping': 'admin',
    'ecommerce:deleteMapping': 'admin',
    'ecommerce:oauth:start': 'admin',
    'ecommerce:oauth:complete': 'admin',

    // Articles
    'catalog:saveProduct': [P.PRODUCTS_CREATE, P.PRODUCTS_EDIT],
    'catalog:regenerateQr': P.PRODUCTS_EDIT,
    'db:products:create': P.PRODUCTS_CREATE,
    'db:products:update': P.PRODUCTS_EDIT,
    'db:products:delete': P.PRODUCTS_DELETE,
    'db:brands:create': P.PRODUCTS_CREATE,
    'db:brands:update': P.PRODUCTS_EDIT,
    'db:brands:delete': P.PRODUCTS_EDIT,
    'db:categories:create': [P.PRODUCTS_CREATE, P.PRODUCTS_EDIT],
    'db:categories:update': P.PRODUCTS_EDIT,
    'db:categories:delete': P.PRODUCTS_EDIT,
    'excel:importProducts': P.PRODUCTS_CREATE,
    'images:save': 'login',
    'images:saveFromPath': 'login',
    'images:delete': [P.PRODUCTS_CREATE, P.PRODUCTS_EDIT],

    // Stock, suppliers, purchases
    'db:products:updateStock': P.INVENTORY_ADJUST,
    'stockCount:start': P.INVENTORY_ADJUST,
    'stockCount:scan': P.INVENTORY_ADJUST,
    'stockCount:setCounted': P.INVENTORY_ADJUST,
    'stockCount:removeLine': P.INVENTORY_ADJUST,
    'stockCount:cancel': P.INVENTORY_ADJUST,
    'stockCount:confirm': P.INVENTORY_ADJUST,
    'db:suppliers:create': P.INVENTORY_ADJUST,
    'db:suppliers:update': P.INVENTORY_ADJUST,
    'db:suppliers:delete': P.INVENTORY_ADJUST,
    'db:supplierPayments:create': P.INVENTORY_ADJUST,
    'db:purchaseReturns:create': P.INVENTORY_ADJUST,
    'db:purchaseOrders:create': P.INVENTORY_ADJUST,
    'db:purchaseOrders:delete': P.INVENTORY_ADJUST,
    'db:purchaseOrders:receiveStock': P.INVENTORY_ADJUST,
    'db:receivings:create': P.INVENTORY_ADJUST,
    'db:supplierInvoices:create': P.INVENTORY_ADJUST,
    'email:sendPurchaseOrder': P.INVENTORY_ADJUST,

    // Customers and kridi
    'db:customers:create': P.CUSTOMERS_CREATE,
    'db:customers:update': P.CUSTOMERS_EDIT,
    'db:customers:delete': P.CUSTOMERS_DELETE,
    'db:customers:updateCreditSettings': P.CUSTOMERS_CREDIT,
    'db:creditSales:create': 'login',
    'db:creditSales:update': 'login',
    'db:creditPayments:create': 'login',
    'creditInvoice:sendEmail': 'login',
    'creditInvoice:sendReminder': 'login',

    // Offers
    'db:giftCards:create': P.GIFT_CARDS_CREATE,
    'db:giftCards:update': P.GIFT_CARDS_CREATE,
    'db:giftCards:reload': P.GIFT_CARDS_RELOAD,
    'db:giftCards:redeem': 'login',
    'loyalty:redeem': P.GIFT_CARDS_CREATE,
    'db:bundles:create': P.BUNDLES_MANAGE,
    'db:bundles:update': P.BUNDLES_MANAGE,
    'db:bundles:delete': P.BUNDLES_MANAGE,
    'db:bundles:assemble': P.BUNDLES_MANAGE,
    'db:bundles:disassemble': P.BUNDLES_MANAGE,
    'db:promotions:create': P.PROMOTIONS_MANAGE,
    'db:promotions:update': P.PROMOTIONS_MANAGE,
    'db:promotions:delete': P.PROMOTIONS_MANAGE,
    'insights:markdownDecide': P.PROMOTIONS_MANAGE,
    'db:promotions:incrementUse': 'login',

    // Selling and the cash drawer
    'db:sales:create': 'login',
    'reservations:create': 'login',
    'reservations:cancel': 'login',
    'db:held:create': 'login',
    'db:held:delete': 'login',
    'db:returns:create': 'login',
    'db:exchanges:create': 'login',
    'db:receipts:create': 'login',
    'db:receipts:updateStatus': 'login',
    'db:quotations:create': 'login',
    'db:shifts:start': 'login',
    'db:shifts:end': 'login',
    'db:shifts:addExpense': 'login',
    'shifts:printZ': 'login',
    'shifts:zReportHtml': 'login',
    'email:sendReceipt': 'login',
    'email:sendGiftCard': 'login',
};

/** Does this employee satisfy the rule? (pure; used by the tests too) */
function allows(rule, employee, args) {
    if (typeof rule === 'function') return allows(rule(args), employee, args);
    if (Array.isArray(rule)) return rule.some(r => allows(r, employee, args));
    if (!employee || !employee.id) return false;
    if (rule === 'login') return true;
    if (rule === 'admin') return employee.role === 'admin';
    return hasPermission(employee.role, rule);
}

/** Refuse the call with the right message, or return quietly. */
function check(channel, args, { isFirstSetup = () => false } = {}) {
    let rule = RULES[channel];
    if (!rule || isFirstSetup()) return;
    if (typeof rule === 'function') rule = rule(args);
    const employee = session.getEmployee();
    if (allows(rule, employee, args)) return;
    if (!employee) throw codedError('LOGIN_REQUIRED', {});
    throw codedError(rule === 'admin' ? 'ADMIN_REQUIRED' : 'NO_PERMISSION', {});
}

/**
 * Check every ipcMain.handle registered from now on. Installed once, before
 * any handler, so a new channel listed in RULES is protected wherever it is
 * registered (main.js, the online store module).
 */
function install(ipcMain, options = {}) {
    if (ipcMain.__guarded) return;
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => {
        if (!RULES[channel]) return handle(channel, handler);
        return handle(channel, (event, ...args) => {
            check(channel, args[0], options);
            return handler(event, ...args);
        });
    };
    ipcMain.__guarded = true;
}

module.exports = { RULES, allows, check, install };
