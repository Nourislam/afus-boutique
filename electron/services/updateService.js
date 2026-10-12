/**
 * Is there a newer version? The installer profile (electron/shared/
 * profile.json › updateUrl) points at a small JSON file published by the
 * reseller: { "version": "1.2.0", "url": "<https address of the installer>", "notes": "…" }.
 * Nothing is downloaded or installed by itself: the shop sees the new
 * version in Settings and opens the download page. Without internet or
 * without an address, nothing happens.
 */
function compareVersions(a, b) {
    const pa = String(a || '0').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
    }
    return 0;
}

/** What the published file says, checked (only http(s) download links). */
function readRelease(json, currentVersion) {
    const version = json && typeof json.version === 'string' ? json.version.trim() : '';
    const url = json && typeof json.url === 'string' && /^https?:\/\//i.test(json.url) ? json.url : null;
    if (!version) return { available: false };
    return { available: compareVersions(version, currentVersion) > 0, version, url, notes: typeof json.notes === 'string' ? json.notes.slice(0, 2000) : '' };
}

// Only when the shop presses "check" in Settings › About and the reseller set an address
async function checkForUpdate(updateUrl, currentVersion, fetchImpl = (...args) => fetch(...args)) {
    if (!updateUrl || !/^https?:\/\//i.test(updateUrl)) return { available: false, configured: false };
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetchImpl(updateUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
        clearTimeout(timer);
        if (!response.ok) return { available: false, configured: true, error: 'UPDATE_UNREACHABLE' };
        return { configured: true, ...readRelease(await response.json(), currentVersion) };
    } catch {
        return { available: false, configured: true, error: 'UPDATE_UNREACHABLE' };
    }
}

module.exports = { compareVersions, readRelease, checkForUpdate };
