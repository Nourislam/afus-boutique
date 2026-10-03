import { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export default function AIInsightsWidget({ salesData }) {
    const [insights, setInsights] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchInsights = async (force = false) => {
        // Check cache first
        const today = new Date().toDateString();
        const cached = localStorage.getItem('ai_daily_insights');
        
        if (!force && cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed.date === today && parsed.content) {
                    setInsights(parsed.content);
                    return;
                }
            } catch (e) {
                console.error('Cache parse error', e);
            }
        }

        setIsLoading(true);
        setError(null);
        try {
            // If specific sales data isn't passed, we might want to fetch a summary here
            // For now, we assume salesData is passed or we send a generic request
            const dataToAnalyze = salesData || { message: "No recent sales data available." };
            
            const result = await window.electronAPI.ai.getInsights(dataToAnalyze);
            setInsights(result);
            
            // Save to cache
            localStorage.setItem('ai_daily_insights', JSON.stringify({
                date: today,
                content: result
            }));
        } catch (err) {
            console.error('Failed to get AI insights:', err);
            setError('Failed to generate insights. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Only fetch if we have sales data OR if we just want to verify cache
        if (salesData) {
            fetchInsights();
        }
    }, [salesData]); 

    return (
        <Card className="p-4 bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-indigo-500/30">
            <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                        <Sparkles size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-white">AI Insights</h3>
                        <p className="text-xs text-indigo-300">Powered by Gemini AI</p>
                    </div>
                </div>
                <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => fetchInsights(true)} 
                    disabled={isLoading}
                    className="hover:bg-indigo-500/20"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </Button>
            </div>

            <div className="min-h-[100px] text-sm text-zinc-300">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 py-4">
                        <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0s' }} />
                        <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
                        <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.4s' }} />
                        <p className="text-xs text-indigo-400 mt-2">Analyzing sales patterns...</p>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 text-red-400 py-4">
                        <AlertCircle size={16} />
                        <span>{error}</span>
                    </div>
                ) : insights ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                // Override element styles if needed, but prose handles most
                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
                                li: ({node, ...props}) => <li className="text-zinc-300" {...props} />,
                                strong: ({node, ...props}) => <strong className="text-indigo-200 font-semibold" {...props} />
                            }}
                        >
                            {insights}
                        </ReactMarkdown>
                    </div>
                ) : (
                    <p className="text-zinc-500 italic py-4">Click refresh to generate AI insights for your business.</p>
                )}
            </div>
        </Card>
    );
}
