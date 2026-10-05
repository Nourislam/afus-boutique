import { useSearchParams } from 'react-router-dom';
import { PageHeader, EmbeddedPageContext } from '../ui/PageHeader';
import { Tabs } from '../ui/Tabs';

/**
 * A screen made of several related screens shown as tabs (?tab=<id> in the
 * address, so links and the back button work).
 * tabs: [{ id, label, icon, element }]
 */
export function HubPage({ icon, title, subtitle, tabs }) {
    const [params, setParams] = useSearchParams();
    const current = tabs.find(tab => tab.id === params.get('tab')) || tabs[0];
    return (
        <div className="page">
            <PageHeader icon={icon} title={title} subtitle={subtitle}>
                <Tabs
                    variant="underline"
                    className="-mb-3"
                    tabs={tabs.map(({ id, label, icon: tabIcon }) => ({ id, label, icon: tabIcon }))}
                    value={current.id}
                    onChange={(id) => setParams({ tab: id }, { replace: true })}
                />
            </PageHeader>
            <div className="flex-1 min-h-0">
                <EmbeddedPageContext.Provider value={true}>
                    {current.element}
                </EmbeddedPageContext.Provider>
            </div>
        </div>
    );
}

export default HubPage;
