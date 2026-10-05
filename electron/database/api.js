/**
 * Database adapter used by the services in electron/services.
 * Unlike runQuery in init.js (which logs and returns no rows), every call here throws on error so a
 * failing statement can never go unnoticed (or be half-applied inside a
 * transaction).
 */
const { v4: uuid } = require('uuid');
const { getDatabase, runStatement, runTransaction, bindable } = require('./init');

function all(sql, params = []) {
    const stmt = getDatabase().prepare(sql);
    try {
        stmt.bind(bindable(params));
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
    } finally {
        stmt.free();
    }
}

function get(sql, params = []) {
    return all(sql, params)[0] || null;
}

module.exports = {
    all,
    get,
    run: runStatement,
    transaction: runTransaction,
    uuid: () => uuid(),
};
