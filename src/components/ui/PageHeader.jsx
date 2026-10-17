import { createContext, useContext } from 'react';

// Set by hub pages (Catalogue, Offers, Labels) that show several screens as
// tabs: the inner screen then shows only its toolbar, not a second title.
export const EmbeddedPageContext = createContext(false);

/**
 * The row at the top of every screen: the page's tabs or tools on one side,
 * its buttons on the other, on one line. The page's name is the highlighted
 * item of the sidebar, so it is not written again (kept for screen readers).
 * `hero` (the dashboard only): the full header with icon, title and subtitle.
 */
export function PageHeader({ icon: Icon, title, subtitle, actions, children, hero = false }) {
    const embedded = useContext(EmbeddedPageContext);
    if (embedded || !hero) {
        if (!actions && !children) return title && !embedded ? <h1 className="sr-only">{title}</h1> : null;
        return (
            <div className="flex-none flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-6 py-3 border-b border-dark-border bg-dark-primary" data-testid="page-toolbar">
                {title && !embedded && <h1 className="sr-only">{title}</h1>}
                <div className="flex-1 min-w-[240px]">{children}</div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
        );
    }
    return (
        <header className="flex-none border-b border-dark-border bg-dark-primary">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
                <div className="flex items-center gap-3 min-w-0">
                    {Icon && (
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center flex-none">
                            <Icon className="w-5 h-5" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold leading-tight truncate">{title}</h1>
                        {subtitle && <p className="text-sm text-zinc-500 truncate">{subtitle}</p>}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children && <div className="px-6 pb-3">{children}</div>}
        </header>
    );
}

export default PageHeader;
