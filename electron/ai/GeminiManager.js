const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const { getDatabase } = require('../database/init');

// API Key priority: 1) User settings, 2) Environment variable, 3) null (disabled)
// For development: set GEMINI_API_KEY in your .env file
// For end users: configure in Settings -> AI Settings
const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || null;
const MODEL_NAME = 'gemini-2.0-flash-lite';

// Rate limiting configuration
const RATE_LIMIT_PER_MINUTE = 10;
const RATE_LIMIT_PER_DAY = 100;

class GeminiManager {
    constructor() {
        this.currentModel = null;
        this.apiKey = DEFAULT_API_KEY;
        this.isEnabled = true;
        
        // Rate limiting tracking
        this.requestTimestamps = []; // For per-minute tracking
        this.dailyRequestCount = 0;
        this.lastDailyReset = null;
    }

    async init() {
        console.log('[GeminiManager] Initializing...');
        try {
            // Load Settings (Safely)
            try {
                const db = getDatabase();
                if (db) {
                    const result = db.exec("SELECT value FROM settings WHERE key = 'ai_settings'");
                    if (result && result.length > 0 && result[0].values && result[0].values.length > 0) {
                        try {
                            const config = JSON.parse(result[0].values[0][0]);
                            if (config.apiKey) this.apiKey = config.apiKey;
                            this.isEnabled = config.enabled !== false;
                            console.log('[GeminiManager] Settings loaded. Enabled:', this.isEnabled);
                        } catch (e) {
                            console.error('[GeminiManager] Failed to parse AI settings', e);
                        }
                    }
                }
            } catch (dbError) {
                console.warn('[GeminiManager] Database access failed (using defaults):', dbError);
            }

            // Initialize LangChain Model
            // NOTE: apiKey is required.
            // Without a key the assistant stays off: nothing is sent to the
            // internet unless the shop enters its own key in Settings
            if (!this.apiKey) {
                console.warn('[GeminiManager] No API key: AI features are off.');
                this.currentModel = null;
                return;
            }

            // Fix for "Cannot read properties of undefined (reading 'replace')"
            // This error in ChatGoogleGenerativeAI usually happens if the model name is missing or the config object is malformed.
            // Some versions expect 'model' property, others 'modelName'. We'll provide both to be safe.
            // Also ensuring apiKey is explicitly a string.
            
            this.currentModel = new ChatGoogleGenerativeAI({
                model: MODEL_NAME,         // Try 'model'
                modelName: MODEL_NAME,     // Fallback 'modelName'
                apiKey: String(this.apiKey),
                maxOutputTokens: 2048,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }
                ]
            });

