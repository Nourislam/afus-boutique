import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Globe, Github, Cloud, Copy, RefreshCw, Palette, CheckCircle2, Circle, Link2, Sparkles, Package, Tag, Image as ImageIcon, Shirt, PackageCheck, X,
    XCircle, Clock, Loader2, ShoppingBag,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { StatTile } from '../components/ui/StatTile';
import { toast } from '../components/ui/Toast';
import { translateError } from '../i18n/errors';
import { formatDate, formatNumber } from '../i18n/format';
import { useT } from '../i18n';

const STATUS_STYLE = {
    none: 'bg-zinc-500/20 text-zinc-300',
    accounts: 'bg-amber-500/15 text-amber-300',
    ready: 'bg-sky-500/15 text-sky-300',
    live: 'bg-emerald-500/15 text-emerald-300',
    error: 'bg-red-500/15 text-red-300',
};
const ACCOUNT_STYLE = {
    not_connected: 'bg-zinc-500/20 text-zinc-300',
    connected: 'bg-emerald-500/15 text-emerald-300',
    choose_account: 'bg-amber-500/15 text-amber-300',
    failed: 'bg-red-500/15 text-red-300',
    waiting: 'bg-indigo-500/15 text-indigo-300',
};
const GITHUB_STYLE = {
    not_connected: 'bg-zinc-500/20 text-zinc-300',
    connected: 'bg-emerald-500/15 text-emerald-300',
    failed: 'bg-red-500/15 text-red-300',
};

/**
 * Website Manager: the shop's own website, in the shop's words. A name for
 * the free address, a theme, the two accounts it is published with and an
 * optional own domain. Nothing technical is asked (no repository, token,
 * DNS...): the program chooses all that when the accounts are linked.
 */
export default function WebsitePage() {
    const { t } = useT();
    const [site, setSite] = useState(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            const [view, figures] = await Promise.all([window.electronAPI.website.getState(), window.electronAPI.website.preview()]);
            setSite(view);
            setPreview(figures);
            return view;
        } catch (error) {
            toast.error(translateError(error));
            setSite((s) => s || { created: false, status: 'none', themes: [], providers: {}, steps: [] });
        }
    }, []);
    useEffect(() => {
        // A linked GitHub account: is its key still accepted? (quietly, in the background)
        load().then((view) => {
            if (view?.accounts?.github?.status === 'connected') {
                window.electronAPI.website.githubCheck().then(setSite).catch(() => {});
            }
            if (view?.accounts?.cloudflare?.status === 'connected') {
                window.electronAPI.website.cloudflareCheck().then(setSite).catch(() => {});
            }
        });
    }, [load]);

    // One action at a time; the screen shows the answer of the main process
    const run = async (id, fn, done) => {
        setBusy(id);
        try {
            const next = await fn();
            if (next) setSite(next);
            done?.(next);
        } catch (error) {
            toast.error(translateError(error));
        } finally {
            setBusy('');
        }
    };

    if (!site) {
        return <div className="page"><div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div></div>;
    }

    return (
        <div className="page" data-testid="website-page">
            <PageHeader icon={Globe} title={t('website.title')} subtitle={t('website.subtitle')} />
            <div className="page-body">
                {site.created
                    ? <WebsiteDashboard site={site} setSite={setSite} preview={preview} busy={busy} run={run} reloadPreview={load} />
                    : <CreateWebsite site={site} busy={busy} run={run} />}
            </div>
        </div>
    );
}

/** First visit: a name for the free address and a theme, then one button. */
function CreateWebsite({ site, busy, run }) {
    const { t } = useT();
    const [name, setName] = useState(site.suggestedName || '');
    const [theme, setTheme] = useState(site.theme);
    const create = () => run('create', () => window.electronAPI.website.create({ name, theme }), () => toast.success(t('website.created')));
    return (
        <div className="max-w-3xl mx-auto space-y-5" data-testid="website-create">
            <section className="card text-center space-y-3 py-8">
                <span className="w-14 h-14 rounded-2xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center mx-auto"><Globe className="w-7 h-7" /></span>
                <h2 className="text-xl font-bold">{t('website.createTitle')}</h2>
                <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">{t('website.createText')}</p>
            </section>

            <section className="card space-y-3">
                <h3 className="font-semibold">{t('website.nameTitle')}</h3>
                <p className="text-xs text-zinc-500">{t('website.nameHint')}</p>
                <AddressField value={name} onChange={setName} owner={site.freeOwner} />
            </section>

            <section className="card space-y-3">
                <h3 className="font-semibold flex items-center gap-2"><Palette className="w-4 h-4 text-indigo-300" /> {t('website.theme')}</h3>
                <ThemePicker themes={site.themes} value={theme} onChange={setTheme} />
            </section>

            <div className="flex justify-center">
                <Button size="lg" onClick={create} loading={busy === 'create'} disabled={!name.trim()} data-testid="website-create-btn">
                    <Sparkles className="w-5 h-5" /> {t('website.create')}
                </Button>
            </div>
        </div>
    );
}

