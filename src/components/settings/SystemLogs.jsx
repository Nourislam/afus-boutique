import { t } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { RefreshCw, Search } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

export function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filterOptions = [
    { value: 'all', label: t('logs.all') },
    { value: 'create', label: t('logs.created') },
    { value: 'update', label: t('logs.updated') },
    { value: 'delete', label: t('logs.deleted') },
    { value: 'login', label: t('logs.login') },
    { value: 'system', label: t('logs.system') },
  ];

  useEffect(() => {
    fetchLogs();
  }, [filter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.logs) {
        const data = await window.electronAPI.logs.getAll({ type: filter, limit: 100 });
        setLogs(data);
      }
    } catch (error) {
      console.error('Failed to fetch logs', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => 
    log.description.toLowerCase().includes(search.toLowerCase()) || 
    (log.employee_name && log.employee_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input 
            placeholder={t('logs.search')}
            className="ps-9 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center">
            <div className="w-40">
                <Select
                    value={filter}
                    onChange={(val) => setFilter(val)}
                    options={filterOptions}
                />
            </div>
            <Button onClick={fetchLogs} disabled={loading} variant="secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
        </div>
      </div>

      <div className="space-y-2">
        {filteredLogs.map(log => (
            <Card key={log.id} className="p-3 border-s-4 border-s-transparent hover:border-s-accent-primary transition-all">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        {log.action_type === 'create' && <div className="text-green-400 font-bold text-xs uppercase bg-green-400/10 px-2 py-0.5 rounded">{t('common.create')}</div>}
                        {log.action_type === 'update' && <div className="text-blue-400 font-bold text-xs uppercase bg-blue-400/10 px-2 py-0.5 rounded">{t('common.update')}</div>}
                        {log.action_type === 'delete' && <div className="text-red-400 font-bold text-xs uppercase bg-red-400/10 px-2 py-0.5 rounded">{t('common.delete')}</div>}
                        <span className="font-medium text-white break-words">{log.description}</span>
                    </div>
                    <span className="text-xs text-zinc-500 whitespace-nowrap">
                        {formatLocalDate(log.created_at, 'datetime')}
                    </span>
                </div>
                <div className="mt-2 text-xs text-zinc-400 flex flex-col sm:flex-row justify-between gap-1">
                    <span>{t('logs.userN', { name: log.employee_name || t('logs.system') })}</span>
                    {log.details && <span className="font-mono opacity-50 truncate max-w-full sm:max-w-xs">{log.details.substring(0, 100)}...</span>}
                </div>
            </Card>
        ))}
        {filteredLogs.length === 0 && (
            <div className="text-center p-8 text-zinc-500">
                {t('logs.none')}
            </div>
        )}
      </div>
    </div>
  );
}
