import { t } from '../../i18n';
import { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';

export default function AIAssistant() {
    // ... (rest of the state and logic remains the same until rendering)
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { role: 'model', content: "Hi! I'm your AI assistant. Ask me anything about your sales, inventory, or business performance." }
    ]);
    const [isStreaming, setIsStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const currentStreamRef = useRef('');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    useEffect(() => {
        const removeChunkListener = window.electronAPI.ai.onChatChunk((chunk) => {
            currentStreamRef.current += chunk;
            setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg.role === 'model' && lastMsg.isStreaming) {
                    lastMsg.content = currentStreamRef.current;
                }
                return newMsgs;
            });
        });

        const removeCompleteListener = window.electronAPI.ai.onChatComplete(() => {
            setIsStreaming(false);
            setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg) lastMsg.isStreaming = false;
                return newMsgs;
            });
            currentStreamRef.current = '';
        });

        const removeErrorListener = window.electronAPI.ai.onChatError((err) => {
            setIsStreaming(false);
            toast.error(`${t('ai.error')} ${err}`);
            setMessages(prev => [...prev, { role: 'model', content: t('ai.sorry'), isError: true }]);
        });

        return () => {
            removeChunkListener();
            removeCompleteListener();
            removeErrorListener();
        };
    }, []);

    const handleSend = async () => {
        if (!input.trim() || isStreaming) return;

        const userMsg = input.trim();
        setInput('');
        
        const newHistory = [...messages, { role: 'user', content: userMsg }];
        setMessages(newHistory);

        setMessages(prev => [...prev, { role: 'model', content: '', isStreaming: true }]);
        currentStreamRef.current = '';
        setIsStreaming(true);

        try {
            const historyForBackend = newHistory.slice(0, -1);
            window.electronAPI.ai.chatStream(historyForBackend, userMsg);
        } catch (err) {
            console.error(err);
            setIsStreaming(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            {/* FAB */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed bottom-6 end-6 p-4 rounded-full shadow-lg z-50 transition-all duration-300 hover:scale-110 ${
                    isOpen ? 'bg-zinc-700 rotate-90' : 'bg-gradient-to-r from-indigo-600 to-purple-600 animate-pulse-slow'
                }`}
                title={t('ai.assistant')}
            >
                {isOpen ? <X className="text-white" /> : <Sparkles className="text-white" />}
            </button>

            {/* Chat Window */}
            <div className={`fixed bottom-24 end-6 w-96 h-[500px] bg-dark-secondary border border-dark-border rounded-2xl shadow-2xl z-50 flex flex-col transition-all duration-300 transform origin-bottom-right ${
                isOpen ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'
            }`}>
                {/* Header */}
                <div className="p-4 border-b border-dark-border bg-gradient-to-r from-indigo-900/50 to-purple-900/50 rounded-t-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-500 rounded-lg">
                            <Sparkles size={16} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-sm">{t('ai.assistant')}</h3>
                            <p className="text-[10px] text-indigo-200">{t('ai.powered2')}</p>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                                msg.role === 'user' 
                                    ? 'bg-indigo-600 text-white rounded-ee-none' 
                                    : 'bg-dark-tertiary text-zinc-100 rounded-es-none border border-dark-border'
                            }`}>
                                <div className="prose prose-invert prose-sm max-w-none break-words">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            code({node, inline, className, children, ...props}) {
                                                const match = /language-(\w+)/.exec(className || '');
                                                return !inline && match ? (
                                                    <SyntaxHighlighter
                                                        style={vscDarkPlus}
                                                        language={match[1]}
                                                        PreTag="div"
                                                        {...props}
                                                    >
                                                        {String(children).replace(/\n$/, '')}
                                                    </SyntaxHighlighter>
                                                ) : (
                                                    <code className={className ? className : 'bg-black/30 px-1 py-0.5 rounded text-indigo-300 font-mono text-xs'} {...props}>
                                                        {children}
                                                    </code>
                                                )
                                            }
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                </div>
                                {msg.isStreaming && <span className="inline-block w-1.5 h-3 ms-1 bg-indigo-400 animate-pulse"/>}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-3 border-t border-dark-border">
                    <div className="flex gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('ai.ask')}
                            className="flex-1 bg-dark-tertiary border border-dark-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none h-10 max-h-20"
                            disabled={isStreaming}
                        />
                        <Button 
                            onClick={handleSend} 
                            disabled={!input.trim() || isStreaming}
                            className="bg-indigo-600 hover:bg-indigo-700 px-3 rounded-xl h-10"
                        >
                            {isStreaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