/** "https://<account>.github.io/" [name] "/": the shop types only its name. */
function AddressField({ value, onChange, owner }) {
    const { t } = useT();
    return (
        <div dir="ltr" className="flex items-stretch rounded-lg border border-dark-border bg-dark-secondary overflow-hidden focus-within:border-indigo-500">
            <span className="px-3 flex items-center text-sm text-zinc-500 bg-dark-tertiary/60 flex-none max-w-[45%] truncate">{`https://${owner || '…'}.github.io/`}</span>
            <input
                className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm font-mono outline-none"
                value={value}
                onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                maxLength={40}
                aria-label={t('website.nameTitle')}
                data-testid="website-name"
            />
            <span className="px-3 flex items-center text-sm text-zinc-500 bg-dark-tertiary/60 flex-none">/</span>
        </div>
    );
}

/** A theme's name / description in the window's language (they come with the theme). */
const themeText = (theme, key, lang) => theme?.[key]?.[lang] || theme?.[key]?.ar || theme?.id || '';

/**
 * A small drawing of a theme's home page from its own choices: header kind,
 * colours, title font, card shape. No picture of the shop is needed.
 */
function ThemeThumb({ theme }) {
    const c = theme.colors;
    const look = theme.look || {};
    const bold = look.header === 'bold';
    const centered = look.header === 'centered';
    const ratio = { '1/1': 1, '4/5': 1.25, '3/4': 1.33, '2/3': 1.5 }[look.ratio] || 1.33;
    const r = Math.min(10, look.radius ?? 6);
    return (
        <span className="block rounded-lg overflow-hidden border border-black/10" style={{ background: c.background }} aria-hidden="true">
            <span className={`flex items-center gap-1.5 px-2 h-5 ${centered ? 'justify-center' : ''}`} style={{ background: bold ? c.primary : c.background, borderBottom: `1px solid ${c.border}` }}>
                <span className="block h-1.5 w-8 rounded-sm" style={{ background: bold ? c.onPrimary : c.text }} />
                {!centered && [0, 1, 2].map(i => <span key={i} className="block h-1 w-4 rounded-sm opacity-50" style={{ background: bold ? c.onPrimary : c.muted }} />)}
            </span>
            <span className="flex items-center gap-2 px-2 py-2" style={{ background: c.surface }}>
                <span className="text-base leading-none" style={{ fontFamily: look.headingFont, fontWeight: look.headingWeight, color: c.text, textTransform: look.headingCase === 'upper' ? 'uppercase' : 'none' }}>Aa</span>
                <span className="flex-1 h-1.5 rounded-sm opacity-40" style={{ background: c.muted }} />
                <span className="block h-3 w-8" style={{ background: c.primary, borderRadius: Math.min(look.buttonRadius ?? 6, 8) }} />
            </span>
            <span className="grid grid-cols-4 gap-1.5 p-2">
                {[0, 1, 2, 3].map(i => (
                    <span key={i} className="block" style={{ aspectRatio: `1 / ${ratio}`, background: i === 1 ? c.accent : `${c.text}14`, borderRadius: r, border: look.card === 'bordered' ? `1px solid ${c.border}` : 0 }} />
                ))}
            </span>
        </span>
    );
}

function ThemePicker({ themes = [], value, onChange, disabled, current }) {
    const { t, lang } = useT();
    return (
        <div className="grid fit-grid-sm gap-3" role="radiogroup" aria-label={t('website.theme')}>
            {themes.map(theme => {
                const active = theme.id === value;
                return (
                    <button key={theme.id} type="button" role="radio" aria-checked={active} disabled={disabled} onClick={() => onChange(theme.id)}
                        data-testid={`website-theme-${theme.id}`}
                        className={`rounded-xl border p-3 text-start transition-colors ${active ? 'border-indigo-500 bg-indigo-500/10' : 'border-dark-border hover:border-zinc-500'}`}>
                        <ThemeThumb theme={theme} />
                        <span className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{themeText(theme, 'name', lang)}</span>
                            {current === theme.id
                                ? <span className="badge bg-emerald-500/15 text-emerald-300 whitespace-nowrap">{t('website.themeCurrent')}</span>
                                : active && <CheckCircle2 className="w-4 h-4 text-indigo-300 flex-none" />}
                        </span>
                        <span className="block text-xs text-zinc-500 leading-snug mt-1">{themeText(theme, 'description', lang)}</span>
                    </button>
                );
            })}
        </div>
    );
}

const PREVIEW_PAGES = ['home', 'category', 'product'];
const PREVIEW_WIDTH = { desktop: 1280, mobile: 390 };
const PREVIEW_HEIGHT = 620;

/**
 * Themes of the website: pick one to see the shop's own website in it
 * (home, a category, an article; computer or phone), then keep it. The
 * page is drawn by the program from the shop's data and shown in a frame
 * that runs no script and cannot reach the program.
 */
