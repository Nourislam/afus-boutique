import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Globe, Github, Cloud, Copy, RefreshCw, Palette, CheckCircle2, Circle, Sparkles, Package, Tag, Image as ImageIcon, Shirt, PackageCheck, X,
    XCircle, Clock, Loader2, ShoppingBag, Store, Users, Undo2, Printer, PhoneCall, FileDown, SlidersHorizontal,
    LayoutDashboard, Settings2, KeyRound, BarChart3,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/Tabs';
import { WILAYAS } from '../data/wilayas';
import { StatTile } from '../components/ui/StatTile';
import { toast } from '../components/ui/Toast';
import { translateError } from '../i18n/errors';
import { formatDate, formatMoney, formatNumber } from '../i18n/format';
import { useT } from '../i18n';

const STATUS_STYLE = {
    none: 'bg-zinc-500/20 text-zinc-300',
    accounts: 'bg-amber-500/15 text-amber-300',
    ready: 'bg-sky-500/15 text-sky-300',
    live: 'bg-emerald-500/15 text-emerald-300',
    error: 'bg-red-500/15 text-red-300',
    publishing: 'bg-sky-500/15 text-sky-300',
    updating: 'bg-sky-500/15 text-sky-300',
    // The update failed: the website is still online as it was
    update_failed: 'bg-amber-500/15 text-amber-300',
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
/** The Website screen's state and its one action at a time (both pages). */
function useWebsite() {
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
    return { site, setSite, preview, busy, run, load };
}

const Spinner = () => <div className="page"><div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div></div>;

export default function WebsitePage() {
    const { t } = useT();
    const { site, setSite, preview, busy, run, load } = useWebsite();
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

    if (!site) return <Spinner />;
    return (
        <div className="page" data-testid="website-page">
            <PageHeader icon={Globe} title={t('website.title')} subtitle={t('website.subtitle')} />
            <div className="page-body">
                {site.created
                    ? <WebsiteDashboard site={site} setSite={setSite} preview={preview} busy={busy} run={run} />
                    : <CreateWebsite site={site} busy={busy} run={run} />}
            </div>
        </div>
    );
}

/** The second page: the orders customers sent from the website, the customers, the figures. */
export function WebsiteOrdersPage() {
    const { t } = useT();
    const { site, load } = useWebsite();
    useEffect(() => { load(); }, [load]);
    if (!site) return <Spinner />;
    return (
        <div className="page" data-testid="website-orders-page">
            <PageHeader icon={ShoppingBag} title={t('website.ordersPage.title')} subtitle={t('website.ordersPage.subtitle')} />
            <div className="page-body">
                {site.created
                    ? <div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><WebsiteOrders /><WebsiteStats /></div>
                    : (
                        <section className="card space-y-3 max-w-xl" data-testid="website-orders-none">
                            <p className="text-sm text-zinc-300">{t('website.ordersPage.none')}</p>
                            <Link className="btn btn-primary px-3 py-1.5 text-sm inline-flex" to="/website">{t('website.ordersPage.create')}</Link>
                        </section>
                    )}
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

    useEffect(() => { setPicked(site.theme); }, [site.theme]);
    useEffect(() => {
        let alive = true;
        setFailed(false);
        api.previewTheme({ theme: picked, page }).then((r) => { if (alive) setPreview(r); }, () => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [picked, page]);
    const chosen = site.themes.find(x => x.id === picked);
    const online = !!site.publishedAt;
    // Online already: the website's pages are made again with the new look (the shop's data is only read)
    const keep = () => run('theme', () => api.setTheme(picked, { publish: online }), (next) => {
        toast.success(t(next?.result?.published ? 'website.themeSavedUpdating' : 'website.themeSaved'));
    });

    return (
        <section className="card space-y-4 xl:col-span-2" data-testid="website-theme" id="website-theme">
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

            {failed ? <p className="p-6 text-sm text-zinc-500">{t('website.previewFailed')}</p>
                : <PreviewFrame html={preview?.html} device={device} title={t('website.previewTitle', { name: themeText(chosen, 'name', lang) })} theme={preview?.theme} />}
            {preview && preview.products === 0 && <p className="text-xs text-amber-300">{t('website.previewEmpty')}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 leading-relaxed max-w-xl">{t('website.themeSafe')}</p>
                {picked === site.theme
                    ? <span className="badge bg-emerald-500/15 text-emerald-300" data-testid="website-theme-current">{t('website.themeInUse', { name: themeText(chosen, 'name', lang) })}</span>
                    : (
                        <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setPicked(site.theme)}>{t('common.cancel')}</Button>
                            <Button size="sm" onClick={keep} loading={busy === 'theme'} data-testid="website-theme-use">
                                <CheckCircle2 className="w-4 h-4" /> {t(online ? 'website.themeUseUpdate' : 'website.themeUse', { name: themeText(chosen, 'name', lang) })}
                            </Button>
                        </div>
                    )}
            </div>
        </section>
    );
}

/** The website's page drawn by the program, in a frame that runs no script and cannot reach the program. */
function PreviewFrame({ html, device = 'desktop', title, testId = 'website-preview-frame', theme }) {
    const box = useRef(null);
    const [boxWidth, setBoxWidth] = useState(800);
    useEffect(() => {
        if (!box.current || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);
    const width = PREVIEW_WIDTH[device];
    // Slightly under the measured width, so rounding never pushes the frame out
    const scale = Math.min(1, Math.max(0.1, (boxWidth - 2) / width));
    // Laid out at the device's width, then drawn smaller from the box's top-left corner
    // (the same in every language: the page has its own direction)
    return (
        <div ref={box} className="w-full">
            <div className="relative rounded-xl border border-dark-border bg-white overflow-hidden mx-auto" style={{ width: Math.floor(width * scale), maxWidth: '100%', height: PREVIEW_HEIGHT }}>
                {html && (
                    <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={html} data-testid={testId} data-theme={theme}
                        style={{ position: 'absolute', top: 0, left: 0, width, height: PREVIEW_HEIGHT / scale, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, display: 'block' }} />
                )}
            </div>
        </div>
    );
}

// Every page of the website, as the preview offers them
const SITE_PAGES = ['home', 'products', 'categories', 'category', 'product', 'new', 'best', 'offers', 'cart', 'checkout', 'about', 'contact', 'location'];

/**
 * Preview Website: the website as Update would publish it now (the shop's
 * data as it is, the theme in use), every page, computer or phone — before
 * anything is sent. Read only.
 */
function WebsitePreview({ site, onClose, onUpdate }) {
    const { t, lang } = useT();
    const api = window.electronAPI.website;
    const [page, setPage] = useState('home');
    const [id, setId] = useState(null);
    const [device, setDevice] = useState('desktop');
    const [preview, setPreview] = useState(null);
    const [failed, setFailed] = useState(false);
    const theme = site.themes?.find(x => x.id === site.theme);
    useEffect(() => {
        let alive = true;
        setFailed(false);
        api.previewTheme({ theme: site.theme, page, id }).then((r) => { if (alive) setPreview(r); }, () => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [page, id, site.theme]);
    return (
        <Modal isOpen onClose={onClose} title={t('website.sitePreview.title')} size="xl">
            <div className="space-y-3" data-testid="website-site-preview">
                <p className="text-xs text-zinc-400 leading-relaxed">{t(site.publishedAt ? 'website.sitePreview.hintOnline' : 'website.sitePreview.hintFirst', { theme: themeText(theme, 'name', lang) })}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <select className="input py-1.5 text-sm" value={page} onChange={(e) => { setPage(e.target.value); setId(null); }} aria-label={t('website.previewPage')} data-testid="website-site-preview-page">
                            {SITE_PAGES.map(p => <option key={p} value={p}>{t(`website.sitePreview.page.${p}`)}</option>)}
                        </select>
                        {page === 'category' && preview?.categories?.length > 0 && (
                            <select className="input py-1.5 text-sm" value={id || ''} onChange={(e) => setId(e.target.value || null)} aria-label={t('website.previewPages.category')}>
                                <option value="">{t('website.sitePreview.page.products')}</option>
                                {preview.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        )}
                    </div>
                    <div className="flex gap-1 rounded-lg bg-dark-tertiary/60 p-1" role="tablist" aria-label={t('website.previewDevice')}>
                        {['desktop', 'mobile'].map(d => (
                            <button key={d} type="button" role="tab" aria-selected={device === d} onClick={() => setDevice(d)} data-testid={`website-site-preview-device-${d}`}
                                className={`px-3 py-1.5 rounded-md text-sm ${device === d ? 'bg-dark-secondary text-white' : 'text-zinc-400 hover:text-white'}`}>
                                {t(`website.previewDevices.${d}`)}
                            </button>
                        ))}
                    </div>
                </div>
                {failed ? <p className="p-6 text-sm text-zinc-500">{t('website.previewFailed')}</p>
                    : <PreviewFrame html={preview?.html} device={device} title={t('website.sitePreview.title')} testId="website-site-preview-frame" theme={preview?.theme} />}
                {preview && page === 'new' && preview.newProducts === 0 && <p className="text-xs text-zinc-500">{t('website.sitePreview.noNew')}</p>}
                {preview && page === 'best' && preview.bestSellers === 0 && <p className="text-xs text-zinc-500">{t('website.sitePreview.noBest')}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
                    {site.canPublish && <Button onClick={onUpdate} data-testid="website-site-preview-publish"><RefreshCw className="w-4 h-4" /> {t(site.publishedAt ? 'website.updateNow' : 'website.publish.create')}</Button>}
                </div>
            </div>
        </Modal>
    );
}

/**
 * Website management in one place: where the website is (status), its
 * free address, its own domain, the theme in use, when it was last
 * updated, and the three actions: Update website, Preview website, Change theme.
 */
function WebsiteOverview({ site, busy, run, outdated = null }) {
    const { t, lang } = useT();
    const api = window.electronAPI.website;
    const [previewing, setPreviewing] = useState(false);
    const running = site.deploy?.status === 'running';
    const published = !!site.publishedAt;
    const theme = site.themes?.find(x => x.id === site.theme);
    const d = site.domain || { name: '', status: 'none' };
    const free = site.site?.freeUrl || site.freeUrl;
    const update = () => run('publish', () => api.publish(), (next) => {
        const r = next?.result;
        if (r && !r.started && r.reason !== 'running') toast.error(t(`website.publish.reason.${r.reason}`), 7000);
    });
    const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const Row = ({ label, children, testId }) => (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2 border-t border-dark-border first:border-t-0" data-testid={testId}>
            <span className="text-xs text-zinc-500 pt-0.5">{label}</span>
            <div className="min-w-0 text-sm text-end">{children}</div>
        </div>
    );
    return (
        <section className="card space-y-2" data-testid="website-url">
            <h2 className="font-semibold flex items-center gap-2"><Store className="w-4 h-4 text-indigo-300" /> {t('website.manage.title')}</h2>
            <div data-testid="website-overview">
                <Row label={t('website.manage.status')} testId="website-overview-status">
                    <span className={`badge ${STATUS_STYLE[site.status] || STATUS_STYLE.none}`} data-status={site.status}>{t(`website.status.${site.status}`)}</span>
                </Row>
                <Row label={t('website.manage.free')} testId="website-overview-free">
                    <p dir="ltr" className="font-mono text-xs [overflow-wrap:anywhere] text-start" data-testid="website-free-url">{free}</p>
                    <span className="flex flex-wrap justify-end gap-1 mt-1">
                        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(free).then(() => toast.success(t('website.copied')), () => {}); }}>
                            <Copy className="w-4 h-4" /> {t('website.copy')}
                        </Button>
                        {!published && <RenameAddress site={site} busy={busy} run={run} />}
                    </span>
                    <p className="text-xs text-zinc-500">{published ? t('website.urlLive') : site.freeOwner ? t('website.urlSoon') : t('website.urlAfterGithub')}</p>
                </Row>
                <Row label={t('website.manage.custom')} testId="website-overview-domain">
                    {d.name ? (
                        <span className="flex flex-col items-end gap-1">
                            <span dir="ltr" className="font-mono text-xs [overflow-wrap:anywhere]">{d.name}</span>
                            <span className={`badge ${DOMAIN_STYLE[d.status] || ''}`} data-status={d.status}>{t(`website.domain.status.${d.status}`)}</span>
                        </span>
                    ) : <span className="text-zinc-400">{t('website.manage.noDomain')}</span>}
                    <button type="button" className="block ms-auto text-xs text-indigo-300 hover:underline mt-1" onClick={() => scrollTo('website-domain')}>{t('website.manage.manageDomain')}</button>
                </Row>
                <Row label={t('website.manage.theme')} testId="website-overview-theme">
                    <span>{themeText(theme, 'name', lang)}</span>
                    <button type="button" className="block ms-auto text-xs text-indigo-300 hover:underline mt-1" onClick={() => scrollTo('website-theme')} data-testid="website-overview-change-theme">{t('website.manage.changeTheme')}</button>
                </Row>
                <Row label={t('website.manage.lastUpdated')} testId="website-overview-updated">
                    <span data-testid="website-overview-updated-at">{published ? formatDate(site.publishedAt, 'datetime') : t('website.manage.never')}</span>
                    {outdated !== null && (
                        <span className={`block text-xs ${outdated ? 'text-amber-300' : 'text-emerald-300'}`} data-testid="website-overview-outdated" data-outdated={outdated ? '1' : '0'}>
                            {t(outdated ? 'website.manage.outdated' : 'website.manage.upToDate')}
                        </span>
                    )}
                </Row>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="secondary" onClick={() => setPreviewing(true)} data-testid="website-overview-preview"><Globe className="w-4 h-4" /> {t('website.manage.preview')}</Button>
                <Button onClick={update} loading={running || busy === 'publish'} disabled={!site.canPublish} data-testid="website-overview-update">
                    <RefreshCw className="w-4 h-4" /> {running ? t(published ? 'website.update.running' : 'website.publish.running') : published ? t('website.updateNow') : t('website.publish.create')}
                </Button>
            </div>
            {previewing && <WebsitePreview site={site} onClose={() => setPreviewing(false)} onUpdate={() => { setPreviewing(false); update(); }} />}
        </section>
    );
}

/** Changes in the shop the website does not show yet: looked at once, shared by the cards. */
function useOutdated(site) {
    const [outdated, setOutdated] = useState(null);
    const running = site.deploy?.status === 'running';
    const published = !!site.publishedAt;
    useEffect(() => {
        if (running || !published) { setOutdated(null); return; }
        let alive = true;
        window.electronAPI.website.changes().then(r => { if (alive) setOutdated(r?.outdated ?? null); }, () => { if (alive) setOutdated(null); });
        return () => { alive = false; };
    }, [running, published, site.publishedAt, site.theme, site.site?.checkedAt]);
    return outdated;
}

const DASH_TABS = ['overview', 'design', 'settings', 'accounts'];
function WebsiteDashboard({ site, setSite, preview, busy, run }) {
    const { t } = useT();
    const outdated = useOutdated(site);
    const [params, setParams] = useSearchParams();
    const tab = DASH_TABS.includes(params.get('tab')) ? params.get('tab') : 'overview';
    const setTab = (id) => setParams((p) => { const next = new URLSearchParams(p); next.set('tab', id); return next; }, { replace: true });
    const tabs = [
        { id: 'overview', label: t('website.tab.overview'), icon: LayoutDashboard },
        { id: 'design', label: t('website.tab.design'), icon: Palette },
        { id: 'settings', label: t('website.tab.settings'), icon: Settings2 },
        { id: 'accounts', label: t('website.tab.accounts'), icon: KeyRound },
    ];

    return (
        <div className="space-y-4" data-testid="website-dashboard">
            <Tabs tabs={tabs} value={tab} onChange={setTab} variant="underline" testId="website-tab" />

            {tab === 'overview' && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {/* Create Website / Update website: requirements, progress, address */}
                    <PublishPanel site={site} setSite={setSite} busy={busy} run={run} outdated={outdated} />
                    {/* Website management: status, addresses, theme, last update, Update / Preview */}
                    <WebsiteOverview site={site} busy={busy} run={run} outdated={outdated} />
                    {/* The orders have their own page */}
                    <section className="card space-y-2" data-testid="website-orders-link">
                        <h2 className="font-semibold flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-indigo-300" /> {t('website.ordersPage.title')}</h2>
                        <p className="text-xs text-zinc-500">{t('website.ordersPage.subtitle')}</p>
                        <Link className="btn btn-secondary px-3 py-1.5 text-sm inline-flex" to="/website-orders" data-testid="website-open-orders">{t('website.ordersPage.open')}</Link>
                    </section>
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
                </div>
            )}

            {/* Theme: pick, see the shop's own website in it, keep */}
            {tab === 'design' && <ThemeStudio site={site} busy={busy} run={run} />}

            {tab === 'settings' && <WebsiteSettings site={site} busy={busy} run={run} />}

            {tab === 'accounts' && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    {/* Connect GitHub / Connect Cloudflare */}
                    <section className="card space-y-3" data-testid="website-accounts">
                        <h2 className="font-semibold">{t('website.accounts')}</h2>
                        <p className="text-xs text-zinc-500">{t('website.accountsHint')}</p>
                        <ul className="space-y-2">
                            <GithubAccount site={site} setSite={setSite} busy={busy} run={run} />
                            <CloudflareAccount site={site} setSite={setSite} busy={busy} run={run} />
                        </ul>
                    </section>
                    {/* Custom Domain (optional) */}
                    <CustomDomain site={site} setSite={setSite} busy={busy} run={run} />
                </div>
            )}
        </div>
    );
}

/** The website's settings, one subject per tab (saved each on its own). */
const SETTINGS_TABS = ['info', 'features', 'delivery', 'messages', 'tracking', 'blocked', 'sizes', 'couriers'];
function WebsiteSettings({ site, busy, run }) {
    const { t } = useT();
    const [params, setParams] = useSearchParams();
    const tab = SETTINGS_TABS.includes(params.get('s')) ? params.get('s') : 'info';
    const setTab = (id) => setParams((p) => { const next = new URLSearchParams(p); next.set('s', id); return next; }, { replace: true });
    return (
        <div className="space-y-4" data-testid="website-settings">
            <Tabs tabs={SETTINGS_TABS.map(id => ({ id, label: t(`website.settingsTab.${id}`) }))} value={tab} onChange={setTab} testId="website-settings-tab" />
            <div className="max-w-4xl">
                {tab === 'info' && <PublicInfoCard site={site} busy={busy} run={run} />}
                {tab === 'features' && <FeaturesCard site={site} busy={busy} run={run} />}
                {tab === 'delivery' && <DeliveryPricesCard site={site} busy={busy} run={run} />}
                {tab === 'messages' && <MessagesCard site={site} busy={busy} run={run} />}
                {tab === 'tracking' && <TrackingCard site={site} busy={busy} run={run} />}
                {tab === 'blocked' && <BlockedPhonesCard site={site} busy={busy} run={run} />}
                {tab === 'sizes' && <SizeGuidesCard site={site} busy={busy} run={run} />}
                {tab === 'couriers' && <CourierApiCard site={site} busy={busy} run={run} />}
            </div>
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

const DOMAIN_STEPS = ['dns', 'connected', 'https', 'active'];
// How far each status is along the steps (failed / wrong: where it stopped)
const DOMAIN_REACHED = { dns_needed: 0, dns_wrong: 0, connecting: 1, https_pending: 2, active: 4, failed: 0 };
const DOMAIN_STYLE = {
    dns_needed: 'bg-amber-500/15 text-amber-300', dns_wrong: 'bg-red-500/15 text-red-300', connecting: 'bg-sky-500/15 text-sky-300',
    https_pending: 'bg-sky-500/15 text-sky-300', active: 'bg-emerald-500/15 text-emerald-300', failed: 'bg-red-500/15 text-red-300',
};

/**
 * A domain at Hostinger: the shop links its own Hostinger account (an API
 * key made in hPanel › API) and the program writes the records itself. The
 * key goes to the program once and stays encrypted on this computer; it is
 * never shown again and nothing is bought with it.
 */
function HostingerSetup({ d, busy, run }) {
    const { t } = useT();
    const api = window.electronAPI.website;
    const [key, setKey] = useState('');
    const h = d.hostinger;
    return (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2" data-testid="website-hostinger" data-linked={h.linked ? '1' : '0'}>
            <p className="text-sm font-medium">{t('website.hostinger.title')}</p>
            {d.autoDns === 'hostinger' && d.autoAt ? (
                <p className="text-xs text-emerald-300" data-testid="website-hostinger-done">{t('website.hostinger.done', { date: formatDate(d.autoAt, 'datetime') })}</p>
            ) : h.linked ? (
                <>
                    <p className="text-xs text-zinc-400">{h.owns === false ? t('website.hostinger.notOwned', { domain: d.name }) : t('website.hostinger.ready')}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => run('hostinger', () => api.domainHostingerSetup(), () => toast.success(t('website.hostinger.written')))} loading={busy === 'hostinger'} data-testid="website-hostinger-setup">
                            <Sparkles className="w-4 h-4" /> {t('website.hostinger.setup')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => run('hostinger', () => api.domainHostingerForget())} data-testid="website-hostinger-forget">{t('website.hostinger.forget')}</Button>
                    </div>
                </>
            ) : (
                <>
                    <p className="text-xs text-zinc-400 leading-relaxed">{t('website.hostinger.intro')}</p>
                    <div className="flex flex-wrap gap-2">
                        <input type="password" autoComplete="off" spellCheck={false} dir="ltr" className="input flex-1 min-w-[12rem] font-mono text-xs" value={key}
                            onChange={(e) => setKey(e.target.value)} placeholder={t('website.hostinger.keyPlaceholder')} aria-label={t('website.hostinger.key')} data-testid="website-hostinger-key" />
                        <Button size="sm" onClick={() => run('hostinger', () => api.domainHostingerLink({ token: key }), () => { setKey(''); toast.success(t('website.hostinger.linked')); })}
                            loading={busy === 'hostinger'} disabled={key.trim().length < 20} data-testid="website-hostinger-link">{t('website.hostinger.link')}</Button>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">{t('website.hostinger.keySafe')}</p>
                </>
            )}
        </div>
    );
}

/**
 * Domain: the free address (always there, works without buying anything)
 * and, optionally, the shop's own domain: one it already has, or one it
 * buys now at a provider (on its own account: the domain is the shop's).
 * Connecting is step by step; the free address keeps working until the
 * domain is ready.
 */
function CustomDomain({ site, setSite, busy, run }) {
    const { t } = useT();
    const api = window.electronAPI.website;
    const d = site.domain || { name: '', status: 'none', providers: [] };
    const has = !!d.name;
    const [mode, setMode] = useState(null); // 'own' | 'buy'
    const [domain, setDomain] = useState('');
    const [query, setQuery] = useState('');
    const [found, setFound] = useState(null);
    const [opened, setOpened] = useState(null); // { domain, provider } after a buy link
    const [cleanup, setCleanup] = useState(null);
    const free = site.site?.freeUrl || site.freeUrl;
    const published = !!site.publishedAt;

    // Waiting for the records or GitHub: look again by itself while the screen is open
    useEffect(() => {
        if (!has || !['dns_needed', 'dns_wrong', 'connecting', 'https_pending'].includes(d.status)) return undefined;
        const timer = setInterval(() => { api.getState().then(setSite).catch(() => {}); }, 30000);
        return () => clearInterval(timer);
    }, [has, d.status]);

    const connect = (name, source, provider = null) => run('domain', () => api.setDomain({ domain: name, source, provider }), () => {
        setDomain(''); setMode(null); setFound(null); setOpened(null); setCleanup(null);
        toast.success(t('website.domainSaved'));
    });
    const search = () => run('domainSearch', async () => { setFound(await api.domainSearch({ query })); return null; });
    const buy = (name, provider) => run('domainBuy', async () => {
        await api.domainOpenBuy({ domain: name, provider });
        setOpened({ domain: name, provider });
        return null;
    });
    const remove = () => run('domain', () => api.removeDomain(), (next) => setCleanup(next?.result?.cleanup?.length ? next.result : null));
    const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success(t('website.copied')), () => {});
    const reached = DOMAIN_REACHED[d.status] ?? 0;

    return (
        <section className="card space-y-4" data-testid="website-domain" id="website-domain">
            <h2 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-indigo-300" /> {t('website.domain.title')}</h2>

            {/* 1. The free address: always there */}
            <div className="rounded-xl border border-dark-border p-3 space-y-1" data-testid="website-domain-free">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t('website.domain.free')}</span>
                    <span className={`badge ${published ? 'bg-emerald-500/15 text-emerald-300' : 'bg-dark-tertiary text-zinc-400'}`} data-testid="website-domain-free-status">
                        {t(published ? 'website.domain.freeActive' : 'website.domain.freeSoon')}
                    </span>
                </div>
                {free && <p dir="ltr" className="font-mono text-xs break-all text-zinc-300">{free}</p>}
                <p className="text-xs text-zinc-500">{t(d.status === 'active' ? 'website.domain.freeRedirects' : 'website.domain.freeHint')}</p>
            </div>

            {/* 2. The shop's own domain (optional) */}
            <div className="rounded-xl border border-dark-border p-3 space-y-3" data-testid="website-domain-custom">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t('website.domain.custom')}</span>
                    <span className="badge bg-dark-tertiary text-zinc-400">{t('common.optional')}</span>
                </div>

                {!has && !mode && (
                    <div className="grid sm:grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setMode('own')} data-testid="website-domain-have">{t('website.domain.have')}</Button>
                        <Button variant="secondary" onClick={() => setMode('buy')} data-testid="website-domain-buy">{t('website.domain.buy')}</Button>
                        <p className="sm:col-span-2 text-xs text-zinc-500 leading-relaxed">{t('website.domain.optionalHint')}</p>
                    </div>
                )}

                {!has && mode === 'own' && (
                    <div className="space-y-2">
                        <p className="text-xs text-zinc-400">{t('website.domain.haveHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            <input dir="ltr" className="input flex-1 min-w-[12rem] font-mono" placeholder="boutique-yasmine.com" value={domain}
                                onChange={(e) => setDomain(e.target.value)} aria-label={t('website.domain.custom')} data-testid="website-domain-input" />
                            <Button onClick={() => connect(domain, 'own')} loading={busy === 'domain'} disabled={!domain.trim()} data-testid="website-domain-save">{t('website.domain.connect')}</Button>
                            <Button variant="ghost" onClick={() => setMode(null)}>{t('common.cancel')}</Button>
                        </div>
                    </div>
                )}

                {!has && mode === 'buy' && (
                    <div className="space-y-3" data-testid="website-domain-buy-panel">
                        <p className="text-xs text-zinc-400 leading-relaxed">{t('website.domain.buyHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            <input className="input flex-1 min-w-[12rem]" placeholder={t('website.domain.searchPlaceholder')} value={query}
                                onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) search(); }}
                                aria-label={t('website.domain.search')} data-testid="website-domain-search" />
                            <Button onClick={search} loading={busy === 'domainSearch'} disabled={!query.trim()} data-testid="website-domain-search-btn">{t('website.domain.search')}</Button>
                            <Button variant="ghost" onClick={() => { setMode(null); setFound(null); }}>{t('common.cancel')}</Button>
                        </div>
                        {found && found.providersAvailable === 0 && <p className="text-xs text-amber-300" data-testid="website-domain-no-providers">{t('website.domain.noProviders')}</p>}
                        {found && (
                            <ul className="space-y-2" data-testid="website-domain-results">
                                {found.results.map(r => (
                                    <li key={r.domain} className="rounded-lg bg-dark-tertiary/50 p-2 space-y-2" data-testid="website-domain-result" data-domain={r.domain} data-status={r.status}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span dir="ltr" className="font-mono text-sm">{r.domain}</span>
                                            <span className={`badge ${r.status === 'available' ? 'bg-emerald-500/15 text-emerald-300' : r.status === 'taken' ? 'bg-red-500/15 text-red-300' : 'bg-dark-tertiary text-zinc-400'}`}>{t(`website.domain.avail.${r.status}`)}</span>
                                        </div>
                                        {r.status !== 'taken' && r.providers.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {r.providers.map(p => (
                                                    <Button key={p.id} size="sm" variant="secondary" onClick={() => buy(r.domain, p.id)} loading={busy === 'domainBuy'} data-testid="website-domain-buy-at" data-provider={p.id}>
                                                        {t('website.domain.buyAt', { name: p.name })}
                                                        {p.price && <span className="text-zinc-400 ms-1">· {t('website.domain.from', { price: `${formatNumber(p.price.from)} ${p.price.currency}` })}</span>}
                                                    </Button>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {found && <p className="text-xs text-zinc-500 leading-relaxed">{t('website.domain.ownership')}</p>}
                        {opened && (
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2" data-testid="website-domain-bought">
                                <p className="text-sm">{t('website.domain.afterBuy', { domain: opened.domain })}</p>
                                <Button size="sm" onClick={() => connect(opened.domain, 'bought', opened.provider)} loading={busy === 'domain'} data-testid="website-domain-bought-connect">{t('website.domain.boughtConnect')}</Button>
                            </div>
                        )}
                    </div>
                )}

                {has && (
                    <div className="space-y-3">
                        <div className="rounded-lg bg-dark-tertiary/60 px-3 py-2 space-y-1.5">
                            <p dir="ltr" className="font-mono text-sm [overflow-wrap:anywhere] text-start" data-testid="website-domain-name">{d.name}</p>
                            <span className={`badge ${DOMAIN_STYLE[d.status] || ''}`} data-testid="website-domain-status" data-status={d.status}>{t(`website.domain.status.${d.status}`)}</span>
                        </div>
                        <ol className="grid grid-cols-2 gap-2" data-testid="website-domain-steps">
                            {DOMAIN_STEPS.map((id, i) => {
                                const st = i < reached ? 'done' : i === reached && !['failed', 'dns_wrong'].includes(d.status) ? 'running' : i === reached ? 'failed' : 'pending';
                                return (
                                    <li key={id} className="flex items-center gap-1.5 text-xs" data-status={st}>
                                        {STEP_ICON[st === 'running' ? 'waiting' : st]}<span className="leading-snug">{t(`website.domain.step.${id}`)}</span>
                                    </li>
                                );
                            })}
                        </ol>
                        <p className="text-sm text-zinc-300 leading-relaxed" data-testid="website-domain-explain">
                            {t(`website.domain.explain.${d.reason || d.status}`, { domain: d.name, url: `https://${d.name}/` })}
                        </p>

                        {d.hostinger && ['dns_needed', 'dns_wrong'].includes(d.status) && d.reason !== 'not_published' && (
                            <HostingerSetup d={d} busy={busy} run={run} />
                        )}

                        {['dns_needed', 'dns_wrong'].includes(d.status) && d.records?.length > 0 && d.reason !== 'not_published' && (
                            <div className="space-y-2" data-testid="website-domain-records">
                                <p className="text-xs text-zinc-400 leading-relaxed">{t('website.domain.recordsHint')}</p>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="text-zinc-500"><tr>{['type', 'host', 'value'].map(k => <th key={k} className="text-start font-medium py-1 px-2">{t(`website.domain.col.${k}`)}</th>)}<th /></tr></thead>
                                        <tbody dir="ltr">
                                            {d.records.map((r, i) => (
                                                <tr key={i} className="border-t border-dark-border" data-testid="website-domain-record">
                                                    <td className="py-1.5 px-2 font-mono">{r.type}</td>
                                                    <td className="py-1.5 px-2 font-mono">{r.host}</td>
                                                    <td className="py-1.5 px-2 font-mono break-all">{r.value}</td>
                                                    <td className="py-1.5 px-2 text-end"><Button size="sm" variant="ghost" onClick={() => copy(r.value)} aria-label={t('website.copy')}><Copy className="w-3.5 h-3.5" /></Button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {d.status === 'dns_wrong' && d.found && (
                                    <p className="text-xs text-red-300" dir="ltr" data-testid="website-domain-found">{t('website.domain.foundNow')}: {[...(d.found.a || []), ...(d.found.cname || [])].join(', ') || '—'}</p>
                                )}
                                <p className="text-xs text-zinc-500">{t('website.domain.autoCheck')}</p>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            {d.status !== 'failed' && d.status !== 'active' && (
                                <Button size="sm" variant="secondary" onClick={() => run('domainCheck', () => api.domainCheck())} loading={busy === 'domainCheck'} data-testid="website-domain-check">
                                    <RefreshCw className="w-4 h-4" /> {t('website.domain.checkNow')}
                                </Button>
                            )}
                            {d.status === 'failed' && (
                                <Button size="sm" onClick={() => run('domainCheck', () => api.domainRetry())} loading={busy === 'domainCheck'} data-testid="website-domain-retry">{t('website.publish.retry')}</Button>
                            )}
                            {d.status === 'active' && (
                                <Button size="sm" variant="secondary" onClick={() => window.open(`https://${d.name}/`, '_blank', 'noopener')}><Globe className="w-4 h-4" /> {t('website.publish.open')}</Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={remove} loading={busy === 'domain'} data-testid="website-domain-remove"><X className="w-4 h-4" /> {t('website.domainRemove')}</Button>
                        </div>
                    </div>
                )}

                {cleanup && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1" data-testid="website-domain-cleanup">
                        <p className="text-sm text-amber-300">{t('website.domain.cleanup', { domain: cleanup.removed })}</p>
                        <p className="text-xs text-zinc-400" dir="ltr">{cleanup.cleanup.map(r => `${r.type} ${r.host} → ${r.value}`).join(' · ')}</p>
                    </div>
                )}
            </div>
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
                    {site.providers?.github?.signIn && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" onClick={start} loading={busy === 'github'} disabled={!!site.githubBlocked} data-testid="website-connect-github">
                                <Github className="w-4 h-4" /> {account.status === 'failed' ? t('website.github.retry') : t('website.account.connect.github')}
                            </Button>
                        </div>
                    )}
                    {available && <SignupLink provider="github" />}
                    {available && <TokenLink provider="github" busy={busy} run={run} folded={!!site.providers?.github?.signIn} />}
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
                    {site.providers?.cloudflare?.signIn && (
                        <Button size="sm" onClick={start} loading={busy === 'cloudflare'} disabled={!!blocked} data-testid="website-connect-cloudflare">
                            <Cloud className="w-4 h-4" /> {account.status === 'failed' ? t('website.cloudflare.retry') : t('website.account.connect.cloudflare')}
                        </Button>
                    )}
                    {available && <SignupLink provider="cloudflare" />}
                    {available && <TokenLink provider="cloudflare" busy={busy} run={run} folded={!!site.providers?.cloudflare?.signIn} />}
                    <p className="text-xs text-zinc-500 leading-relaxed">{t('website.cloudflare.permissions')}</p>
                </div>
            )}
        </li>
    );
}

/**
 * Link an account with a key the shop makes itself on the provider's own
 * page (already filled in with what the website needs): open the page, make
 * the key, paste it here. The key goes to the main process, is checked with
 * the provider and kept encrypted; it is never shown again.
 */
/** No account yet: the provider's own page to open one, free (the only thing the shop has to do). */
function SignupLink({ provider }) {
    const { t } = useT();
    return (
        <p className="text-xs text-zinc-400">
            {t(`website.signup.${provider}.question`)}{' '}
            <button type="button" className="text-indigo-300 underline" onClick={() => window.electronAPI.website.openSignupPage(provider).catch(() => {})} data-testid={`website-${provider}-signup`}>
                {t(`website.signup.${provider}.create`)}
            </button>
        </p>
    );
}

/** folded: the one-click sign-in is offered above; the key is the other way, folded away. */
function TokenLink({ provider, busy, run, folded = false }) {
    const { t } = useT();
    const api = window.electronAPI.website;
    const [token, setToken] = useState('');
    const key = `${provider}-token`;
    const link = () => run(key, () => (provider === 'github' ? api.githubConnectToken(token) : api.cloudflareConnectToken(token)), (next) => {
        const r = next?.result;
        setToken('');
        if (r?.linked) toast.success(t('website.account.linked', { name: t(`website.account.${provider}`) }));
        else if (r?.reason === 'choose_account') toast.info(t('website.cloudflare.chooseHint'), 6000);
        else if (r) toast.error(t(`website.token.error.${r.reason || 'unknown'}`), 8000);
    });
    const body = (
        <>
            <ol className="text-xs text-zinc-400 leading-relaxed list-decimal ps-5 space-y-1">
                <li>{t(`website.token.${provider}.step1`)}</li>
                <li>{t(`website.token.${provider}.step2`)}</li>
                <li>{t('website.token.step3')}</li>
            </ol>
            <Button size="sm" variant="secondary" onClick={() => api.openTokenPage(provider).catch(() => {})} data-testid={`website-${provider}-token-page`}>
                {provider === 'github' ? <Github className="w-4 h-4" /> : <Cloud className="w-4 h-4" />} {t(`website.token.${provider}.open`)}
            </Button>
            <div className="flex flex-wrap gap-2">
                <input type="password" className="input flex-1 min-w-[12rem] font-mono" dir="ltr" autoComplete="off" spellCheck={false} value={token}
                    onChange={(e) => setToken(e.target.value)} placeholder={t(`website.token.${provider}.placeholder`)} aria-label={t('website.token.paste')}
                    maxLength={260} data-testid={`website-${provider}-token-input`} />
                <Button size="sm" onClick={link} disabled={!token.trim()} loading={busy === key} data-testid={`website-${provider}-token-link`}>{t('website.token.link')}</Button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">{t('website.token.safe')}</p>
        </>
    );
    if (folded) {
        return (
            <details className="rounded-lg bg-dark-tertiary/40 p-3" data-testid={`website-${provider}-token`}>
                <summary className="text-xs text-zinc-400 cursor-pointer">{t('website.token.otherWay')}</summary>
                <div className="space-y-2 mt-2">{body}</div>
            </details>
        );
    }
    return (
        <div className="rounded-lg bg-dark-tertiary/50 p-3 space-y-2" data-testid={`website-${provider}-token`}>
            <p className="text-sm font-medium">{t('website.token.title')}</p>
            {body}
        </div>
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
function PublishPanel({ site, setSite, busy, run, outdated = null }) {
    const { t, lang } = useT();
    const api = window.electronAPI.website;
    const deploy = site.deploy || { status: 'idle', steps: [] };
    const running = deploy.status === 'running';
    const published = !!site.publishedAt;
    const req = site.requirements || {};
    const theme = site.themes?.find(x => x.id === site.theme);
    const last = useRef(deploy.status);
    const failToast = useRef(null);

    // Follow the run while it goes on
    useEffect(() => {
        if (!running) return undefined;
        const timer = setInterval(() => { api.getState().then(setSite).catch(() => {}); }, 1500);
        return () => clearInterval(timer);
    }, [running]);
    // Say how it ended
    useEffect(() => {
        if (last.current === 'running' && deploy.status !== 'running') {
            if (deploy.status === 'done' && deploy.mode === 'update') toast.success(t(site.site?.unchanged ? 'website.update.unchangedToast' : 'website.update.doneToast'));
            else if (deploy.status === 'done') toast.success(t('website.publish.doneToast'));
            else if (deploy.status === 'waiting') toast.info(t('website.publish.waitingToast'), 7000);
            else if (deploy.status === 'failed') failToast.current = toast.error(t(`website.publish.reason.${deploy.reason || 'unknown'}`), 8000);
        }
        last.current = deploy.status;
    }, [deploy.status]);

    const start = () => run('publish', () => {
        // Try again: the message of the failed run goes away
        if (failToast.current) { toast.dismiss(failToast.current); failToast.current = null; }
        return api.publish();
    }, (next) => {
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
                    <p className="text-xs text-zinc-500" data-testid="website-last-updated">{t('website.update.lastUpdated', { date: formatDate(site.publishedAt, 'datetime') })}</p>
                    {site.site?.unchanged && site.site?.checkedAt && deploy.status === 'done' && outdated !== true && (
                        <p className="text-xs text-zinc-500" data-testid="website-checked">{t('website.update.checkedAt', { date: formatDate(site.site.checkedAt, 'datetime') })}</p>
                    )}
                </div>
            )}
            {published && !running && outdated !== null && (
                <p className={`text-sm rounded-lg px-3 py-2 ${outdated ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/5 text-emerald-300'}`} data-testid="website-outdated" data-outdated={outdated ? '1' : '0'}>
                    {t(outdated ? 'website.update.outdated' : 'website.update.upToDate')}
                </p>
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
                <div className="space-y-1" data-testid="website-publish-error">
                    <p className="text-sm text-red-300 leading-relaxed">{t(`website.publish.reason.${deploy.reason || 'unknown'}`)}</p>
                    {published && <p className="text-xs text-zinc-400" data-testid="website-previous-online">{t('website.update.previousOnline')}</p>}
                </div>
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
                    {running ? t(published ? 'website.update.running' : 'website.publish.running') : deploy.status === 'failed' ? t('website.publish.retry') : published ? t('website.updateNow') : t('website.publish.create')}
                </Button>
            </div>
        </section>
    );
}

/** The order requests customers sent from the website, newest first (read from the website). */
function WebsiteOrders() {
    const { t } = useT();
    const [tab, setTab] = useState('orders');
    const [status, setStatus] = useState(null);
    const [state, setState] = useState({ loading: false, data: null });
    const [history, setHistory] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const [labelFor, setLabelFor] = useState(null);
    const load = (st = status) => {
        setState(s => ({ ...s, loading: true }));
        window.electronAPI.website.orders({ status: st }).then((data) => setState({ loading: false, data }), () => setState({ loading: false, data: { ok: false, reason: 'network', orders: [] } }));
    };
    useEffect(() => { load(status); }, [status]);
    const data = state.data;
    const counts = data?.counts || {};
    const all = Object.values(counts).reduce((n, x) => n + x, 0);
    return (
        <section className="card space-y-3 xl:col-span-3" data-testid="website-orders">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-indigo-300" /> {t('website.orders.title')}</h2>
                <div className="flex flex-wrap gap-2">
                    {['orders', 'customers'].map(k => (
                        <Button key={k} size="sm" variant={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)} data-testid={`website-orders-tab-${k}`}>
                            {k === 'orders' ? <ShoppingBag className="w-4 h-4" /> : <Users className="w-4 h-4" />} {t(`website.orders.tab.${k}`)}
                        </Button>
                    ))}
                    <Button size="sm" variant="secondary" onClick={() => load()} loading={state.loading} data-testid="website-orders-refresh"><RefreshCw className="w-4 h-4" /> {t('website.orders.refresh')}</Button>
                </div>
            </div>
            <p className="text-xs text-zinc-500">{t('website.orders.hint')}</p>
            {data?.sync?.lastAt && (
                <p className="text-xs text-zinc-400" data-testid="website-orders-sync" data-ok={data.sync.ok ? '1' : '0'}>
                    {data.sync.ok
                        ? t('website.orders.syncOk', { when: formatDate(data.sync.lastAt, 'datetime') })
                        : t('website.orders.syncRetry', { when: formatDate(data.sync.nextAt, 'datetime') })}
                    {data.sync.waiting > 0 && <span className="ms-2 text-amber-300">{t('website.orders.syncWaiting', { n: data.sync.waiting })}</span>}
                    {data.sync.legacy && <span className="block text-amber-300">{t('website.orders.syncLegacy')}</span>}
                </p>
            )}
            {data && (!data.ok || data.synced === false) && data.reason && <p className="text-sm text-amber-300">{t(`website.orders.reason.${data.reason || 'network'}`)}</p>}

            {tab === 'customers' ? <WebsiteCustomers onOpen={setHistory} /> : (
                <>
                    {/* One status at a time, with how many orders are in it */}
                    <div className="flex flex-wrap gap-1.5" data-testid="website-orders-filters">
                        <button type="button" className={`badge cursor-pointer ${!status ? 'bg-indigo-500/20 text-indigo-200' : 'bg-dark-tertiary text-zinc-400'}`} onClick={() => setStatus(null)} data-testid="website-orders-filter-all">
                            {t('website.orders.filterAll')} <bdi>{formatNumber(all)}</bdi>
                        </button>
                        {ORDER_STATUSES.map(st => (
                            <button key={st} type="button" className={`badge cursor-pointer ${status === st ? 'bg-indigo-500/20 text-indigo-200' : 'bg-dark-tertiary text-zinc-400'}`}
                                onClick={() => setStatus(st)} data-testid={`website-orders-filter-${st}`}>
                                {t(`website.orders.status.${st}`)} <bdi>{formatNumber(counts[st] || 0)}</bdi>
                            </button>
                        ))}
                    </div>
                    {data?.ok && data.orders.length === 0 && <p className="text-sm text-zinc-500">{t('website.orders.none')}</p>}
                    {data?.ok && data.orders.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm" data-testid="website-orders-table">
                                <thead className="text-zinc-500 text-xs">
                                    <tr>{['date', 'customer', 'phone', 'article', 'options', 'quantity', 'where', 'status'].map(k => <th key={k} className="text-start font-medium py-2 px-2 whitespace-nowrap">{t(`website.orders.col.${k}`)}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {data.orders.map(o => (
                                <tr key={o.id} className="border-t border-dark-border align-top">
                                    <td className="py-2 px-2 whitespace-nowrap">{formatDate(o.createdAt, 'datetime')}</td>
                                    <td className="py-2 px-2">
                                        <bdi>{o.customerName}</bdi>
                                        {o.customer && <CustomerBadge c={o.customer} onOpen={() => setHistory(o.phoneKey)} />}
                                    </td>
                                    <td className="py-2 px-2"><bdi dir="ltr" className="font-mono">{o.phone}</bdi></td>
                                    {o.items?.length ? (
                                        <td className="py-2 px-2" colSpan={3} data-testid="website-order-items">
                                            <ul className="space-y-1">
                                                {o.items.map((i, n) => (
                                                    <li key={n} className="flex flex-wrap gap-x-2">
                                                        <bdi>{i.productName || i.productId}</bdi>
                                                        {(i.size || i.color) && <span className="text-zinc-400">{[i.size, i.color].filter(Boolean).join(' · ')}</span>}
                                                        <span className="text-zinc-400">× {i.quantity}</span>
                                                        {i.unitPrice !== null && <span className="text-zinc-500"><bdi dir="ltr">{formatMoney(i.unitPrice * i.quantity)}</bdi></span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>
                                    ) : (
                                        <>
                                            <td className="py-2 px-2"><bdi>{o.productName}</bdi></td>
                                            <td className="py-2 px-2 whitespace-nowrap">{[o.size, o.color].filter(Boolean).join(' · ')}</td>
                                            <td className="py-2 px-2">{o.quantity}</td>
                                        </>
                                    )}
                                    <td className="py-2 px-2">
                                        {[o.wilaya, o.commune, o.delivery !== 'office' && o.address].filter(Boolean).join(' — ')}
                                        {o.delivery && <span className="block text-xs text-indigo-300">{t(`website.orders.delivery.${o.delivery}`)}</span>}
                                        {o.courier && (
                                            <span className="block text-xs text-zinc-300" data-testid="website-order-courier">
                                                <bdi>{o.courier.company}</bdi> — <bdi>{o.courier.office}</bdi>
                                                <span className="block text-zinc-500">{[o.courier.wilaya, o.courier.commune].filter(Boolean).join(' — ')}</span>
                                            </span>
                                        )}
                                        {o.note && <span className="block text-xs text-zinc-500">{o.note}</span>}
                                        {/* The money: delivery price, coupon, what the courier collects */}
                                        <span className="block text-xs text-zinc-400 mt-1" data-testid="website-order-money">
                                            {o.deliveryFee !== null && <span className="block">{t('website.orders.deliveryFee')}: <bdi dir="ltr">{formatMoney(o.deliveryFee)}</bdi></span>}
                                            {o.coupon && <span className="block text-emerald-300">{t('website.orders.coupon')} <bdi dir="ltr">{o.coupon.code}</bdi>: <bdi dir="ltr">-{formatMoney(o.coupon.discount)}</bdi></span>}
                                            <span className="block font-semibold text-zinc-200">{t('website.orders.toCollect')}: <bdi dir="ltr">{formatMoney(o.toCollect)}</bdi></span>
                                        </span>
                                    </td>
                                    <td className="py-2 px-2 space-y-2">
                                        <OrderStatus order={o} onChanged={() => load()} onConfirm={setConfirming} onLabel={setLabelFor} />
                                        <OrderTools order={o} onChanged={() => load()} />
                                    </td>
                                </tr>
                            ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
            {history && <CustomerHistory phone={history} onClose={() => setHistory(null)} />}
            {confirming && <ConfirmOrder order={confirming} onClose={() => setConfirming(null)} onDone={(o) => { setConfirming(null); load(); if (o) setLabelFor(o); }} />}
            {labelFor && <ShippingLabel order={labelFor} onClose={() => { setLabelFor(null); load(); }} />}
        </section>
    );
}

/** A customer's figures in one line, under their name (AFUS only). */
function CustomerBadge({ c, onOpen }) {
    const { t } = useT();
    return (
        <button type="button" onClick={onOpen} className="mt-1 flex flex-wrap gap-x-2 text-xs text-start text-zinc-400 hover:text-indigo-200" data-testid="website-order-customer">
            <span>{t('website.customers.ordersN', { n: c.orders })}</span>
            {c.successful > 0 && <span className="text-emerald-300">{t('website.customers.successfulN', { n: c.successful })}</span>}
            {c.returned > 0 && <span className="text-amber-300">{t('website.customers.returnedN', { n: c.returned })}</span>}
            {c.cancelled > 0 && <span className="text-zinc-500">{t('website.customers.cancelledN', { n: c.cancelled })}</span>}
        </button>
    );
}

/** The website's customers, one per phone number; search by name or phone. */
function WebsiteCustomers({ onOpen }) {
    const { t } = useT();
    const [search, setSearch] = useState('');
    const [list, setList] = useState(null);
    useEffect(() => {
        const timer = setTimeout(() => {
            window.electronAPI.website.customers({ search }).then(setList, (e) => { toast.error(translateError(e)); setList([]); });
        }, 200);
        return () => clearTimeout(timer);
    }, [search]);
    return (
        <div className="space-y-3" data-testid="website-customers">
            <input className="input w-full max-w-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('website.customers.search')} data-testid="website-customers-search" />
            {list && list.length === 0 && <p className="text-sm text-zinc-500">{t('website.customers.none')}</p>}
            {list && list.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="website-customers-table">
                        <thead className="text-zinc-500 text-xs">
                            <tr>{['customer', 'phone', 'orders', 'delivered', 'returned', 'cancelled', 'successful', 'total'].map(k => <th key={k} className="text-start font-medium py-2 px-2 whitespace-nowrap">{t(`website.customers.col.${k}`)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {list.map(c => (
                                <tr key={c.phone} className="border-t border-dark-border cursor-pointer hover:bg-dark-tertiary/40" onClick={() => onOpen(c.phone)} data-testid="website-customer-row">
                                    <td className="py-2 px-2"><bdi>{c.name}</bdi></td>
                                    <td className="py-2 px-2"><bdi dir="ltr" className="font-mono">{c.phone}</bdi></td>
                                    <td className="py-2 px-2">{formatNumber(c.orders)}</td>
                                    <td className="py-2 px-2">{formatNumber(c.delivered)}</td>
                                    <td className="py-2 px-2 text-amber-300">{formatNumber(c.returned)}</td>
                                    <td className="py-2 px-2 text-zinc-400">{formatNumber(c.cancelled)}</td>
                                    <td className="py-2 px-2 text-emerald-300">{formatNumber(c.successful)}</td>
                                    <td className="py-2 px-2 whitespace-nowrap"><bdi dir="ltr">{formatMoney(c.total)}</bdi></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

/** One customer (by phone): their figures, every order and the statuses it went through. */
function CustomerHistory({ phone, onClose }) {
    const { t } = useT();
    const [h, setH] = useState(null);
    useEffect(() => {
        window.electronAPI.website.customerHistory({ phone }).then(setH, (e) => { toast.error(translateError(e)); onClose(); });
    }, [phone]);
    return (
        <Modal isOpen onClose={onClose} title={t('website.customers.history')} size="lg">
            {!h ? <p className="text-sm text-zinc-500">…</p> : (
                <div className="space-y-4" data-testid="website-customer-history">
                    <div>
                        <p className="font-semibold"><bdi>{h.name}</bdi></p>
                        <p className="text-sm text-zinc-400"><bdi dir="ltr" className="font-mono">{h.phone}</bdi></p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="website-customer-stats">
                        <StatTile icon={ShoppingBag} label={t('website.customers.col.orders')} value={formatNumber(h.orders)} />
                        <StatTile icon={PackageCheck} label={t('website.customers.col.delivered')} value={formatNumber(h.delivered)} iconTone="bg-sky-500/15 text-sky-300" />
                        <StatTile icon={Undo2} label={t('website.customers.col.returned')} value={formatNumber(h.returned)} iconTone="bg-amber-500/15 text-amber-300" />
                        <StatTile icon={XCircle} label={t('website.customers.col.cancelled')} value={formatNumber(h.cancelled)} />
                        <StatTile icon={CheckCircle2} label={t('website.customers.col.successful')} value={formatNumber(h.successful)} iconTone="bg-emerald-500/15 text-emerald-300" />
                        <StatTile icon={Tag} label={t('website.customers.col.total')} value={formatMoney(h.total)} iconTone="bg-emerald-500/15 text-emerald-300" />
                    </div>
                    <p className="text-xs text-zinc-500">{t('website.customers.privateHint')}</p>
                    <ul className="space-y-2" data-testid="website-customer-orders">
                        {h.list.map(o => (
                            <li key={o.id} className="rounded-lg bg-dark-tertiary/50 p-3 space-y-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm">{formatDate(o.createdAt, 'datetime')}</span>
                                    <span className="badge bg-dark-tertiary text-zinc-200" data-status={o.status}>{t(`website.orders.status.${o.status}`)}</span>
                                </div>
                                <p className="text-sm text-zinc-300">
                                    {o.items.map(i => `${i.productName || i.productId}${[i.size, i.color].filter(Boolean).length ? ` (${[i.size, i.color].filter(Boolean).join(' · ')})` : ''} × ${i.quantity}`).join('، ')}
                                    {o.total > 0 && <span className="ms-2 text-zinc-400"><bdi dir="ltr">{formatMoney(o.total)}</bdi></span>}
                                    {o.receipt && <span className="ms-2 text-xs text-zinc-500">{t('website.orders.ticket')} <bdi dir="ltr">{o.receipt}</bdi></span>}
                                </p>
                                <p className="text-xs text-zinc-500">
                                    {o.events.map((e, n) => <span key={n} className="me-2 whitespace-nowrap">{t(`website.orders.status.${e.status}`)} <bdi>{formatDate(e.at, 'datetime')}</bdi>{n < o.events.length - 1 ? ' ←' : ''}</span>)}
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Modal>
    );
}

const ORDER_STATUSES = ['new', 'contacted', 'confirmed', 'preparing', 'shipped', 'delivered', 'money_received', 'returned', 'cancelled'];

/**
 * Where a website order is (cash on delivery). Only "Money received" makes it
 * a sale: AFUS then records it once (ticket, stock out) and it can no longer
 * change; asked to confirm first.
 */
function OrderStatus({ order, onChanged, onConfirm, onLabel }) {
    const { t } = useT();
    const [asking, setAsking] = useState(false);
    const [inspecting, setInspecting] = useState(false);
    const [busy, setBusy] = useState(false);
    const final = order.status === 'money_received';
    const change = (status) => {
        setBusy(true);
        window.electronAPI.website.setOrderStatus({ id: order.id, status }).then((r) => {
            setBusy(false); setAsking(false);
            onChanged(r.order);
            if (r.sale) toast.success(t('website.orders.saleRecorded', { receipt: r.sale.receipt }));
        }, (e) => { setBusy(false); setAsking(false); toast.error(translateError(e)); });
    };
    if (final) {
        return (
            <span className="space-y-1 block" data-testid="website-order-status" data-status={order.status}>
                <span className="badge bg-emerald-500/15 text-emerald-300 whitespace-nowrap">{t('website.orders.status.money_received')}</span>
                {order.receipt && <span className="block text-xs text-zinc-500 whitespace-nowrap">{t('website.orders.ticket')} <bdi dir="ltr">{order.receipt}</bdi></span>}
                <Button size="sm" variant="ghost" onClick={() => onLabel(order)} data-testid="website-order-label"><Printer className="w-4 h-4" /> {t('website.label.print')}</Button>
            </span>
        );
    }
    const canConfirm = ['new', 'contacted'].includes(order.status);
    // Only the steps the order can take now (the order book says which)
    const choices = ORDER_STATUSES.filter(st => st === order.status || (order.next || []).includes(st));
    const checked = order.status === 'returned' && order.returnCheckedAt;
    const back = (order.items || []).reduce((n, i) => n + i.returnedSellable, 0);
    const damaged = (order.items || []).reduce((n, i) => n + i.returnedDamaged, 0);
    return (
        <span className="space-y-1 block min-w-[9rem]" data-testid="website-order-status" data-status={order.status}>
            <select className="input py-1 text-xs" value={asking ? 'money_received' : order.status} disabled={busy}
                aria-label={t('website.orders.col.status')} data-testid="website-order-status-select"
                onChange={(e) => {
                    const next = e.target.value;
                    if (next === 'money_received') return setAsking(true);
                    setAsking(false);
                    // Confirmed: after the call (what the customer confirmed, then the pieces are put aside)
                    if (next === 'confirmed' && canConfirm) return onConfirm(order);
                    return change(next);
                }}>
                {choices.map(st => <option key={st} value={st}>{t(`website.orders.status.${st}`)}</option>)}
            </select>
            {order.returnPending && <span className="block text-xs text-amber-300" data-testid="website-order-return-pending">{t('website.returns.pendingHint')}</span>}
            {order.reserved && !order.returnPending && <span className="block text-xs text-sky-300" data-testid="website-order-reserved">{t('website.orders.reservedHint')}</span>}
            {['shipped', 'delivered'].includes(order.status) && <span className="block text-xs text-zinc-500" data-testid="website-order-not-sale">{t('website.orders.notSaleYet')}</span>}
            {checked && <span className="block text-xs text-zinc-400" data-testid="website-order-return-checked">{t('website.returns.checkedHint', { back, damaged })}</span>}
            {order.number && <span className="block text-xs text-zinc-500"><bdi dir="ltr">{order.number}</bdi></span>}
            <span className="flex flex-wrap gap-1">
                {canConfirm && <Button size="sm" variant="secondary" onClick={() => onConfirm(order)} data-testid="website-order-confirm"><PhoneCall className="w-4 h-4" /> {t('website.confirm.open')}</Button>}
                {order.returnPending && <Button size="sm" variant="secondary" onClick={() => setInspecting(true)} data-testid="website-order-check-return"><PackageCheck className="w-4 h-4" /> {t('website.returns.open')}</Button>}
                {!canConfirm && !['cancelled', 'returned'].includes(order.status) && <Button size="sm" variant="ghost" onClick={() => onLabel(order)} data-testid="website-order-label"><Printer className="w-4 h-4" /> {t('website.label.print')}</Button>}
            </span>
            {inspecting && <CheckReturn order={order} onClose={() => setInspecting(false)} onDone={(o) => { setInspecting(false); onChanged(o); }} />}
            {asking && (
                <span className="block space-y-1 rounded-lg bg-dark-tertiary/60 p-2">
                    <span className="block text-xs text-zinc-400">{t('website.orders.confirmMoney')}</span>
                    <span className="flex gap-1">
                        <Button size="sm" onClick={() => change('money_received')} loading={busy} data-testid="website-order-money-confirm">{t('website.orders.recordSale')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
                    </span>
                </span>
            )}
        </span>
    );
}

/**
 * The returned parcel is in the shop: each piece is checked. The sellable
 * ones go back in stock (the same colour / size), the damaged ones stay out.
 * No sale, no refund: the order was never paid.
 */
function CheckReturn({ order, onClose, onDone }) {
    const { t } = useT();
    const lines = order.items.filter(i => i.reserved > 0);
    const [counts, setCounts] = useState(() => Object.fromEntries(lines.map(i => [i.line, { sellable: String(i.reserved), damaged: '0' }])));
    const [busy, setBusy] = useState(false);
    const set = (line, key, value) => setCounts(c => {
        const pieces = lines.find(i => i.line === line).reserved;
        const n = Math.max(0, Math.min(pieces, parseInt(value, 10) || 0));
        // The two always add up to the pieces of the line
        return { ...c, [line]: key === 'sellable' ? { sellable: String(n), damaged: String(pieces - n) } : { sellable: String(pieces - n), damaged: String(n) } };
    });
    const save = () => {
        setBusy(true);
        window.electronAPI.website.checkReturn({ id: order.id, lines: lines.map(i => ({ line: i.line, sellable: Number(counts[i.line].sellable), damaged: Number(counts[i.line].damaged) })) })
            .then((r) => { setBusy(false); toast.success(t('website.returns.done')); onDone(r.order); }, (e) => { setBusy(false); toast.error(translateError(e)); });
    };
    return (
        <Modal isOpen onClose={onClose} title={t('website.returns.title', { number: order.number || '' })} size="md">
            <div className="space-y-3" data-testid="website-check-return">
                <p className="text-sm text-zinc-400">{t('website.returns.intro')}</p>
                <table className="w-full text-sm">
                    <thead className="text-xs text-zinc-500">
                        <tr>
                            <th className="text-start font-medium py-1">{t('website.returns.article')}</th>
                            <th className="text-start font-medium py-1">{t('website.returns.sellable')}</th>
                            <th className="text-start font-medium py-1">{t('website.returns.damaged')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map(i => (
                            <tr key={i.line} className="border-t border-dark-border" data-testid="website-check-return-line">
                                <td className="py-2 pe-2">
                                    <bdi>{i.productName || i.productId}</bdi>
                                    <span className="block text-xs text-zinc-400">{[i.size, i.color].filter(Boolean).join(' · ')} × {i.reserved}</span>
                                </td>
                                <td className="py-2 pe-2"><input type="number" min="0" max={i.reserved} className="input w-20 py-1" value={counts[i.line].sellable} onChange={(e) => set(i.line, 'sellable', e.target.value)} data-testid="website-check-return-sellable" /></td>
                                <td className="py-2"><input type="number" min="0" max={i.reserved} className="input w-20 py-1" value={counts[i.line].damaged} onChange={(e) => set(i.line, 'damaged', e.target.value)} data-testid="website-check-return-damaged" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-xs text-zinc-500">{t('website.returns.hint')}</p>
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
                    <Button onClick={save} loading={busy} data-testid="website-check-return-save"><PackageCheck className="w-4 h-4" /> {t('website.returns.save')}</Button>
                </div>
            </div>
        </Modal>
    );
}

/**
 * The call to the customer (COD): check each line (size, colour, quantity,
 * price), the wilaya, commune and the address or courier office, then
 * Confirm: the pieces are put aside (no sale yet). "Contacted" keeps the
 * order waiting (no answer, call back later).
 */
function ConfirmOrder({ order, onClose, onDone }) {
    const { t } = useT();
    const [choices, setChoices] = useState(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(() => ({
        lines: order.items.map(i => ({ line: i.line, productName: i.productName, size: i.size, color: i.color, quantity: String(i.quantity), unit_price: i.unitPrice === null ? '' : String(i.unitPrice), keep: true })),
        wilaya: order.wilaya, commune: order.commune, delivery: order.delivery === 'office' ? 'office' : 'home', address: order.address,
        courier_company: order.courier?.company || '', office_wilaya: order.courier?.wilaya || '', office_commune: order.courier?.commune || '', courier_office: order.courier?.office || '',
    }));
    useEffect(() => { window.electronAPI.website.orderChoices({ id: order.id }).then(setChoices, () => setChoices({ lines: {}, wilayas: [], couriers: [] })); }, [order.id]);
    const setLine = (n, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, i) => (i === n ? { ...l, ...patch } : l)) }));
    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
    const details = () => ({
        ...form,
        lines: form.lines.filter(l => l.keep).map(l => ({ line: l.line, size: l.size, color: l.color, quantity: Number(l.quantity), unit_price: l.unit_price === '' ? null : Number(l.unit_price) })),
    });
    const total = form.lines.filter(l => l.keep).reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
    const run = (fn, after) => {
        setBusy(true);
        fn().then((r) => { setBusy(false); after(r); }, (e) => { setBusy(false); toast.error(translateError(e)); });
    };
    const contacted = () => run(() => window.electronAPI.website.setOrderStatus({ id: order.id, status: 'contacted' }), () => { toast.success(t('website.confirm.contactedDone')); onDone(null); });
    const confirm = () => run(() => window.electronAPI.website.confirmOrder({ id: order.id, details: details() }), (r) => { toast.success(t('website.confirm.done', { number: r.order.number })); onDone(r.order); });
    const field = 'input w-full';
    return (
        <Modal isOpen onClose={onClose} title={t('website.confirm.title', { number: order.number })} size="lg">
            <div className="space-y-4" data-testid="website-confirm">
                <p className="text-sm text-zinc-300 leading-relaxed">{t('website.confirm.call')} <a className="font-mono text-indigo-300" dir="ltr" href={`tel:${order.phone}`}>{order.phone}</a> — <bdi>{order.customerName}</bdi></p>
                <p className="text-xs text-zinc-500">{t('website.confirm.checklist')}</p>
                <div className="space-y-2">
                    {form.lines.map((l, n) => {
                        const c = choices?.lines?.[l.line];
                        const variants = c?.variants || [];
                        const chosen = variants.find(v => v.color === l.color && v.size === l.size);
                        const avail = variants.length ? (chosen ? chosen.stock + (c.reserved || 0) : 0) : c?.stock;
                        return (
                            <div key={l.line} className={`rounded-lg bg-dark-tertiary/50 p-3 space-y-2 ${l.keep ? '' : 'opacity-50'}`} data-testid="website-confirm-line">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium"><bdi>{l.productName}</bdi></span>
                                    <label className="text-xs text-zinc-400 flex items-center gap-1"><input type="checkbox" checked={l.keep} onChange={(e) => setLine(n, { keep: e.target.checked })} /> {t('website.confirm.keepLine')}</label>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {variants.length > 0 && (
                                        <label className="col-span-2 space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.sizeColor')}</span>
                                            <select className={field} value={`${l.color}\u0000${l.size}`} onChange={(e) => { const [color, size] = e.target.value.split('\u0000'); setLine(n, { color, size }); }} data-testid="website-confirm-variant">
                                                {!chosen && <option value={`${l.color}\u0000${l.size}`}>{[l.size, l.color].filter(Boolean).join(' · ')} — {t('website.confirm.notInCatalogue')}</option>}
                                                {variants.map(v => <option key={`${v.color}|${v.size}`} value={`${v.color}\u0000${v.size}`}>{[v.size, v.color].filter(Boolean).join(' · ')} ({t('website.confirm.inStock', { n: v.stock + (v.color === l.color && v.size === l.size ? c.reserved : 0) })})</option>)}
                                            </select>
                                        </label>
                                    )}
                                    <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.orders.col.quantity')}</span>
                                        <input className={field} type="number" min="1" max="20" value={l.quantity} onChange={(e) => setLine(n, { quantity: e.target.value })} data-testid="website-confirm-qty" /></label>
                                    <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.price')}</span>
                                        <input className={field} type="number" min="0" step="10" value={l.unit_price} onChange={(e) => setLine(n, { unit_price: e.target.value })} dir="ltr" data-testid="website-confirm-price" /></label>
                                </div>
                                {avail !== null && avail !== undefined && <p className={`text-xs ${Number(l.quantity) > avail ? 'text-red-400' : 'text-zinc-500'}`}>{t('website.confirm.available', { n: avail })}</p>}
                            </div>
                        );
                    })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.wilaya')}</span>
                        <input className={field} list="website-wilayas" value={form.wilaya} onChange={set('wilaya')} data-testid="website-confirm-wilaya" /></label>
                    <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.commune')}</span>
                        <input className={field} value={form.commune} onChange={set('commune')} data-testid="website-confirm-commune" /></label>
                    <datalist id="website-wilayas">{(choices?.wilayas || []).map(w => <option key={w} value={w} />)}</datalist>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                    {['home', 'office'].map(d => (
                        <label key={d} className="flex items-center gap-2"><input type="radio" name="delivery" checked={form.delivery === d} onChange={() => setForm(f => ({ ...f, delivery: d }))} /> {t(`website.orders.delivery.${d}`)}</label>
                    ))}
                </div>
                {form.delivery === 'home' ? (
                    <label className="block space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.address')}</span>
                        <input className={field} value={form.address} onChange={set('address')} data-testid="website-confirm-address" /></label>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.courier')}</span>
                            <input className={field} list="website-couriers" value={form.courier_company} onChange={set('courier_company')} data-testid="website-confirm-courier" /></label>
                        <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.office')}</span>
                            <input className={field} value={form.courier_office} onChange={set('courier_office')} data-testid="website-confirm-office" /></label>
                        <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.officeWilaya')}</span>
                            <input className={field} list="website-wilayas" value={form.office_wilaya} onChange={set('office_wilaya')} /></label>
                        <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.confirm.officeCommune')}</span>
                            <input className={field} value={form.office_commune} onChange={set('office_commune')} /></label>
                        <datalist id="website-couriers">{(choices?.couriers || []).map(c => <option key={c} value={c} />)}</datalist>
                    </div>
                )}
                <div className="flex items-center justify-between border-t border-dark-border pt-3">
                    <span className="text-sm text-zinc-400">{t('website.confirm.totalCod')}</span>
                    <span className="text-lg font-bold" data-testid="website-confirm-total"><bdi dir="ltr">{formatMoney(total)}</bdi></span>
                </div>
                <p className="text-xs text-sky-300">{t('website.confirm.reserveHint')}</p>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
                    {order.status === 'new' && <Button variant="secondary" onClick={contacted} loading={busy} data-testid="website-confirm-contacted">{t('website.confirm.contacted')}</Button>}
                    <Button onClick={confirm} loading={busy} disabled={!form.lines.some(l => l.keep)} data-testid="website-confirm-save"><CheckCircle2 className="w-4 h-4" /> {t('website.confirm.save')}</Button>
                </div>
            </div>
        </Modal>
    );
}

/** The shipping label (100 x 150 mm): seen here, printed on any printer, or saved as PDF. */
function ShippingLabel({ order, onClose }) {
    const { t } = useT();
    const [html, setHtml] = useState('');
    const [busy, setBusy] = useState(null);
    useEffect(() => { window.electronAPI.website.labelHtml({ id: order.id }).then(setHtml, (e) => { toast.error(translateError(e)); onClose(); }); }, [order.id]);
    const run = (key, fn, ok) => {
        setBusy(key);
        fn().then((r) => { setBusy(null); if (r) toast.success(ok); }, (e) => { setBusy(null); toast.error(translateError(e)); });
    };
    return (
        <Modal isOpen onClose={onClose} title={t('website.label.title', { number: order.number })} size="lg">
            <div className="space-y-3" data-testid="website-label">
                <div className="flex justify-center bg-white rounded-lg p-2 overflow-auto">
                    {/* No script in the label: a sandboxed frame without scripts */}
                    {html && <iframe title={t('website.label.title', { number: order.number })} sandbox="" srcDoc={html} className="bg-white" style={{ width: '100mm', height: '150mm', border: 0 }} data-testid="website-label-frame" />}
                </div>
                <p className="text-xs text-zinc-500">{t('website.label.hint')}</p>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
                    <Button variant="secondary" onClick={() => run('pdf', () => window.electronAPI.website.saveLabelPdf({ id: order.id }), t('website.label.saved'))} loading={busy === 'pdf'} data-testid="website-label-pdf"><FileDown className="w-4 h-4" /> {t('website.label.pdf')}</Button>
                    <Button onClick={() => run('print', () => window.electronAPI.website.printLabel({ id: order.id }), t('website.label.printed'))} loading={busy === 'print'} data-testid="website-label-print"><Printer className="w-4 h-4" /> {t('website.label.print')}</Button>
                </div>
            </div>
        </Modal>
    );
}

/**
 * Opening hours, social pages and a map link: shown on the website only
 * (kept with the website, not in the shop's settings). The shop's name,
 * phone, address and logo come from Settings.
 */
/** The website's features, one switch each, saved at once (on the website at the next update). */
const FEATURE_KEYS = [
    ['orderForm', 'website.features.orderForm'], ['whatsappOrder', 'website.features.whatsappOrder'], ['cart', 'website.features.cart'],
    ['homeDelivery', 'website.features.homeDelivery'], ['officeDelivery', 'website.features.officeDelivery'],
    ['noteField', 'website.features.noteField'], ['trustBar', 'website.features.trustBar'],
    ['coupons', 'website.features.coupons'], ['fewLeft', 'website.features.fewLeft'],
];
function FeaturesCard({ site, busy, run }) {
    const { t } = useT();
    const f = site.publicInfo?.features || {};
    const toggle = (key, on) => run(`feature-${key}`, () => window.electronAPI.website.setFeatures({ [key]: on }), (next) => {
        const now = next?.publicInfo?.features || {};
        // A switch the program kept on (always a way to order and to deliver)
        if (now[key] !== on) toast.error(t('website.features.keptOn'), 6000);
        else toast.success(t('website.info.saved'));
    });
    return (
        <section className="card space-y-3" data-testid="website-features">
            <h2 className="font-semibold flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-indigo-300" /> {t('website.features.title')}</h2>
            <p className="text-xs text-zinc-500 leading-relaxed">{t('website.features.hint')}</p>
            <ul className="divide-y divide-white/5">
                {FEATURE_KEYS.map(([key, label]) => (
                    <li key={key} className="flex items-start justify-between gap-4 py-2.5">
                        <span className="min-w-0">
                            <span className="block text-sm">{t(label)}</span>
                            <span className="block text-xs text-zinc-500 leading-relaxed">{t(`${label}Hint`)}</span>
                        </span>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                            <input type="checkbox" className="sr-only peer" checked={f[key] !== false} disabled={busy === `feature-${key}`}
                                onChange={(e) => toggle(key, e.target.checked)} data-testid={`website-feature-${key}`} aria-label={t(label)} />
                            <span className="w-10 h-6 rounded-full bg-zinc-700 peer-checked:bg-indigo-500 transition-colors" />
                            <span className="absolute top-1 start-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
                        </label>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function PublicInfoCard({ site, busy, run }) {
    const { t } = useT();
    const saved = site.publicInfo || { hours: [], social: {}, mapUrl: '' };
    const fromSaved = () => ({ hours: (saved.hours || []).join('\n'), facebook: saved.social?.facebook || '', instagram: saved.social?.instagram || '', tiktok: saved.social?.tiktok || '', mapUrl: saved.mapUrl || '', couriers: saved.couriers || [] });
    const [form, setForm] = useState(fromSaved);
    useEffect(() => { setForm(fromSaved()); }, [JSON.stringify(saved)]);
    const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));
    const save = () => run('info', () => window.electronAPI.website.setPublicInfo({
        hours: form.hours, social: { facebook: form.facebook, instagram: form.instagram, tiktok: form.tiktok }, mapUrl: form.mapUrl, couriers: form.couriers,
    }), (next) => {
        const refused = next?.result?.refused || [];
        if (refused.length) toast.error(t('website.info.refused', { list: refused.map(k => t(`website.info.${k}`)).join('، ') }), 7000);
        else toast.success(t('website.info.saved'));
    });
    const field = (key, label, placeholder) => (
        <label className="block space-y-1">
            <span className="text-xs text-zinc-400">{label}</span>
            <input className="input w-full" dir="ltr" value={form[key]} onChange={set(key)} placeholder={placeholder} maxLength={300} data-testid={`website-info-${key}`} />
        </label>
    );
    return (
        <section className="card space-y-3" data-testid="website-info">
            <h2 className="font-semibold flex items-center gap-2"><Store className="w-4 h-4 text-indigo-300" /> {t('website.info.title')}</h2>
            <p className="text-xs text-zinc-500 leading-relaxed">{t('website.info.hint')}</p>
            <label className="block space-y-1">
                <span className="text-xs text-zinc-400">{t('website.info.hours')}</span>
                <textarea className="input w-full" rows={3} value={form.hours} onChange={set('hours')} placeholder={t('website.info.hoursPlaceholder')} maxLength={800} data-testid="website-info-hours" />
            </label>
            {field('facebook', t('website.info.facebook'), 'https://facebook.com/…')}
            {field('instagram', t('website.info.instagram'), 'https://instagram.com/…')}
            {field('tiktok', t('website.info.tiktok'), 'https://tiktok.com/@…')}
            {field('mapUrl', t('website.info.mapUrl'), 'https://maps.app.goo.gl/…')}
            <fieldset className="space-y-2" data-testid="website-info-couriers">
                <legend className="text-xs text-zinc-400">{t('website.info.couriers')}</legend>
                <div className="flex flex-wrap gap-2">
                    {(site.couriersList || []).map(c => (
                        <label key={c.id} className="flex items-center gap-2 rounded-lg bg-dark-tertiary/60 px-2 py-1 text-sm cursor-pointer">
                            <input type="checkbox" checked={form.couriers.includes(c.id)} data-testid={`website-courier-${c.id}`}
                                onChange={(e) => setForm(f => ({ ...f, couriers: e.target.checked ? [...f.couriers, c.id] : f.couriers.filter(x => x !== c.id) }))} />
                            <span dir="ltr">{c.name}</span>
                        </label>
                    ))}
                </div>
                <p className="text-xs text-zinc-500">{t('website.info.couriersHint')}</p>
            </fieldset>
            <div className="flex justify-end">
                <Button size="sm" onClick={save} loading={busy === 'info'} data-testid="website-info-save">{t('common.save')}</Button>
            </div>
        </section>
    );
}


/**
 * Under an order's status: the WhatsApp message to the customer (the shop's
 * own words), the parcel's tracking number (typed, or given by Yalidine when
 * it is linked) and the courier's page of it.
 */
function OrderTools({ order, onChanged }) {
    const { t } = useT();
    const [busy, setBusy] = useState('');
    const [number, setNumber] = useState(order.trackingNumber || '');
    const [linked, setLinked] = useState(false);
    useEffect(() => { setNumber(order.trackingNumber || ''); }, [order.trackingNumber]);
    useEffect(() => { window.electronAPI.website.getState().then(v => setLinked(!!v?.tools?.yalidine?.linked)).catch(() => {}); }, []);
    const go = async (id, fn, ok) => {
        setBusy(id);
        try { await fn(); if (ok) toast.success(ok); onChanged?.(); } catch (e) { toast.error(translateError(e)); } finally { setBusy(''); }
    };
    return (
        <div className="space-y-1.5 min-w-[11rem]" data-testid="website-order-tools">
            <Button size="sm" variant="secondary" className="w-full" loading={busy === 'wa'} data-testid={`website-order-whatsapp-${order.number}`}
                onClick={() => go('wa', () => window.electronAPI.website.confirmMessage({ id: order.id, open: true }))}>
                <PhoneCall className="w-4 h-4" /> {t('website.orders.whatsappConfirm')}
            </Button>
            <div className="flex gap-1">
                <input className="input input-sm flex-1 min-w-0 font-mono" dir="ltr" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={t('website.orders.trackingPh')}
                    aria-label={t('website.orders.tracking')} maxLength={40} data-testid={`website-order-tracking-${order.number}`} />
                <Button size="sm" variant="ghost" loading={busy === 'tr'} disabled={number === (order.trackingNumber || '')}
                    onClick={() => go('tr', () => window.electronAPI.website.setTracking({ id: order.id, number }), t('website.orders.trackingSaved'))} data-testid={`website-order-tracking-save-${order.number}`}>
                    {t('common.save')}
                </Button>
            </div>
            {order.trackingUrl && (
                <button type="button" className="text-xs text-indigo-300 underline" onClick={() => window.electronAPI.website.openTracking(order.trackingUrl)}>{t('website.orders.trackingOpen')}</button>
            )}
            {linked && order.delivery === 'home' && !order.trackingNumber && ['confirmed', 'preparing'].includes(order.status) && (
                <Button size="sm" variant="ghost" className="w-full" loading={busy === 'ya'} data-testid={`website-order-yalidine-${order.number}`}
                    onClick={() => go('ya', () => window.electronAPI.website.yalidineSend({ id: order.id }), t('website.orders.yalidineSent'))}>
                    {t('website.orders.yalidineSend')}
                </Button>
            )}
            {linked && order.trackingNumber && (
                <button type="button" className="text-xs text-zinc-400 underline" onClick={() => go('yr', () => window.electronAPI.website.yalidineRefresh({ id: order.id }))}>
                    {t('website.orders.courierRefresh')}
                </button>
            )}
            {order.courierState && <span className="block text-xs text-sky-300" data-testid="website-order-courier-state">{order.courierState}</span>}
        </div>
    );
}

/** Visits of the website and its orders, day by day and by article (the counts sent by the website). */
function WebsiteStats() {
    const { t } = useT();
    const [days, setDays] = useState(7);
    const [data, setData] = useState(null);
    useEffect(() => { window.electronAPI.website.stats({ days }).then(setData).catch(() => setData(null)); }, [days]);
    const max = Math.max(1, ...(data?.perDay || []).map(d => d.views));
    return (
        <section className="card space-y-3 xl:col-span-3" data-testid="website-stats">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-indigo-300" /> {t('website.stats.title')}</h2>
                <Tabs tabs={[7, 14, 30].map(n => ({ id: String(n), label: t('website.stats.days', { n }) }))} value={String(days)} onChange={(v) => setDays(Number(v))} testId="website-stats-days" />
            </div>
            <p className="text-xs text-zinc-500">{t('website.stats.hint')}</p>
            {data && (
                <>
                    <div className="grid fit-grid-sm gap-3">
                        <StatTile icon={Globe} label={t('website.stats.views')} value={formatNumber(data.totalViews)} />
                        <StatTile icon={ShoppingBag} label={t('website.stats.orders')} value={formatNumber(data.totalOrders)} iconTone="bg-emerald-500/15 text-emerald-300" />
                        <StatTile icon={BarChart3} label={t('website.stats.rate')} value={data.rate === null ? '—' : `${data.rate}%`} iconTone="bg-amber-500/15 text-amber-300" />
                    </div>
                    <div className="flex items-end gap-1 h-28" aria-label={t('website.stats.views')}>
                        {data.perDay.map(d => (
                            <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.day}: ${d.views} / ${d.orders}`}>
                                <div className="w-full rounded-t bg-indigo-500/60" style={{ height: `${Math.max(2, (d.views / max) * 96)}px` }} />
                                <span className="text-[10px] text-zinc-500">{d.day.slice(8)}</span>
                            </div>
                        ))}
                    </div>
                    {data.products.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm" data-testid="website-stats-products">
                                <thead className="text-zinc-500 text-xs"><tr>{['article', 'views', 'orders', 'rate'].map(k => <th key={k} className="text-start font-medium py-1.5 px-2">{t(`website.stats.col.${k}`)}</th>)}</tr></thead>
                                <tbody>
                                    {data.products.map(p => (
                                        <tr key={p.id} className="border-t border-dark-border">
                                            <td className="py-1.5 px-2"><bdi>{p.name}</bdi></td>
                                            <td className="py-1.5 px-2">{formatNumber(p.views)}</td>
                                            <td className="py-1.5 px-2">{formatNumber(p.orders)}</td>
                                            <td className={`py-1.5 px-2 ${p.views >= 20 && !p.orders ? 'text-amber-300' : ''}`}>{p.rate === null ? '—' : `${p.rate}%`}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {data.viewsAt && <p className="text-xs text-zinc-500">{t('website.stats.at', { when: formatDate(data.viewsAt, 'datetime') })}</p>}
                </>
            )}
        </section>
    );
}

/** One card of the settings tabs: title, hint, body, a Save at the bottom when it has one. */
function SettingsCard({ testId, icon: Icon = Settings2, title, hint, children, onSave, saving }) {
    const { t } = useT();
    return (
        <section className="card space-y-3" data-testid={testId}>
            <h2 className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4 text-indigo-300" /> {title}</h2>
            {hint && <p className="text-xs text-zinc-500 leading-relaxed">{hint}</p>}
            {children}
            {onSave && <div className="flex justify-end"><Button size="sm" onClick={onSave} loading={saving} data-testid={`${testId}-save`}>{t('common.save')}</Button></div>}
        </section>
    );
}

/** Delivery prices: home and courier office everywhere, the wilayas that differ, free above an amount. */
function DeliveryPricesCard({ site, busy, run }) {
    const { t, lang } = useT();
    const saved = site.publicInfo?.delivery || { home: null, office: null, freeOver: null, wilayas: [] };
    const asText = (v) => (v === null || v === undefined ? '' : String(v));
    const fromSaved = () => ({
        home: asText(saved.home), office: asText(saved.office), freeOver: asText(saved.freeOver),
        rows: Object.fromEntries((saved.wilayas || []).map(w => [w.code, { home: asText(w.home), office: asText(w.office), off: !!w.off }])),
    });
    const [form, setForm] = useState(fromSaved);
    useEffect(() => { setForm(fromSaved()); }, [JSON.stringify(saved)]);
    const setRow = (code, key, value) => setForm(f => ({ ...f, rows: { ...f.rows, [code]: { home: '', office: '', off: false, ...f.rows[code], [key]: value } } }));
    const num = (v) => (String(v).trim() === '' ? null : Number(v));
    const save = () => run('delivery', () => window.electronAPI.website.setSettings({
        delivery: {
            home: num(form.home), office: num(form.office), freeOver: num(form.freeOver),
            wilayas: Object.entries(form.rows).map(([code, r]) => ({ code: Number(code), home: num(r.home), office: num(r.office), off: !!r.off })),
        },
    }), () => toast.success(t('website.info.saved')));
    const money = (value, onChange, testid, label) => (
        <input className="input w-full" type="number" min="0" step="10" inputMode="numeric" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}
            placeholder="—" aria-label={label} data-testid={testid} />
    );
    return (
        <SettingsCard testId="website-delivery" icon={Package} title={t('website.delivery.title')} hint={t('website.delivery.hint')} onSave={save} saving={busy === 'delivery'}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.delivery.home')}</span>{money(form.home, (v) => setForm(f => ({ ...f, home: v })), 'website-delivery-home', t('website.delivery.home'))}</label>
                <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.delivery.office')}</span>{money(form.office, (v) => setForm(f => ({ ...f, office: v })), 'website-delivery-office', t('website.delivery.office'))}</label>
                <label className="space-y-1"><span className="text-xs text-zinc-400">{t('website.delivery.freeOver')}</span>{money(form.freeOver, (v) => setForm(f => ({ ...f, freeOver: v })), 'website-delivery-free', t('website.delivery.freeOver'))}</label>
            </div>
            <p className="text-xs text-zinc-500">{t('website.delivery.perWilaya')}</p>
            <div className="max-h-[420px] overflow-y-auto border border-dark-border rounded-lg">
                <table className="w-full text-sm" data-testid="website-delivery-wilayas">
                    <thead className="text-xs text-zinc-500 sticky top-0 bg-dark-secondary"><tr>
                        <th className="text-start font-medium p-2">{t('website.delivery.wilaya')}</th><th className="text-start font-medium p-2">{t('website.delivery.home')}</th>
                        <th className="text-start font-medium p-2">{t('website.delivery.office')}</th><th className="text-start font-medium p-2">{t('website.delivery.off')}</th>
                    </tr></thead>
                    <tbody>
                        {WILAYAS.map(({ code, fr, ar }) => {
                            const n = Number(code);
                            const r = form.rows[n] || { home: '', office: '', off: false };
                            return (
                                <tr key={code} className="border-t border-dark-border">
                                    <td className="p-2 whitespace-nowrap"><bdi>{code} - {lang === 'ar' ? ar : fr}</bdi></td>
                                    <td className="p-1.5 w-32">{money(r.home, (v) => setRow(n, 'home', v), `website-delivery-${n}-home`, `${code} ${t('website.delivery.home')}`)}</td>
                                    <td className="p-1.5 w-32">{money(r.office, (v) => setRow(n, 'office', v), `website-delivery-${n}-office`, `${code} ${t('website.delivery.office')}`)}</td>
                                    <td className="p-2"><input type="checkbox" checked={!!r.off} onChange={(e) => setRow(n, 'off', e.target.checked)} aria-label={`${code} ${t('website.delivery.off')}`} data-testid={`website-delivery-${n}-off`} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </SettingsCard>
    );
}

/** The WhatsApp message to confirm an order, and the new-order alert. */
function MessagesCard({ site, busy, run }) {
    const { t } = useT();
    const saved = site.tools?.confirmMessage || '';
    const [text, setText] = useState(saved || site.defaultConfirmMessage || '');
    useEffect(() => { setText(saved || site.defaultConfirmMessage || ''); }, [saved]);
    return (
        <div className="space-y-4">
            <SettingsCard testId="website-messages" icon={PhoneCall} title={t('website.messages.title')} hint={t('website.messages.hint')}
                onSave={() => run('messages', () => window.electronAPI.website.setSettings({ confirmMessage: text === site.defaultConfirmMessage ? '' : text }), () => toast.success(t('website.info.saved')))} saving={busy === 'messages'}>
                <textarea className="input w-full font-sans" rows={7} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} data-testid="website-messages-text" />
                <p className="text-xs text-zinc-500">{t('website.messages.fields')}</p>
                <button type="button" className="text-xs text-indigo-300 underline" onClick={() => setText(site.defaultConfirmMessage || '')}>{t('website.messages.reset')}</button>
            </SettingsCard>
            <SettingsCard testId="website-notify" icon={ShoppingBag} title={t('website.notify.title')} hint={t('website.notify.hint')}>
                <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <input type="checkbox" checked={site.tools?.notify !== false} data-testid="website-notify-on"
                        onChange={(e) => run('notify', () => window.electronAPI.website.setSettings({ notify: e.target.checked }))} />
                    {t('website.notify.on')}
                </label>
            </SettingsCard>
        </div>
    );
}

const TRACKERS = [
    ['facebook', 'website.tracking.facebook', '1234567890123456'],
    ['tiktok', 'website.tracking.tiktok', 'C4ABCDEFGHIJ1234KLMN'],
    ['snapchat', 'website.tracking.snapchat', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
    ['google', 'website.tracking.google', 'G-XXXXXXXXXX'],
];
/** Ads and visit tools of the shop's own accounts: an id each, checked; empty = off. */
function TrackingCard({ site, busy, run }) {
    const { t } = useT();
    const saved = site.publicInfo?.tracking || {};
    const [form, setForm] = useState(saved);
    useEffect(() => { setForm(saved); }, [JSON.stringify(saved)]);
    const save = () => run('tracking', () => window.electronAPI.website.setSettings({ tracking: form }), (next) => {
        const kept = next?.publicInfo?.tracking || {};
        const refused = TRACKERS.filter(([k]) => String(form[k] || '').trim() && !kept[k]).map(([, label]) => t(label));
        if (refused.length) toast.error(t('website.tracking.refused', { list: refused.join('، ') }), 7000);
        else toast.success(t('website.info.saved'));
    });
    return (
        <SettingsCard testId="website-tracking" icon={BarChart3} title={t('website.tracking.title')} hint={t('website.tracking.hint')} onSave={save} saving={busy === 'tracking'}>
            {TRACKERS.map(([k, label, ph]) => (
                <label key={k} className="block space-y-1">
                    <span className="text-xs text-zinc-400 flex items-center gap-2">{t(label)} {saved[k] && <span className="badge bg-emerald-500/15 text-emerald-300">{t('website.tracking.on')}</span>}</span>
                    <input className="input w-full font-mono" dir="ltr" value={form[k] || ''} onChange={(e) => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={ph} maxLength={60} data-testid={`website-tracking-${k}`} />
                </label>
            ))}
            <p className="text-xs text-zinc-500">{t('website.tracking.privacy')}</p>
        </SettingsCard>
    );
}

/** Numbers the website takes no order from; customers who often send parcels back. */
function BlockedPhonesCard({ site, busy, run }) {
    const { t } = useT();
    const [phone, setPhone] = useState('');
    const [note, setNote] = useState('');
    const [suggested, setSuggested] = useState([]);
    const list = site.tools?.blocked || [];
    useEffect(() => { window.electronAPI.website.blockSuggestions().then(setSuggested).catch(() => setSuggested([])); }, [list.length]);
    const block = (p, n = '') => run('block', () => window.electronAPI.website.blockPhone({ phone: p, note: n }), () => { setPhone(''); setNote(''); toast.success(t('website.blocked.added')); });
    return (
        <SettingsCard testId="website-blocked" icon={XCircle} title={t('website.blocked.title')} hint={t('website.blocked.hint')}>
            <div className="flex flex-wrap gap-2">
                <input className="input flex-1 min-w-[10rem] font-mono" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0661 22 33 44" data-testid="website-blocked-phone" />
                <input className="input flex-1 min-w-[10rem]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('website.blocked.note')} maxLength={120} />
                <Button size="sm" onClick={() => block(phone, note)} disabled={!phone.trim()} loading={busy === 'block'} data-testid="website-blocked-add">{t('website.blocked.add')}</Button>
            </div>
            {list.length === 0 ? <p className="text-sm text-zinc-500">{t('website.blocked.none')}</p> : (
                <ul className="divide-y divide-white/5" data-testid="website-blocked-list">
                    {list.map(b => (
                        <li key={b.phone} className="flex items-center justify-between gap-3 py-2">
                            <span className="min-w-0"><bdi dir="ltr" className="font-mono">{b.phone}</bdi>{b.note && <span className="ms-2 text-xs text-zinc-500">{b.note}</span>}</span>
                            <Button size="sm" variant="ghost" onClick={() => run('unblock', () => window.electronAPI.website.unblockPhone({ phone: b.phone }))} data-testid={`website-unblock-${b.phone}`}>{t('website.blocked.remove')}</Button>
                        </li>
                    ))}
                </ul>
            )}
            {suggested.length > 0 && (
                <div className="space-y-2" data-testid="website-blocked-suggested">
                    <p className="text-xs text-amber-300">{t('website.blocked.suggested')}</p>
                    <ul className="divide-y divide-white/5">
                        {suggested.map(c => (
                            <li key={c.phone} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="min-w-0"><bdi>{c.name}</bdi> <bdi dir="ltr" className="font-mono text-zinc-400">{c.phone}</bdi>
                                    <span className="ms-2 text-xs text-amber-300">{t('website.customers.returnedN', { n: c.returned })}</span></span>
                                <Button size="sm" variant="ghost" onClick={() => block(c.phone, t('website.blocked.autoNote'))}>{t('website.blocked.add')}</Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </SettingsCard>
    );
}

/** A size guide per category, the "few left" level, coupons on the website. */
function SizeGuidesCard({ site, busy, run }) {
    const { t } = useT();
    const cats = site.categoriesList || [];
    const saved = site.publicInfo?.sizeGuides || [];
    const fromSaved = () => Object.fromEntries(saved.map(g => [g.categoryId, g.text]));
    const [texts, setTexts] = useState(fromSaved);
    const [few, setFew] = useState(String(site.publicInfo?.fewLeftAt ?? 3));
    useEffect(() => { setTexts(fromSaved()); }, [JSON.stringify(saved)]);
    const save = () => run('sizes', () => window.electronAPI.website.setSettings({
        sizeGuides: Object.entries(texts).filter(([, v]) => String(v || '').trim()).map(([categoryId, text]) => ({ categoryId, text })),
        fewLeftAt: Math.min(20, Math.max(1, parseInt(few, 10) || 3)),
    }), () => toast.success(t('website.info.saved')));
    return (
        <SettingsCard testId="website-sizes" icon={Shirt} title={t('website.sizes.title')} hint={t('website.sizes.hint')} onSave={save} saving={busy === 'sizes'}>
            <label className="flex items-center gap-3 text-sm">
                <span className="text-zinc-300">{t('website.sizes.fewAt')}</span>
                <input className="input w-20" type="number" min="1" max="20" value={few} onChange={(e) => setFew(e.target.value)} data-testid="website-few-at" />
            </label>
            {cats.length === 0 ? <p className="text-sm text-zinc-500">{t('website.sizes.noCategories')}</p> : cats.map(c => (
                <label key={c.id} className="block space-y-1">
                    <span className="text-xs text-zinc-400"><bdi>{c.name}</bdi></span>
                    <textarea className="input w-full" rows={3} maxLength={800} value={texts[c.id] || ''} onChange={(e) => setTexts(x => ({ ...x, [c.id]: e.target.value }))}
                        placeholder={t('website.sizes.placeholder')} data-testid={`website-size-guide-${c.id}`} />
                </label>
            ))}
        </SettingsCard>
    );
}

/** The couriers: their tracking pages, and Yalidine's own account (to send parcels from AFUS). */
function CourierApiCard({ site, busy, run }) {
    const { t } = useT();
    const saved = site.tools?.trackingLinks || {};
    const [links, setLinks] = useState(saved);
    const [key, setKey] = useState({ id: '', token: '', fromWilaya: '' });
    useEffect(() => { setLinks(saved); }, [JSON.stringify(saved)]);
    const companies = (site.couriersList || []).map(c => c.name);
    const linked = !!site.tools?.yalidine?.linked;
    return (
        <div className="space-y-4">
            <SettingsCard testId="website-tracking-links" icon={Package} title={t('website.couriers.linksTitle')} hint={t('website.couriers.linksHint')}
                onSave={() => run('links', () => window.electronAPI.website.setSettings({ trackingLinks: links }), (next) => {
                    const kept = next?.tools?.trackingLinks || {};
                    const refused = Object.entries(links).filter(([k, v]) => String(v || '').trim() && !kept[k]).map(([k]) => k);
                    if (refused.length) toast.error(t('website.couriers.linkRefused', { list: refused.join('، ') }), 7000);
                    else toast.success(t('website.info.saved'));
                })} saving={busy === 'links'}>
                {companies.map(name => (
                    <label key={name} className="block space-y-1">
                        <span className="text-xs text-zinc-400" dir="ltr">{name}</span>
                        <input className="input w-full font-mono text-xs" dir="ltr" value={links[name] || ''} onChange={(e) => setLinks(l => ({ ...l, [name]: e.target.value }))}
                            placeholder="https://…{number}" maxLength={300} data-testid={`website-tracking-link-${name.replace(/\W+/g, '-')}`} />
                    </label>
                ))}
            </SettingsCard>
            <SettingsCard testId="website-yalidine" icon={KeyRound} title={t('website.couriers.yalidineTitle')} hint={t('website.couriers.yalidineHint')}>
                {linked ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="badge bg-emerald-500/15 text-emerald-300" data-testid="website-yalidine-linked">{t('website.couriers.linked', { when: formatDate(site.tools.yalidine.linkedAt, 'date') })}</span>
                        <Button size="sm" variant="ghost" loading={busy === 'yforget'} onClick={() => run('yforget', () => window.electronAPI.website.yalidineForget())}>{t('website.couriers.forget')}</Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input className="input font-mono" dir="ltr" placeholder="API ID" value={key.id} onChange={(e) => setKey(k => ({ ...k, id: e.target.value }))} autoComplete="off" data-testid="website-yalidine-id" />
                        <input className="input font-mono" dir="ltr" type="password" placeholder="API TOKEN" value={key.token} onChange={(e) => setKey(k => ({ ...k, token: e.target.value }))} autoComplete="off" data-testid="website-yalidine-token" />
                        <input className="input" placeholder={t('website.couriers.fromWilaya')} value={key.fromWilaya} onChange={(e) => setKey(k => ({ ...k, fromWilaya: e.target.value }))} data-testid="website-yalidine-from" />
                        <div className="sm:col-span-3 flex justify-end">
                            <Button size="sm" loading={busy === 'ylink'} disabled={!key.id || !key.token} data-testid="website-yalidine-link"
                                onClick={() => run('ylink', () => window.electronAPI.website.yalidineLink(key), () => { setKey({ id: '', token: '', fromWilaya: '' }); toast.success(t('website.couriers.linkedOk')); })}>
                                {t('website.couriers.link')}
                            </Button>
                        </div>
                    </div>
                )}
                <p className="text-xs text-zinc-500">{t('website.couriers.yalidineNote')}</p>
            </SettingsCard>
        </div>
    );
}
