/**
 * Demo shop: a complete clothing shop in its own folder and file
 * (<data folder>/demo/afus-boutique-demo.db, pictures in demo/images), never
 * in the shop's database. Switching only changes which file the program has
 * open (database/init.js "profile"); the shop's file is closed untouched and
 * opened again as it was.
 *
 *   enter()  open the demo shop (created and filled the first time)
 *   reset()  throw the demo shop away and build it again as at the start
 *   exit()   back to the shop's own data; nothing is copied over
 *
 * The program always starts on the shop's own data.
 */
const fs = require('fs');
const path = require('path');
const init = require('../database/init');
const dbApi = require('../database/api');
const { seedDemoShop } = require('./demoData');

const demoFolder = () => {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), init.DEMO_FOLDER);
};

/** Build the demo shop in the (empty, open) demo database. */
function build(lang) {
    const imagesDir = path.join(demoFolder(), 'images');
    let summary = null;
    // One transaction: written to the demo file once, when it is committed
    dbApi.transaction(() => {
        summary = seedDemoShop(dbApi, { lang, imagesDir, now: new Date() });
    });
    return summary;
}

/**
 * Open the demo shop. lang: language of a demo shop created now.
 * @returns {{ created: boolean, summary: object|null }}
 */
async function enter({ lang = 'ar' } = {}) {
    if (init.isDemo()) return { created: false, summary: null };
    // The shop's data is on disk after every change; nothing is written now
    init.setProfile('demo');
    const exists = fs.existsSync(init.getDbPath());
    try {
        await init.initDatabase();
        const summary = exists && isFilled() ? null : build(lang);
        return { created: !!summary, summary };
    } catch (error) {
        // Could not open the demo: back to the shop as it was
        init.setProfile('real');
        await init.initDatabase();
        throw error;
    }
}

/** A demo database that was really filled (not a file left half-made). */
function isFilled() {
    try { return !!dbApi.get("SELECT 1 AS ok FROM settings WHERE key = 'demo_shop'"); } catch { return false; }
}

/** The demo shop again as at the start (the demo folder only). */
async function reset({ lang = 'ar' } = {}) {
    if (!init.isDemo()) throw new Error('DEMO_NOT_ACTIVE|{}');
    init.closeDatabase();
    const folder = demoFolder();
    // Safety: only ever the demo folder inside the data folder
    const { app } = require('electron');
    if (path.resolve(folder) === path.resolve(app.getPath('userData')) || path.basename(folder) !== init.DEMO_FOLDER) throw new Error('Refused: not the demo folder');
    fs.rmSync(folder, { recursive: true, force: true });
    init.setProfile('demo');
    await init.initDatabase();
    return { summary: build(lang) };
}

/** Back to the shop's own data. Nothing from the demo is carried over. */
async function exit() {
    if (!init.isDemo()) return { exited: false };
    init.closeDatabase();
    init.setProfile('real');
    await init.initDatabase();
    return { exited: true };
}

module.exports = { enter, reset, exit, isFilled, demoFolder };