function ThemeStudio({ site, busy, run }) {
    const { t, lang } = useT();
    const api = window.electronAPI.website;
    const [picked, setPicked] = useState(site.theme);
    const [page, setPage] = useState('home');
    const [device, setDevice] = useState('desktop');
    const [preview, setPreview] = useState(null);
    const [failed, setFailed] = useState(false);
    const box = useRef(null);
    const [boxWidth, setBoxWidth] = useState(800);

    useEffect(() => { setPicked(site.theme); }, [site.theme]);
    useEffect(() => {
        let alive = true;
        setFailed(false);
        api.previewTheme({ theme: picked, page }).then((r) => { if (alive) setPreview(r); }, () => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [picked, page]);
    useEffect(() => {
        if (!box.current || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);

    const width = PREVIEW_WIDTH[device];
    // Slightly under the measured width, so rounding never pushes the frame out
    const scale = Math.min(1, Math.max(0.1, (boxWidth - 2) / width));
    const chosen = site.themes.find(x => x.id === picked);
    const keep = () => run('theme', () => api.setTheme(picked), () => toast.success(t('website.themeSaved')));

    return (
        <section className="card space-y-4 xl:col-span-2" data-testid="website-theme">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold flex items-center gap-2"><Palette className="w-4 h-4 text-indigo-300" /> {t('website.theme')}</h2>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t('website.themeHint')}</p>
                </div>
            </div>
            <ThemePicker themes={site.themes} value={picked} current={site.theme} disabled={busy === 'theme'} onChange={setPicked} />

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1 rounded-lg bg-dark-tertiary/60 p-1" role="tablist" aria-label={t('website.previewPage')}>
                    {PREVIEW_PAGES.map(p => (
                        <button key={p} type="button" role="tab" aria-selected={page === p} onClick={() => setPage(p)} data-testid={`website-preview-page-${p}`}
                            className={`px-3 py-1.5 rounded-md text-sm ${page === p ? 'bg-dark-secondary text-white' : 'text-zinc-400 hover:text-white'}`}>
                            {t(`website.previewPages.${p}`)}
                        </button>
                    ))}
                </div>
                <div className="flex gap-1 rounded-lg bg-dark-tertiary/60 p-1" role="tablist" aria-label={t('website.previewDevice')}>
                    {['desktop', 'mobile'].map(d => (
                        <button key={d} type="button" role="tab" aria-selected={device === d} onClick={() => setDevice(d)} data-testid={`website-preview-device-${d}`}
                            className={`px-3 py-1.5 rounded-md text-sm ${device === d ? 'bg-dark-secondary text-white' : 'text-zinc-400 hover:text-white'}`}>
                            {t(`website.previewDevices.${d}`)}
                        </button>
                    ))}
                </div>
            </div>

            {/* The outer line is measured (full width); the frame box inside takes the device's width */}
            <div ref={box} className="w-full">
            <div className="relative rounded-xl border border-dark-border bg-white overflow-hidden mx-auto" style={{ width: Math.floor(width * scale), maxWidth: '100%', height: PREVIEW_HEIGHT }}>
                {failed ? (
                    <p className="p-6 text-sm text-zinc-500">{t('website.previewFailed')}</p>
                ) : preview && (
                    <iframe
                        title={t('website.previewTitle', { name: themeText(chosen, 'name', lang) })}
                        // No script, no access to the program, no navigation
                        sandbox=""
                        referrerPolicy="no-referrer"
                        srcDoc={preview.html}
                        data-testid="website-preview-frame"
                        data-theme={preview.theme}
                        // Laid out at the device's width, then drawn smaller from the box's
                        // top-left corner (the same in every language: the page has its own direction)
                        style={{ position: 'absolute', top: 0, left: 0, width, height: PREVIEW_HEIGHT / scale, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, display: 'block' }}
                    />
                )}
            </div>
            </div>
            {preview && preview.products === 0 && <p className="text-xs text-amber-300">{t('website.previewEmpty')}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 leading-relaxed max-w-xl">{t('website.themeSafe')}</p>
                {picked === site.theme
                    ? <span className="badge bg-emerald-500/15 text-emerald-300" data-testid="website-theme-current">{t('website.themeInUse', { name: themeText(chosen, 'name', lang) })}</span>
                    : (
                        <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setPicked(site.theme)}>{t('common.cancel')}</Button>
                            <Button size="sm" onClick={keep} loading={busy === 'theme'} data-testid="website-theme-use">
                                <CheckCircle2 className="w-4 h-4" /> {t('website.themeUse', { name: themeText(chosen, 'name', lang) })}
                            </Button>
                        </div>
                    )}
            </div>
        </section>
    );
}

function WebsiteDashboard({ site, setSite, preview, busy, run }) {
    const { t } = useT();

    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" data-testid="website-dashboard">
            {/* Create Website / Update website: requirements, progress, address */}
            <PublishPanel site={site} setSite={setSite} busy={busy} run={run} />

            {/* Free Website URL */}
            <section className="card space-y-3" data-testid="website-url">
                <h2 className="font-semibold flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-300" /> {t('website.freeUrl')}</h2>
                <p dir="ltr" className="font-mono text-sm break-all rounded-lg bg-dark-tertiary/60 px-3 py-2" data-testid="website-free-url">{site.freeUrl}</p>
                <p className="text-xs text-zinc-500">{site.status === 'live' ? t('website.urlLive') : site.freeOwner ? t('website.urlSoon') : t('website.urlAfterGithub')}</p>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(site.freeUrl).then(() => toast.success(t('website.copied')), () => {}); }}>
                        <Copy className="w-4 h-4" /> {t('website.copy')}
                    </Button>
                    {!site.publishedAt && <RenameAddress site={site} busy={busy} run={run} />}
                </div>
            </section>

            {/* Theme: pick, see the shop's own website in it, keep */}
            <ThemeStudio site={site} busy={busy} run={run} />

            {/* Connect GitHub / Connect Cloudflare */}
            <section className="card space-y-3" data-testid="website-accounts">
                <h2 className="font-semibold">{t('website.accounts')}</h2>
                <p className="text-xs text-zinc-500">{t('website.accountsHint')}</p>
                <ul className="space-y-2">
                    <GithubAccount site={site} setSite={setSite} busy={busy} run={run} />
                    <CloudflareAccount site={site} setSite={setSite} busy={busy} run={run} />
                </ul>
            </section>

            {/* Order requests customers sent from the website */}
            {site.hasOrders && <WebsiteOrders />}

            {/* What the website will show (read from the catalogue) */}
            <section className="card space-y-3 xl:col-span-2" data-testid="website-preview">
                <h2 className="font-semibold">{t('website.showsTitle')}</h2>
                {preview ? (
                    <div className="grid fit-grid-sm gap-3">
                        <StatTile icon={Package} label={t('website.shows.products')} value={formatNumber(preview.products)} />
                        <StatTile icon={PackageCheck} label={t('website.shows.available')} value={formatNumber(preview.available)} iconTone="bg-emerald-500/15 text-emerald-300" />
                        <StatTile icon={Tag} label={t('website.shows.onSale')} value={formatNumber(preview.onSale)} iconTone="bg-amber-500/15 text-amber-300" />
                        <StatTile icon={ImageIcon} label={t('website.shows.withImages')} value={formatNumber(preview.withImages)} iconTone="bg-sky-500/15 text-sky-300" />
                        <StatTile icon={Shirt} label={t('website.shows.categories')} value={formatNumber(preview.categories)} />
                    </div>
                ) : <p className="text-sm text-zinc-500">…</p>}
                <p className="text-xs text-zinc-500">{t('website.showsHint')}</p>
            </section>

            {/* Custom Domain (optional) */}
            <CustomDomain site={site} busy={busy} run={run} />
        </div>
    );
}

function RenameAddress({ site, busy, run }) {
    const { t } = useT();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(site.name);
    if (!open) return <Button size="sm" variant="ghost" onClick={() => { setName(site.name); setOpen(true); }}>{t('website.rename')}</Button>;
    return (
        <div className="w-full space-y-2">
            <AddressField value={name} onChange={setName} owner={site.freeOwner} />
            <div className="flex gap-2">
                <Button size="sm" onClick={() => run('rename', () => window.electronAPI.website.setName(name), () => { setOpen(false); toast.success(t('website.renamed')); })} loading={busy === 'rename'}>{t('common.save')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            </div>
        </div>
    );
}

function CustomDomain({ site, busy, run }) {
    const { t } = useT();
    const [domain, setDomain] = useState('');
    const api = window.electronAPI.website;
    const has = !!site.domain?.name;
    return (
        <section className="card space-y-3" data-testid="website-domain">
            <h2 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-indigo-300" /> {t('website.domain')} <span className="badge bg-dark-tertiary text-zinc-400">{t('common.optional')}</span></h2>
            <p className="text-xs text-zinc-500 leading-relaxed">{t('website.domainHint')}</p>
            {has ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-dark-tertiary/60 px-3 py-2">
                        <span dir="ltr" className="font-mono text-sm flex-1 min-w-0 break-all">{site.domain.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => run('domain', () => api.removeDomain())} title={t('website.domainRemove')} aria-label={t('website.domainRemove')}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                    <span className="badge bg-amber-500/15 text-amber-300">{t(`website.domainStatus.${site.domain.status}`)}</span>
                    <p className="text-xs text-zinc-500">{t('website.domainPendingHint')}</p>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <input dir="ltr" className="input flex-1 min-w-[12rem] font-mono" placeholder="boutique-yasmine.com" value={domain}
                        onChange={(e) => setDomain(e.target.value)} aria-label={t('website.domain')} data-testid="website-domain-input" />
                    <Button variant="secondary" onClick={() => run('domain', () => api.setDomain(domain), () => { setDomain(''); toast.success(t('website.domainSaved')); })}
                        loading={busy === 'domain'} disabled={!domain.trim()} data-testid="website-domain-save">
                        {t('common.save')}
                    </Button>
                </div>
            )}
        </section>
    );
}

/**
 * The shop's own GitHub account: Not connected, Connected (@login) or
 * Connection failed (with the reason, in the shop's words). While GitHub's
 * page is open the short code is shown here and the screen asks the program
 * every 2 seconds whether the shop agreed.
 */
function GithubAccount({ site, setSite, busy, run }) {
    const { t } = useT();
    const api = window.electronAPI.website;
    const account = site.accounts?.github || { status: 'not_connected' };
    const flow = site.githubFlow;
    const available = site.providers?.github?.available;
    const [now, setNow] = useState(Date.now());
    const waiting = useRef(false);

    useEffect(() => {
        if (!flow) return undefined;
        waiting.current = true;
        const timer = setInterval(() => {
            setNow(Date.now());
            api.getState().then(setSite).catch(() => {});
        }, 2000);
        return () => clearInterval(timer);
    }, [flow?.userCode]);

    // The wait ended: linked, or why not
    useEffect(() => {
        if (flow || !waiting.current) return;
        waiting.current = false;
        if (account.status === 'connected') toast.success(t('website.account.linked', { name: t('website.account.github') }));
        else if (account.status === 'failed') toast.error(t(`website.github.error.${account.error || 'unknown'}`), 6000);
    }, [flow, account.status]);

    const start = () => run('github', () => api.githubStart(), (next) => {
        const r = next?.result;
        if (r && !r.started) {
            if (r.reason === 'not_configured') toast.info(t('website.github.notConfigured'), 7000);
            else toast.error(t(`website.github.error.${r.reason || 'unknown'}`), 6000);
        }
    });
    const disconnect = () => {
        if (!confirm(t('website.github.disconnectConfirm'))) return;
        run('github', () => api.githubDisconnect(), () => toast.success(t('website.github.disconnected')));
    };
    const copy = () => navigator.clipboard?.writeText(flow.userCode).then(() => toast.success(t('website.github.codeCopied')), () => {});
    const minutes = flow ? Math.max(0, Math.ceil((Date.parse(flow.expiresAt) - now) / 60000)) : 0;

    return (
        <li className="rounded-lg border border-dark-border p-3 space-y-3" data-testid="website-github" data-status={account.status} data-waiting={flow ? '1' : '0'}>
            <div className="flex flex-wrap items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-dark-tertiary flex items-center justify-center flex-none"><Github className="w-5 h-5" /></span>
                <span className="flex-1 min-w-[8rem]">
                    <span className="block text-sm font-medium">{t('website.account.github')}</span>
                    <span className="block text-xs text-zinc-500 leading-snug">
                        {account.status === 'connected' && account.login
                            ? <>{t('website.github.connectedAs')} <bdi dir="ltr" className="font-mono text-zinc-300" data-testid="website-github-login">@{account.login}</bdi></>
                            : t('website.account.githubHint')}
                    </span>
                </span>
                <span className={`badge whitespace-nowrap ${flow ? 'bg-indigo-500/15 text-indigo-300' : GITHUB_STYLE[account.status] || GITHUB_STYLE.not_connected}`} data-testid="website-github-status">
                    {flow ? t('website.github.waiting') : t(`website.github.state.${account.status}`)}
                </span>
            </div>

            {flow ? (
                <div className="rounded-lg bg-dark-tertiary/60 p-3 space-y-3 text-center" data-testid="website-github-flow">
                    <p className="text-sm font-medium">{t('website.github.codeTitle')}</p>
                    <p dir="ltr" className="text-2xl font-mono font-bold tracking-[0.3em] select-all" data-testid="website-github-code">{flow.userCode}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{t('website.github.codeHint')}</p>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={copy}><Copy className="w-4 h-4" /> {t('website.github.copyCode')}</Button>
                        <Button size="sm" variant="secondary" onClick={() => api.githubOpen().catch(() => {})} data-testid="website-github-open">
                            <Github className="w-4 h-4" /> {t('website.github.openAgain')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => run('github', () => api.githubCancel())} data-testid="website-github-cancel">{t('common.cancel')}</Button>
                    </div>
                    <p className="text-xs text-zinc-500">{t('website.github.expiresIn', { n: minutes })}</p>
                </div>
            ) : account.status === 'connected' ? (
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => api.githubManage().catch(() => {})} data-testid="website-github-manage">{t('website.github.manage')}</Button>
                    <Button size="sm" variant="ghost" className="text-red-300" onClick={disconnect} loading={busy === 'github'} data-testid="website-github-disconnect">
                        {t('website.github.disconnect')}
                    </Button>
                </div>
            ) : (
                <div className="space-y-2">
                    {account.status === 'failed' && (
                        <p className="text-xs text-red-300 leading-relaxed" data-testid="website-github-error">{t(`website.github.error.${account.error || 'unknown'}`)}</p>
                    )}
                    {site.githubBlocked && <p className="text-xs text-amber-300">{t('errors.WEBSITE_GITHUB_BLOCKED')}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={start} loading={busy === 'github'} disabled={!!site.githubBlocked} data-testid="website-connect-github">
                            {account.status === 'failed' ? t('website.github.retry') : t('website.account.connect.github')}
                            {!available && !site.githubBlocked && <span className="badge bg-indigo-500/15 text-indigo-300">{t('website.soon')}</span>}
                        </Button>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">{t('website.github.permissions')}</p>
                </div>
            )}
        </li>
    );
}

/**
 * The shop's own Cloudflare account: Not connected, Connected (account
 * name, Workers and D1 reachable), Choose the account (several allowed on
 * Cloudflare's page) or Connection failed (reason in the shop's words).
 * While Cloudflare's page is open in the browser the screen asks the program
 * every 2 seconds whether the browser came back.
 */
function CloudflareAccount({ site, setSite, busy, run }) {
    const { t } = useT();
    const api = window.electronAPI.website;
    const account = site.accounts?.cloudflare || { status: 'not_connected' };
    const flow = site.cloudflareFlow;
    const available = site.providers?.cloudflare?.available;
    const blocked = site.accountsBlocked;
    const waiting = useRef(false);

    useEffect(() => {
        if (!flow) return undefined;
        waiting.current = true;
        const timer = setInterval(() => { api.getState().then(setSite).catch(() => {}); }, 2000);
        return () => clearInterval(timer);
    }, [flow?.expiresAt]);

    // The wait ended: linked, an account to choose, or why not
    useEffect(() => {
        if (flow || !waiting.current) return;
        waiting.current = false;
        if (account.status === 'connected') toast.success(t('website.account.linked', { name: t('website.account.cloudflare') }));
        else if (account.status === 'failed') toast.error(t(`website.cloudflare.error.${account.error || 'unknown'}`), 6000);
    }, [flow, account.status]);

    const start = () => run('cloudflare', () => api.cloudflareStart(), (next) => {
        const r = next?.result;
        if (r && !r.started) {
            if (r.reason === 'not_configured') toast.info(t('website.cloudflare.notConfigured'), 7000);
            else toast.error(t(`website.cloudflare.error.${r.reason || 'unknown'}`), 6000);
        }
    });
    const choose = (id) => run('cloudflare', () => api.cloudflareChoose(id), (next) => {
        const r = next?.result;
        if (r?.linked) toast.success(t('website.account.linked', { name: t('website.account.cloudflare') }));
        else if (r) toast.error(t(`website.cloudflare.error.${r.reason === 'unknown_account' ? 'unknown' : r.reason || 'unknown'}`), 6000);
    });
    const disconnect = () => {
        if (!confirm(t('website.cloudflare.disconnectConfirm'))) return;
        run('cloudflare', () => api.cloudflareDisconnect(), () => toast.success(t('website.cloudflare.disconnected')));
    };
    const badge = flow ? 'waiting' : account.status;

    return (
        <li className="rounded-lg border border-dark-border p-3 space-y-3" data-testid="website-cloudflare" data-status={account.status} data-waiting={flow ? '1' : '0'}>
            <div className="flex flex-wrap items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-dark-tertiary flex items-center justify-center flex-none"><Cloud className="w-5 h-5" /></span>
                <span className="flex-1 min-w-[8rem]">
                    <span className="block text-sm font-medium">{t('website.account.cloudflare')}</span>
                    <span className="block text-xs text-zinc-500 leading-snug">
                        {account.status === 'connected' && account.accountName
                            ? <>{t('website.cloudflare.connectedAs')} <bdi className="text-zinc-300" data-testid="website-cloudflare-account">{account.accountName}</bdi></>
                            : t('website.account.cloudflareHint')}
                    </span>
                </span>
                <span className={`badge whitespace-nowrap ${ACCOUNT_STYLE[badge] || ACCOUNT_STYLE.not_connected}`} data-testid="website-cloudflare-status">
                    {flow ? t('website.cloudflare.waiting') : t(`website.cloudflare.state.${account.status}`)}
                </span>
            </div>

            {flow ? (
                <div className="rounded-lg bg-dark-tertiary/60 p-3 space-y-3 text-center" data-testid="website-cloudflare-flow">
                    <p className="text-sm font-medium">{t('website.cloudflare.flowTitle')}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{t('website.cloudflare.flowHint')}</p>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => api.cloudflareOpen().catch(() => {})} data-testid="website-cloudflare-open">
                            <Cloud className="w-4 h-4" /> {t('website.cloudflare.openAgain')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => run('cloudflare', () => api.cloudflareCancel())} data-testid="website-cloudflare-cancel">{t('common.cancel')}</Button>
                    </div>
                </div>
            ) : account.status === 'choose_account' ? (
                <div className="space-y-2" data-testid="website-cloudflare-choose">
                    <p className="text-xs text-zinc-400 leading-relaxed">{t('website.cloudflare.chooseHint')}</p>
                    <div className="grid gap-2">
                        {account.accounts.map(a => (
                            <Button key={a.id} size="sm" variant="secondary" className="justify-start" onClick={() => choose(a.id)} loading={busy === 'cloudflare'} data-testid="website-cloudflare-pick">
                                <Cloud className="w-4 h-4" /> <bdi className="truncate">{a.name || t('website.cloudflare.unnamed')}</bdi>
                            </Button>
                        ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={disconnect}>{t('common.cancel')}</Button>
                </div>
            ) : account.status === 'connected' ? (
                <div className="space-y-2">
                    <p className="text-xs text-zinc-500 leading-relaxed" data-testid="website-cloudflare-ready">{t('website.cloudflare.ready')}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => api.cloudflareManage().catch(() => {})} data-testid="website-cloudflare-manage">{t('website.cloudflare.manage')}</Button>
                        <Button size="sm" variant="ghost" className="text-red-300" onClick={disconnect} loading={busy === 'cloudflare'} data-testid="website-cloudflare-disconnect">
                            {t('website.cloudflare.disconnect')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    {account.status === 'failed' && (
                        <p className="text-xs text-red-300 leading-relaxed" data-testid="website-cloudflare-error">{t(`website.cloudflare.error.${account.error || 'unknown'}`)}</p>
                    )}
                    {blocked && <p className="text-xs text-amber-300">{t('errors.WEBSITE_ACCOUNTS_BLOCKED')}</p>}
                    <Button size="sm" variant="secondary" onClick={start} loading={busy === 'cloudflare'} disabled={!!blocked} data-testid="website-connect-cloudflare">
                        {account.status === 'failed' ? t('website.cloudflare.retry') : t('website.account.connect.cloudflare')}
                        {!available && !blocked && <span className="badge bg-indigo-500/15 text-indigo-300">{t('website.soon')}</span>}
                    </Button>
                    <p className="text-xs text-zinc-500 leading-relaxed">{t('website.cloudflare.permissions')}</p>
                </div>
            )}
        </li>
    );
}

const STEP_ICON = {
    done: <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-none" />,
    failed: <XCircle className="w-4 h-4 text-red-400 flex-none" />,
    waiting: <Clock className="w-4 h-4 text-amber-300 flex-none" />,
    running: <Loader2 className="w-4 h-4 text-indigo-300 flex-none animate-spin" />,
    pending: <Circle className="w-4 h-4 text-zinc-600 flex-none" />,
};

/**
 * Create Website (then Update website): what it needs (GitHub, Cloudflare,
 * a theme), one button, the steps as they run, then the address. Every
 * technical part is made by the program on the shop's own accounts; the
 * screen names none of them.
 */
function PublishPanel({ site, setSite, busy, run }) {
    const { t, lang } = useT();
    const api = window.electronAPI.website;
    const deploy = site.deploy || { status: 'idle', steps: [] };
    const running = deploy.status === 'running';
    const published = !!site.publishedAt;
    const req = site.requirements || {};
    const theme = site.themes?.find(x => x.id === site.theme);
    const last = useRef(deploy.status);

    // Follow the run while it goes on
    useEffect(() => {
        if (!running) return undefined;
        const timer = setInterval(() => { api.getState().then(setSite).catch(() => {}); }, 1500);
        return () => clearInterval(timer);
    }, [running]);
    // Say how it ended
    useEffect(() => {
        if (last.current === 'running' && deploy.status !== 'running') {
            if (deploy.status === 'done') toast.success(t('website.publish.doneToast'));
            else if (deploy.status === 'waiting') toast.info(t('website.publish.waitingToast'), 7000);
            else if (deploy.status === 'failed') toast.error(t(`website.publish.reason.${deploy.reason || 'unknown'}`), 8000);
        }
        last.current = deploy.status;
    }, [deploy.status]);

    const start = () => run('publish', () => api.publish(), (next) => {
        const r = next?.result;
        if (r && !r.started && r.reason !== 'running') toast.error(t(`website.publish.reason.${r.reason}`), 7000);
    });
    const recheck = () => run('recheck', () => api.recheck(), (next) => {
        if (next?.result?.live) toast.success(t('website.publish.doneToast'));
        else toast.info(t('website.publish.stillWaiting'), 6000);
    });
    const copy = () => navigator.clipboard?.writeText(site.site.url).then(() => toast.success(t('website.copied')), () => {});
    const checks = [
        { id: 'github', ok: req.github, text: req.githubPermission ? t('website.publish.needGithubAgain') : t('website.publish.needGithub') },
        { id: 'cloudflare', ok: req.cloudflare, text: t('website.publish.needCloudflare') },
        { id: 'theme', ok: req.theme, text: theme ? t('website.publish.themeIs', { name: theme.name?.[lang] || theme.id }) : t('website.publish.needTheme') },
    ];

    return (
        <section className="card space-y-4 xl:col-span-2" data-testid="website-status" data-deploy={deploy.status}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="font-semibold">{t('website.statusTitle')}</h2>
                    <p className="text-sm text-zinc-400 mt-1">{t(`website.statusText.${site.status}`)}</p>
                </div>
                <span className={`badge text-sm px-3 py-1 ${STATUS_STYLE[site.status] || STATUS_STYLE.none}`} data-testid="website-status-badge" data-status={site.status}>
                    {t(`website.status.${site.status}`)}
                </span>
            </div>

            {/* The address, once the website answers */}
            {published && site.site?.url && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3" data-testid="website-live">
                    <p className="text-sm text-emerald-300 font-medium">{t('website.publish.liveTitle')}</p>
                    <p dir="ltr" className="font-mono text-base break-all" data-testid="website-live-url">{site.site.url}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => api.openSite().catch(() => {})} data-testid="website-open-site"><Globe className="w-4 h-4" /> {t('website.publish.open')}</Button>
                        <Button size="sm" variant="secondary" onClick={copy}><Copy className="w-4 h-4" /> {t('website.copy')}</Button>
                    </div>
                    <p className="text-xs text-zinc-500">{t('website.publish.lastPublished', { date: formatDate(site.publishedAt, 'datetime') })}</p>
                </div>
            )}

            {/* What Create Website needs */}
            {!published && (
                <ul className="grid fit-grid-sm gap-2" data-testid="website-requirements">
                    {checks.map(c => (
                        <li key={c.id} data-testid={`website-req-${c.id}`} data-ok={c.ok ? '1' : '0'}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${c.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-dark-border'}`}>
                            {c.ok ? STEP_ICON.done : STEP_ICON.pending}
                            <span className="min-w-0 leading-snug">{c.ok && c.id !== 'theme' ? t(`website.publish.ok.${c.id}`) : c.text}</span>
                        </li>
                    ))}
                </ul>
            )}

            {/* The run, step by step */}
            {deploy.steps.length > 0 && (deploy.status !== 'done' || running) && (
                <ol className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5" data-testid="website-progress">
                    {deploy.steps.map((step, i) => (
                        <li key={step.id} className="flex items-center gap-2 text-sm" data-testid={`website-step-${step.id}`} data-status={step.status}>
                            {STEP_ICON[step.status] || STEP_ICON.pending}
                            <span className={`min-w-0 leading-snug ${step.status === 'pending' ? 'text-zinc-500' : ''}`}><span className="text-zinc-500">{i + 1}. </span>{t(`website.publish.step.${step.id}`)}</span>
                        </li>
                    ))}
                </ol>
            )}
            {deploy.status === 'failed' && (
                <p className="text-sm text-red-300 leading-relaxed" data-testid="website-publish-error">{t(`website.publish.reason.${deploy.reason || 'unknown'}`)}</p>
            )}
            {deploy.status === 'waiting' && (
                <div className="flex flex-wrap items-center gap-3 text-sm text-amber-300">
                    <span className="leading-relaxed">{t('website.publish.waiting')}</span>
                    <Button size="sm" variant="secondary" onClick={recheck} loading={busy === 'recheck'} data-testid="website-recheck">{t('website.publish.checkNow')}</Button>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-dark-border">
                <p className="text-xs text-zinc-500 max-w-md leading-relaxed">{published ? t('website.publish.updateHint') : t('website.publish.createHint')}</p>
                <Button onClick={start} loading={running || busy === 'publish'} disabled={!site.canPublish} data-testid="website-publish">
                    {published ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                    {running ? t('website.publish.running') : deploy.status === 'failed' ? t('website.publish.retry') : published ? t('website.updateNow') : t('website.publish.create')}
                </Button>
            </div>
        </section>
    );
}

/** The order requests customers sent from the website, newest first (read from the website). */
function WebsiteOrders() {
    const { t } = useT();
    const [state, setState] = useState({ loading: false, data: null });
    const load = () => {
        setState(s => ({ ...s, loading: true }));
        window.electronAPI.website.orders().then((data) => setState({ loading: false, data }), () => setState({ loading: false, data: { ok: false, reason: 'network', orders: [] } }));
    };
    useEffect(() => { load(); }, []);
    const data = state.data;
    return (
        <section className="card space-y-3 xl:col-span-3" data-testid="website-orders">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-indigo-300" /> {t('website.orders.title')}</h2>
                <Button size="sm" variant="secondary" onClick={load} loading={state.loading} data-testid="website-orders-refresh"><RefreshCw className="w-4 h-4" /> {t('website.orders.refresh')}</Button>
            </div>
            <p className="text-xs text-zinc-500">{t('website.orders.hint')}</p>
            {data && !data.ok && <p className="text-sm text-amber-300">{t(`website.orders.reason.${data.reason || 'network'}`)}</p>}
            {data?.ok && data.orders.length === 0 && <p className="text-sm text-zinc-500">{t('website.orders.none')}</p>}
            {data?.ok && data.orders.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="website-orders-table">
                        <thead className="text-zinc-500 text-xs">
                            <tr>{['date', 'customer', 'phone', 'article', 'options', 'quantity', 'where'].map(k => <th key={k} className="text-start font-medium py-2 px-2 whitespace-nowrap">{t(`website.orders.col.${k}`)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {data.orders.map(o => (
                                <tr key={o.id} className="border-t border-dark-border align-top">
                                    <td className="py-2 px-2 whitespace-nowrap">{formatDate(o.createdAt, 'datetime')}</td>
                                    <td className="py-2 px-2"><bdi>{o.customerName}</bdi></td>
                                    <td className="py-2 px-2"><bdi dir="ltr" className="font-mono">{o.phone}</bdi></td>
                                    <td className="py-2 px-2"><bdi>{o.productName}</bdi></td>
                                    <td className="py-2 px-2 whitespace-nowrap">{[o.size, o.color].filter(Boolean).join(' · ')}</td>
                                    <td className="py-2 px-2">{o.quantity}</td>
                                    <td className="py-2 px-2">{[o.wilaya, o.address].filter(Boolean).join(' — ')}{o.note && <span className="block text-xs text-zinc-500">{o.note}</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
