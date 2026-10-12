import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import TrainingBanner from '../training/TrainingBanner';
import DemoBanner from '../demo/DemoBanner';
import BackupReminder from '../backup/BackupReminder';

export default function MainLayout({ children }) {
    return (
        <div className="h-screen w-screen flex flex-col overflow-hidden">
            <TitleBar />
            <DemoBanner />
            <TrainingBanner />
            <BackupReminder />
            <div className="flex-1 flex overflow-hidden">
                <Sidebar />
                <main className="flex-1 overflow-hidden bg-dark-primary relative">
                    {children}
                </main>
            </div>
        </div>
    );
}