            console.log('[GeminiManager] Initialized with LangChain Model:', MODEL_NAME);

        } catch (error) {
            console.error('[GeminiManager] CRITICAL Failed to initialize:', error);
            this.isEnabled = false;
        }
    }

    async updateConfig(config) {
        try {
            if (!config) return;
            if (config.apiKey) {
                this.apiKey = config.apiKey;
                this.currentModel = new ChatGoogleGenerativeAI({
                    model: MODEL_NAME,
                    modelName: MODEL_NAME,
                    apiKey: String(this.apiKey)
                });
            }
            if (config.enabled !== undefined) this.isEnabled = config.enabled;
            console.log('[GeminiManager] Config updated');
        } catch (error) {
             console.error('[GeminiManager] Config update failed:', error);
        }
    }

    /**
     * Check if the request is within rate limits
     * @returns {Object} { allowed: boolean, reason?: string, remaining?: { minute: number, daily: number } }
     */
    checkRateLimit() {
        const now = Date.now();
        const today = new Date().toDateString();

        // Reset daily counter if new day
        if (this.lastDailyReset !== today) {
            this.dailyRequestCount = 0;
            this.lastDailyReset = today;
            console.log('[GeminiManager] Daily request counter reset');
        }

        // Clean up old timestamps (older than 1 minute)
        const oneMinuteAgo = now - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

        const remainingMinute = RATE_LIMIT_PER_MINUTE - this.requestTimestamps.length;
        const remainingDaily = RATE_LIMIT_PER_DAY - this.dailyRequestCount;

        // Check per-minute limit
        if (this.requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
            return {
                allowed: false,
                reason: `Rate limit exceeded. Please wait a moment before sending another message. (${RATE_LIMIT_PER_MINUTE} requests per minute)`,
                remaining: { minute: 0, daily: remainingDaily }
            };
        }

        // Check daily limit
        if (this.dailyRequestCount >= RATE_LIMIT_PER_DAY) {
            return {
                allowed: false,
                reason: `Daily limit reached (${RATE_LIMIT_PER_DAY} requests). AI features will reset tomorrow.`,
                remaining: { minute: remainingMinute, daily: 0 }
            };
        }

        return {
            allowed: true,
            remaining: { minute: remainingMinute, daily: remainingDaily }
        };
    }

    /**
     * Record a request for rate limiting
     */
    recordRequest() {
        this.requestTimestamps.push(Date.now());
        this.dailyRequestCount++;
        console.log(`[GeminiManager] Request recorded. Today: ${this.dailyRequestCount}/${RATE_LIMIT_PER_DAY}, This minute: ${this.requestTimestamps.length}/${RATE_LIMIT_PER_MINUTE}`);
    }

    /**
     * Get current rate limit status
     */
    getRateLimitStatus() {
        const check = this.checkRateLimit();
        return {
            perMinute: { used: this.requestTimestamps.length, limit: RATE_LIMIT_PER_MINUTE },
            perDay: { used: this.dailyRequestCount, limit: RATE_LIMIT_PER_DAY },
            allowed: check.allowed
        };
    }

    async generateInsights(salesData) {
        if (!this.isEnabled || !this.currentModel) {
            console.warn('[GeminiManager] Attempted insight generation while disabled/uninit');
            return "AI features are currently unavailable.";
        }

        const prompt = `
        Analyze the following sales data and provide 3 short, actionable insights or tips for the business owner.
        Focus on trends, top sellers, or low stock warnings. Keep it concise.
        
        Data: ${JSON.stringify(salesData)}
        `;

        try {
            const response = await this.currentModel.invoke([
                new SystemMessage("You are a smart retail assistant for this clothing store's point of sale system."),
                new HumanMessage(prompt)
            ]);
            return response.content;
        } catch (error) {
            console.error('[GeminiManager] Insight generation failed:', error);
            return "Unable to generate insights at this time.";
        }
    }

    async getBusinessContext() {
        try {
            const db = getDatabase();
            if (!db) return "No database connection available.";

            // Fetch recent sales (last 7 days approx, simplified to last 50 records)
            // Fixed: used 'created_at' instead of 'date', removed non-existent 'items' column
            const salesResult = db.exec("SELECT total, created_at FROM sales ORDER BY created_at DESC LIMIT 20");
            let salesSummary = "No recent sales.";
            if (salesResult.length > 0 && salesResult[0].values) {
                const sales = salesResult[0].values.map(v => ({ total: v[0], date: v[1] }));
                salesSummary = JSON.stringify(sales);
            }

            // Fetch Top Selling Items (new query)
            let topItemsSummary = "No item data.";
            try {
                const topItemsResult = db.exec("SELECT product_name, SUM(quantity) as qty FROM sale_items GROUP BY product_name ORDER BY qty DESC LIMIT 10");
                if (topItemsResult.length > 0 && topItemsResult[0].values) {
                    const topItems = topItemsResult[0].values.map(v => `${v[0]} (${v[1]} sold)`);
                    topItemsSummary = topItems.join(', ');
                }
            } catch (e) {
                console.warn('Failed to fetch top items', e);
            }

            // Fetch Product Inventory Summary (Top 20 items by stock)
            // Fixed: use stock_quantity, and join with categories
            const stockResult = db.exec(`
                SELECT p.name, p.stock_quantity, p.price, c.name 
                FROM products p 
                LEFT JOIN categories c ON p.category_id = c.id 
                ORDER BY p.stock_quantity ASC 
                LIMIT 50
            `);
            let inventorySummary = "No inventory data.";
            if (stockResult.length > 0 && stockResult[0].values) {
               const products = stockResult[0].values.map(v => `${v[0]} (Stock: ${v[1]}, Price: $${v[2]}, Cat: ${v[3] || 'N/A'})`);
               inventorySummary = products.join('; ');
            }
            
            return `
            CURRENT BUSINESS CONTEXT (Do not reveal unless asked, but use this to answer):
            
            [RECENT SALES LOG]
            ${salesSummary}

            [TOP SELLING ITEMS]
            ${topItemsSummary}
            
            [LOW STOCK / INVENTORY SNAPSHOT]
            ${inventorySummary}
            `;
        } catch (error) {
            console.error('[GeminiManager] Failed to fetch context:', error);
            return "";
        }
    }

    async chatStream(history, message, onChunk, options = {}) {
        // Check rate limit FIRST
        const rateLimitCheck = this.checkRateLimit();
        if (!rateLimitCheck.allowed) {
            throw new Error(rateLimitCheck.reason);
        }

        if (!this.isEnabled || !this.currentModel) {
            // Try to re-init if just missing model
            if (this.currentModel === null && this.isEnabled) {
                 await this.init();
            }
            if (!this.currentModel) {
                throw new Error('AI features are disabled or initialization failed');
            }
        }

        // Record request for rate limiting
        this.recordRequest();

        const { model, images } = options;
        
        // Lightweight model switch
        // Just instantiate a new one if different.
        let chatModel = this.currentModel;
        if (model && model !== MODEL_NAME) {
            try {
                // Ensure we pass the API key explicitly as string
                // And use the correct parameter 'model' per earlier debugging
                chatModel = new ChatGoogleGenerativeAI({
                    model: model, 
                    apiKey: String(this.apiKey)
                });
            } catch (e) {
                console.error('Failed to switch model, using default', e);
            }
        }

        try {
            // Fetch Context
            const businessContext = await this.getBusinessContext();

            // Construct LangChain Messages
            const messages = [];
            
            // System Prompt with Injected Context
            messages.push(new SystemMessage(
                `You are a helpful assistant for this clothing store's POS system.
                 You have access to the business's real-time data which is provided below.
                 ALWAYS use this data to answer questions about sales, inventory, or trends.
                 
                 ${businessContext}`
            ));

            // History
            // Map 'user' -> HumanMessage, 'model'/'assistant' -> AIMessage
            history.forEach(msg => {
                if (msg.role === 'user') {
                    messages.push(new HumanMessage(msg.content));
                } else {
                    messages.push(new AIMessage(msg.content));
                }
            });

            // Current Message
            const contentParts = [];
            
            // Text
            contentParts.push({ type: "text", text: message });

            // Images
            if (images && Array.isArray(images)) {
                images.forEach(img => {
                    // Check if base64 data URI
                    if (img.startsWith('data:')) {
                         contentParts.push({
                            type: "image_url",
                            image_url: img 
                        });
                    }
                });
            }

            messages.push(new HumanMessage({
                content: contentParts
            }));

            // Stream
            const stream = await chatModel.stream(messages);

            for await (const chunk of stream) {
                if (chunk.content) {
                    onChunk(chunk.content);
                }
            }

        } catch (error) {
            console.error('[GeminiManager] Chat stream failed:', error);
            onChunk("I'm encountering a system error. Please try again. Detailed error: " + error.message);
        }
    }
}

module.exports = new GeminiManager();
