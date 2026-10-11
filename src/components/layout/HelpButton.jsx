import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';

// Screen of the current address → its help text and its name (menu label)
const SCREENS = {
    '/pos': ['help.pos', 'nav.sales'],
    '/transactions': ['help.transactions', 'nav.transactions'],
    '/products': ['help.products', 'nav.products'],
    '/inventory': ['help.inventory', 'nav.inventory'],
    '/labels': ['help.labels', 'nav.labels'],
    '/catalog': ['help.catalog', 'nav.catalog'],
    '/customers': ['help.customers', 'nav.customers'],
    '/credit-sales': ['help.credit', 'nav.credit'],
    '/offers': ['help.offers', 'nav.offers'],
    '/suppliers': ['help.suppliers', 'nav.suppliers'],
    '/purchase-orders': ['help.purchases', 'nav.purchases'],
    '/employees': ['help.employees', 'nav.employees'],
    '/reports': ['help.reports', 'nav.reports'],
    '/settings': ['help.settings', 'nav.settings'],
    '/': ['help.dashboard', 'nav.dashboard'],
};

/** Path of the hash route ("#/pos?x=1" → "/pos"); the login screen has none. */
function currentScreen(loggedIn) {
    if (!loggedIn) return ['help.login', 'help.screen.login'];
    const path = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').replace(/\/+$/, '') || '/';
    return SCREENS[path] || SCREENS['/'];
}

/**
 * "?" of the title bar: a few tips for the screen on display (sale, stock,
 * settings…), in the shop's language.
 */
export function HelpButton({ loggedIn = true }) {
    const { t } = useT();
    const [open, setOpen] = useState(false);
    const [screen, setScreen] = useState(() => currentScreen(loggedIn));

    useEffect(() => {
        const update = () => setScreen(currentScreen(loggedIn));
        update();
        window.addEventListener('hashchange', update);
        return () => window.removeEventListener('hashchange', update);
    }, [loggedIn]);

    const [textKey, nameKey] = screen;
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} data-testid="help-button"
                className="titlebar-no-drag flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-white hover:bg-dark-tertiary"
                title={t('help.button')} aria-label={t('help.button')}>
                <HelpCircle className="w-4 h-4" />
            </button>
            <Modal isOpen={open} onClose={() => setOpen(false)} title={t('help.title', { screen: t(nameKey) })} size="md">
                <ModalBody>
                    <ul className="space-y-2 text-sm text-zinc-300 list-disc ps-5" data-testid="help-text">
                        {t(textKey).split('\n').map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    <p className="mt-4 text-xs text-zinc-500">{t('help.more')}</p>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}

export default HelpButton;
