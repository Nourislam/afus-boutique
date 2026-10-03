import { useState, useEffect, useRef } from 'react';
import { 
    Send, Sparkles, Loader2, Bot, Upload, X, 
    Image as ImageIcon, FileText, Eraser, Minimize2, Maximize2 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { toast } from '../components/ui/Toast';

const AVAILABLE_MODELS = [
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Default, Cost Effective' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Balanced High Performance' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most Capable Reasoning' },
    { id: 'models/gemini-2.5-flash-image', name: 'Nano Banana (Image)', description: 'Specialized Image Model' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Previous Stable' },
    { id: 'models/gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Exp)', description: 'Experimental' },
    { id: 'models/gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS', description: 'Text to Speech Preview' },
    { id: 'models/gemma-3-27b-it', name: 'Gemma 3 27B', description: 'Open Weight Model' },
    { id: 'models/deep-research-pro-preview-12-2025', name: 'Deep Research Pro', description: 'Deep Research Task' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Legacy Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Legacy Flash' },
];

export default function AIChatPage() {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { role: 'model', content: "Hello! I'm your AI assistant. I can analyze sales data, images, and help with your business operations. How can I assist you today?" }
    ]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
    const [attachments, setAttachments] = useState([]); // Array of { name, type, data, preview }
    const messagesEndRef = useRef(null);
    const textInputRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Setup IPC listeners
    useEffect(() => {
        const removeChunkListener = window.electronAPI.ai.onChatChunk((chunk) => {
            setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg.role === 'model' && lastMsg.isStreaming) {
                    lastMsg.content += chunk;
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
        });

        const removeErrorListener = window.electronAPI.ai.onChatError((err) => {
            setIsStreaming(false);
            toast.error('AI Error: ' + err);
            setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg && lastMsg.isStreaming) {
                    lastMsg.isStreaming = false;
                    lastMsg.isError = true;
                    lastMsg.content += "\n\n*[Error encountered]*";
                }
                return newMsgs;
            });
        });

        return () => {
            removeChunkListener();
            removeCompleteListener();
            removeErrorListener();
        };
    }, []);

    const handleFileUpload = (e) => {
        const files = Array.from(e.target.files);
        processFiles(files);
    };

    const processFiles = (files) => {
        if (attachments.length + files.length > 3) {
            toast.error('Maximum 3 items allowed');
            return;
        }

        files.forEach(file => {
            if (!file.type.startsWith('image/')) {
                toast.error(`Invalid file type: ${file.name}. Only images are supported.`);
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result; // data:image/jpeg;base64,...
                setAttachments(prev => [...prev, {
                    name: file.name,
                    type: file.type, // e.g., image/png
                    data: base64, // Full data URL
                    preview: base64
                }]);
            };
            reader.readAsDataURL(file);
        });
        
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeAttachment = (index) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = async () => {
        if ((!input.trim() && attachments.length === 0) || isStreaming) return;

        const userMsgContent = input.trim();
        const currentAttachments = [...attachments]; // Snapshot
        
        setInput('');
        setAttachments([]);
        
        // User Message (display)
        const userMessage = {
            role: 'user',
            content: userMsgContent,
            attachments: currentAttachments 
        };
        
        const newHistory = [...messages, userMessage];
        setMessages(newHistory);

        // Placeholder for Model
        setMessages(prev => [...prev, { role: 'model', content: '', isStreaming: true }]);
        setIsStreaming(true);

        try {
            // Prepare payload for backend
            // Backend expects: history (previous), message (current text), model (optional), images (optional)
            
            // Format history for context (exclude current formatted message, backend handles history mapping usually, 
            // but we need to verify GeminiManager.chatStream signature)
            
            // NOTE: Our current GeminiManager.chatStream takes (history, message). 
            // We need to UPDATE GeminiManager to accept { model, images } options or similar.
            // For now, let's implement the frontend assuming we WILL update the backend next.
            
            const historyForBackend = newHistory.slice(0, -1).map(msg => ({
                role: msg.role,
                content: msg.content
                // Images in history are tricky with standard chat, often need to be managed by SDK session.
                // For simplicity in this iteration, we might send images only with the CURRENT message.
            }));

            // Construct payload
            const payload = {
                history: historyForBackend,
                message: userMsgContent,
                model: selectedModel,
                images: currentAttachments.map(att => att.data) // data URLs
            };

            await window.electronAPI.ai.chatStream(
                payload.history, 
                payload.message,
                payload.model, 
                payload.images
            );

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
        <div className="h-full flex flex-col bg-dark-primary relative overflow-hidden">
            {/* Header */}
            <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-secondary/50 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg shadow-indigo-500/20">
                        <Bot className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-white tracking-tight">AI Assistant</h1>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs text-zinc-400">Online & Ready</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <select 
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-dark-tertiary border border-dark-border text-sm text-zinc-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                    >
                        {AVAILABLE_MODELS.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-dark-border scrollbar-track-transparent">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                        <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            
                            {/* Role Label */}
                            <span className="text-xs text-zinc-500 mb-1 px-1">
                                {msg.role === 'user' ? 'You' : 'AI'}
                            </span>

                            {/* Message Bubble */}
                            <div className={`p-4 rounded-2xl shadow-sm ${
                                msg.role === 'user' 
                                    ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm' 
                                    : 'bg-dark-tertiary text-zinc-100 border border-dark-border rounded-tl-sm'
                            }`}>
                                {/* Attachments Display */}
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="flex gap-2 mb-3 flex-wrap justify-end">
                                        {msg.attachments.map((att, i) => (
                                            <div key={i} className="relative group">
                                                <img src={att.preview} alt="attachment" className="w-32 h-32 object-cover rounded-lg border border-white/20" />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Text Content */}
                                {msg.content && (
                                    <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert text-white' : 'prose-invert'}`}>
                                        <ReactMarkdown
                                            remarkPlugins={[remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={{
                                                code({node, inline, className, children, ...props}) {
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    return !inline && match ? (
                                                        <div className="rounded-lg overflow-hidden my-2 border border-white/10 shadow-sm">
                                                             <div className="bg-black/50 px-3 py-1 text-xs font-mono text-zinc-400 border-b border-white/5 flex justify-between">
                                                                <span>{match[1]}</span>
                                                             </div>
                                                            <SyntaxHighlighter
                                                                style={vscDarkPlus}
                                                                language={match[1]}
                                                                PreTag="div"
                                                                customStyle={{ margin: 0, borderRadius: 0 }}
                                                                {...props}
                                                            >
                                                                {String(children).replace(/\n$/, '')}
                                                            </SyntaxHighlighter>
                                                        </div>
                                                    ) : (
                                                        <code className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                                                            msg.role === 'user' ? 'bg-white/20' : 'bg-black/30'
                                                        }`} {...props}>
                                                            {children}
                                                        </code>
                                                    )
                                                }
                                            }}
                                        >
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {msg.isStreaming && (
                                    <div className="flex gap-1 mt-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"></span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce delay-75"></span>
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce delay-150"></span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-dark-secondary border-t border-dark-border">
                <div className="max-w-4xl mx-auto"> 
                    {/* Attachments Preview */}
                    {attachments.length > 0 && (
                        <div className="flex gap-3 mb-3 p-2 overflow-x-auto">
                            {attachments.map((att, index) => (
                                <div key={index} className="relative group w-16 h-16 shrink-0">
                                    <img src={att.preview} className="w-full h-full object-cover rounded-lg border border-indigo-500/50" />
                                    <button 
                                        onClick={() => removeAttachment(index)}
                                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="relative flex gap-2">
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="p-3 text-zinc-400 hover:text-white hover:bg-dark-tertiary rounded-xl transition-colors border border-transparent hover:border-dark-border"
                            title="Upload Image"
                        >
                            <ImageIcon size={20} />
                        </button>
                        <input 
                            type="file" 
                            multiple 
                            accept="image/*" 
                            ref={fileInputRef} 
                            className="hidden" 
                            onChange={handleFileUpload} 
                        />
                        
                        <textarea
                            ref={textInputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask the assistant anything..."
                            className="flex-1 bg-dark-tertiary border border-dark-border text-white rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none h-12 max-h-32 shadow-inner"
                        />
                        
                        <Button 
                            onClick={handleSend} 
                            disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                            className={`h-12 w-12 p-0 rounded-xl transition-all duration-300 ${
                                input.trim() || attachments.length > 0 
                                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 hover:shadow-lg hover:shadow-indigo-500/25' 
                                    : 'bg-dark-tertiary text-zinc-500'
                            }`}
                        >
                            {isStreaming ? <Loader2 className="animate-spin" /> : <Send size={20} />}
                        </Button>
                    </div>
                </div>
                <div className="text-center mt-2">
                     <p className="text-[10px] text-zinc-500">The AI assistant can make mistakes. Consider checking important information.</p>
                </div>
            </div>
        </div>
    );
}
