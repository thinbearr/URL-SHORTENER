const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.enable('trust proxy');
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, '../Frontend')));

// CORS Configuration
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/urlshortener';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Database Schema
const urlSchema = new mongoose.Schema({
    shortCode: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true },
    clicks: { type: Number, default: 0 },
    expiryType: { type: String, enum: ['time', 'clicks', null], default: null },
    expiresAt: { type: Date, default: null },
    maxClicks: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now }
});

const Url = mongoose.model('Url', urlSchema);

// ==========================================
// PRIORITY QUEUE (MIN HEAP) - For TTL Management
// ==========================================
class MinHeap {
    constructor() {
        this.heap = []; // Each element: { shortCode, expiresAt }
    }

    // Helper methods
    getParentIndex(i) { return Math.floor((i - 1) / 2); }
    getLeftChildIndex(i) { return 2 * i + 1; }
    getRightChildIndex(i) { return 2 * i + 2; }
    hasParent(i) { return this.getParentIndex(i) >= 0; }
    hasLeftChild(i) { return this.getLeftChildIndex(i) < this.heap.length; }
    hasRightChild(i) { return this.getRightChildIndex(i) < this.heap.length; }
    parent(i) { return this.heap[this.getParentIndex(i)]; }
    leftChild(i) { return this.heap[this.getLeftChildIndex(i)]; }
    rightChild(i) { return this.heap[this.getRightChildIndex(i)]; }

    swap(i, j) {
        [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    }

    // O(1) - Check minimum without removing
    peek() {
        return this.heap.length > 0 ? this.heap[0] : null;
    }

    size() {
        return this.heap.length;
    }

    // O(log n) - Insert new element
    insert(shortCode, expiresAt) {
        const startTime = performance.now();
        this.heap.push({ shortCode, expiresAt: new Date(expiresAt) });
        this.heapifyUp();
        const insertTime = (performance.now() - startTime).toFixed(2);
        logHeapOperation('HEAP_INSERT', shortCode, insertTime, 'O(log n)', `Expires: ${new Date(expiresAt).toLocaleTimeString()}`);
    }

    // O(log n) - Remove and return minimum
    extractMin() {
        if (this.heap.length === 0) return null;
        const startTime = performance.now();
        const min = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.heapifyDown();
        }
        const extractTime = (performance.now() - startTime).toFixed(2);
        logHeapOperation('HEAP_EXTRACT', min.shortCode, extractTime, 'O(log n)', 'Time Limit Reached - Removed from queue');
        return min;
    }

    // Bubble up to maintain heap property
    heapifyUp() {
        let index = this.heap.length - 1;
        while (this.hasParent(index) && this.parent(index).expiresAt > this.heap[index].expiresAt) {
            this.swap(this.getParentIndex(index), index);
            index = this.getParentIndex(index);
        }
    }

    // Bubble down to maintain heap property
    heapifyDown() {
        let index = 0;
        while (this.hasLeftChild(index)) {
            let smallerChildIndex = this.getLeftChildIndex(index);
            if (this.hasRightChild(index) && this.rightChild(index).expiresAt < this.leftChild(index).expiresAt) {
                smallerChildIndex = this.getRightChildIndex(index);
            }
            if (this.heap[index].expiresAt <= this.heap[smallerChildIndex].expiresAt) {
                break;
            }
            this.swap(index, smallerChildIndex);
            index = smallerChildIndex;
        }
    }

    // Get all items for visualization (sorted by expiry)
    getAll() {
        return [...this.heap].sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
    }

    // Remove a specific item by shortCode (for when link is deleted manually)
    remove(shortCode) {
        const index = this.heap.findIndex(item => item.shortCode === shortCode);
        if (index === -1) return false;

        // Replace with last element and re-heapify
        const last = this.heap.pop();
        if (index < this.heap.length) {
            this.heap[index] = last;
            this.heapifyDown();
            this.heapifyUp();
        }
        return true;
    }
}

// Initialize the TTL Priority Queue
const ttlHeap = new MinHeap();
const heapOperationLog = []; // Separate log for heap operations

// Heap Operation Logger
function logHeapOperation(type, key, timeMs, complexity, details = null) {
    heapOperationLog.push({
        type,
        key: key ? key : null,
        time: timeMs,
        complexity,
        details,
        timestamp: Date.now(),
        heapSize: ttlHeap.size()
    });

    // Keep only last 50 operations
    if (heapOperationLog.length > 50) {
        heapOperationLog.shift();
    }
}

// Background job to check and cleanup expired links from heap
setInterval(async () => {
    while (ttlHeap.size() > 0) {
        const top = ttlHeap.peek();
        if (!top) break;

        const now = new Date();
        if (new Date(top.expiresAt) <= now) {
            // This link has expired - extract and delete
            const expired = ttlHeap.extractMin();

            // Delete from database
            await Url.deleteOne({ shortCode: expired.shortCode });

            // Remove from cache if present
            if (urlCache.has(expired.shortCode)) {
                urlCache.delete(expired.shortCode);
            }

            console.log(`❌ Link Expired (Heap): ${expired.shortCode}`);
            logOperation('EXPIRED', expired.shortCode, '0.00', 'Heap Extract', 'Time Limit Reached (Priority Queue Cleaned)');
            logHeapOperation('TTL_EXPIRED', expired.shortCode, '0.00', 'Heap Extract', 'Time Limit Reached');
        } else {
            // Top of heap hasn't expired yet, no need to check others
            break;
        }
    }
}, 5000); // Check every 5 seconds

// ==========================================
// LRU CACHE (HASHMAP) - For Fast Lookups
// ==========================================
const MAX_CACHE_SIZE = 5; // Small size for easy demo
const urlCache = new Map();
const operationLog = []; // Store operations for visualization

// LRU Cache Functions
function addToCache(shortCode, url) {
    const startTime = performance.now();

    // If already exists, remove it (will re-add at end - LRU behavior)
    if (urlCache.has(shortCode)) {
        urlCache.delete(shortCode);
    }

    // If cache is full, remove least recently used (first entry)
    if (urlCache.size >= MAX_CACHE_SIZE) {
        const firstKey = urlCache.keys().next().value;
        const evictTime = (performance.now() - startTime).toFixed(2);

        // Log eviction
        logOperation('EVICT', firstKey, evictTime, 'O(1)');
        urlCache.delete(firstKey);
    }

    // Add to end (most recent)
    urlCache.set(shortCode, url);
    const setTime = (performance.now() - startTime).toFixed(2);

    // Log the SET operation
    logOperation('SET', shortCode, setTime, 'O(1)');
}

function getFromCache(shortCode) {
    const startTime = performance.now();

    if (!urlCache.has(shortCode)) {
        return null;
    }

    // Move to end (mark as recently used - LRU behavior)
    const url = urlCache.get(shortCode);
    urlCache.delete(shortCode);
    urlCache.set(shortCode, url);

    const hitTime = (performance.now() - startTime).toFixed(2);
    logOperation('HIT', shortCode, hitTime, 'O(1)');

    return url;
}

// Operation Logger
function logOperation(type, key, timeMs, complexity, details = null) {
    operationLog.push({
        type,
        key: key ? key : null, // Privacy: show exact key for demo clarity now
        time: timeMs,
        complexity,
        details,
        timestamp: Date.now(),
        cacheSize: urlCache.size
    });

    // Keep only last 100 operations
    if (operationLog.length > 100) {
        operationLog.shift();
    }
}

// Utilities
function generateShortCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function isValidUrl(url) {
    try { new URL(url); return true; } catch (e) { return false; }
}

function calculateExpiryDate(value, unit) {
    const now = new Date();
    const multipliers = { minutes: 60000, hours: 3600000, days: 86400000 };
    return new Date(now.getTime() + (value * multipliers[unit]));
}

function isExpired(urlData) {
    if (!urlData.expiryType) return false;
    if (urlData.expiryType === 'time' && urlData.expiresAt) return new Date() > new Date(urlData.expiresAt);
    if (urlData.expiryType === 'clicks' && urlData.maxClicks) return urlData.clicks >= urlData.maxClicks;
    return false;
}

// Routes
app.get('/api/status', (req, res) => {
    res.json({
        status: 'active',
        message: 'URL Shortener API with LRU Cache',
        cacheSize: `${urlCache.size}/${MAX_CACHE_SIZE}`,
        totalOperations: operationLog.length
    });
});

// Live Operations Stream (Server-Sent Events)
app.get('/live-operations', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendUpdate = () => {
        const data = {
            // HashMap (LRU Cache) data
            logs: operationLog.slice(-20),
            cacheKeys: Array.from(urlCache.keys()),
            cacheSize: urlCache.size,
            maxSize: MAX_CACHE_SIZE,
            // Priority Queue (Heap) data
            heapLogs: heapOperationLog.slice(-20),
            heapItems: ttlHeap.getAll().map(item => ({
                shortCode: item.shortCode,
                expiresAt: item.expiresAt,
                timeLeft: Math.max(0, Math.floor((new Date(item.expiresAt) - new Date()) / 1000))
            })),
            heapSize: ttlHeap.size()
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial data
    sendUpdate();

    // Send updates every second or when needed
    const interval = setInterval(() => {
        sendUpdate(); // Always send state so blocks stay synced
    }, 1000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

// Get Cache Statistics
app.get('/cache-stats', (req, res) => {
    const hits = operationLog.filter(op => op.type === 'HIT').length;
    const misses = operationLog.filter(op => op.type === 'MISS').length;
    const total = hits + misses;
    const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) : 0;

    const avgHitTime = hits > 0
        ? (operationLog.filter(op => op.type === 'HIT').reduce((sum, op) => sum + parseFloat(op.time), 0) / hits).toFixed(3)
        : 0;

    const avgMissTime = misses > 0
        ? (operationLog.filter(op => op.type === 'MISS').reduce((sum, op) => sum + parseFloat(op.time), 0) / misses).toFixed(3)
        : 0;

    res.json({
        cacheSize: urlCache.size,
        maxCacheSize: MAX_CACHE_SIZE,
        totalOperations: operationLog.length,
        hits,
        misses,
        hitRate: parseFloat(hitRate),
        avgHitTime: parseFloat(avgHitTime),
        avgMissTime: parseFloat(avgMissTime),
        cacheContents: Array.from(urlCache.keys()).map(k => k.substring(0, 3) + '***')
    });
});

app.post('/shorten', async (req, res) => {
    try {
        const { url, alias, expiryType, expiryValue, expiryUnit, maxClicks, forceNew } = req.body;

        if (!url) return res.status(400).json({ error: 'URL is required' });
        if (!isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL format' });

        // DEDUPLICATION: Check if this exact URL already exists (Reverse Lookup)
        const existingUrl = await Url.findOne({ url: url });

        if (existingUrl && !forceNew && !alias) {
            // URL already exists - offer to reuse
            const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;

            // Log the dedup operation
            logOperation('DEDUP', existingUrl.shortCode, '0.00', 'O(1)', 'Reverse lookup found existing entry');

            console.log(`🔄 DEDUP: Reusing ${existingUrl.shortCode} for ${url}`);

            return res.json({
                shortCode: existingUrl.shortCode,
                shortUrl: `${baseUrl}/${existingUrl.shortCode}`,
                originalUrl: url,
                expiryType: existingUrl.expiryType,
                expiresAt: existingUrl.expiresAt,
                maxClicks: existingUrl.maxClicks,
                deduplicated: true,  // Flag to indicate this was a reuse
                message: 'This URL already has a short link!'
            });
        }

        // If existingUrl found but user wants forceNew, or using custom alias, create new entry
        let shortCode;

        if (alias) {
            if (!/^[a-zA-Z0-9-_]+$/.test(alias)) {
                return res.status(400).json({ error: 'Alias contains invalid characters' });
            }
            const existingAlias = await Url.findOne({ shortCode: alias });
            if (existingAlias) return res.status(400).json({ error: 'Alias already in use' });
            shortCode = alias;
        } else {
            shortCode = generateShortCode();
            let exists = await Url.findOne({ shortCode });
            while (exists) {
                shortCode = generateShortCode();
                exists = await Url.findOne({ shortCode });
            }
        }

        const urlData = { shortCode, url, clicks: 0 };

        if (expiryType === 'time' && expiryValue && expiryUnit) {
            urlData.expiryType = 'time';
            urlData.expiresAt = calculateExpiryDate(expiryValue, expiryUnit);
        } else if (expiryType === 'clicks' && maxClicks) {
            urlData.expiryType = 'clicks';
            urlData.maxClicks = parseInt(maxClicks);
        }

        const newUrl = new Url(urlData);
        await newUrl.save();

        // Removed addToCache(shortCode, url) to implement lazy caching.
        // The link will only be added to cache when it is first accessed (visited).

        // If time-based expiry, add to Priority Queue (Min Heap) for proactive TTL management
        if (urlData.expiryType === 'time' && urlData.expiresAt) {
            ttlHeap.insert(shortCode, urlData.expiresAt);
        }

        const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;

        console.log(`Created: ${shortCode} → ${url}`);

        res.json({
            shortCode,
            shortUrl: `${baseUrl}/${shortCode}`,
            originalUrl: url,
            expiryType: urlData.expiryType,
            expiresAt: urlData.expiresAt,
            maxClicks: urlData.maxClicks,
            deduplicated: false
        });
    } catch (error) {
        console.error('Create Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        // Ignore internal/browser requests
        if (shortCode === 'heap-state' || shortCode === 'favicon.ico') {
            return res.status(404).end();
        }

        const overallStart = performance.now();

        // 1. Check Cache (O(1))
        const cachedUrl = getFromCache(shortCode);

        if (cachedUrl) {
            console.log(`✅ Cache HIT: ${shortCode}`);

            // First, fetch current state to check expiry BEFORE incrementing
            const urlData = await Url.findOne({ shortCode });

            // Check if link has expired (check BEFORE incrementing)
            if (urlData && isExpired(urlData)) {
                const reason = urlData.expiryType === 'time' ? 'Time Limit Reached' : 'Max Clicks Reached';

                // Remove from cache
                urlCache.delete(shortCode);

                // Delete from DB
                await Url.deleteOne({ shortCode });

                console.log(`❌ Cached Link Expired & Deleted (${reason}): ${shortCode}`);
                logOperation('EXPIRED', shortCode, '0.00', 'Deletion', reason);

                return res.status(410).send(getErrorPage('410', 'Link Expired', `This link has expired due to: ${reason}`));
            }

            // Not expired - now increment the click count
            if (urlData) {
                await Url.updateOne({ shortCode }, { $inc: { clicks: 1 } });
            }

            return res.redirect(cachedUrl);
        }

        // 2. Cache Miss - Query Database (O(log n))
        const dbStart = performance.now();
        const urlData = await Url.findOne({ shortCode });
        const dbTime = (performance.now() - dbStart).toFixed(2);

        // Debugging: Log what caused the miss
        console.log(`Debug - Cache Miss for: "${shortCode}"`);

        logOperation('MISS', shortCode, dbTime, 'DB Search');

        if (!urlData) {
            return res.status(404).send(getErrorPage('404', 'URL Not Found', 'This link does not exist.'));
        }

        if (isExpired(urlData)) {
            const reason = urlData.expiryType === 'time' ? 'Time Limit Reached' : 'Max Clicks Reached';

            // 1. Remove from cache if present (Visual: Block disappears)
            if (urlCache.has(shortCode)) {
                urlCache.delete(shortCode);
                console.log(`🗑️ Removed from cache: ${shortCode}`);
            }

            // 2. Permanent Deletion from MongoDB
            await Url.deleteOne({ shortCode });
            console.log(`❌ Link Expired & Deleted (${reason}): ${shortCode}`);

            // 3. Log Operation for Visual Feed (shows purple EXPIRED in logs)
            logOperation('EXPIRED', shortCode, '0.00', 'Deletion', reason);

            return res.status(410).send(getErrorPage('410', 'Link Expired', `This link has expired due to: ${reason}`));
        }

        // 3. Add to cache for future requests (ALL links, including expiring ones)
        addToCache(shortCode, urlData.url);

        // 4. Update clicks
        urlData.clicks++;
        await urlData.save();

        console.log(`🔗 Redirect: ${shortCode} → ${urlData.url} (Click #${urlData.clicks})`);

        res.redirect(urlData.url);
    } catch (error) {
        console.error('Redirect Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Error Pages
function getErrorPage(code, title, message) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background: #1a1a1a;
                    color: #ffffff;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                }
                .container {
                    background: #2d2d2d;
                    padding: 40px;
                    border-radius: 12px;
                    text-align: center;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    max-width: 450px;
                    width: 90%;
                }
                h1 { color: #ff5252; font-size: 3em; margin: 0 0 15px 0; }
                p { color: #cccccc; font-size: 1.1em; margin-bottom: 25px; line-height: 1.5; }
                a {
                    display: inline-block;
                    padding: 12px 30px;
                    background: #ffffff;
                    color: #1a1a1a;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: bold;
                    transition: transform 0.2s;
                }
                a:hover { transform: translateY(-2px); opacity: 0.9; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${code}</h1>
                <p>${message}</p>
                <a href="${process.env.FRONTEND_URL || 'https://urlnanoed.vercel.app'}">Go Home</a>
            </div>
        </body>
        </html>
    `;
}

// Fallback/Health Check Route
app.get('/', (req, res) => {
    const dbState = mongoose.connection.readyState;
    const status = dbState === 1 ? 'Connected' : dbState === 2 ? 'Connecting' : 'Disconnected';
    res.send(`Backend is running! DB Status: ${status}`);
});

// START SERVER IMMEDIATELY (Fixes Railway 502 Timeout)
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`Waiting for MongoDB...`);
});

// Connect to MongoDB asynchronously
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err);
        // Don't exit process, just log error so server stays up for logs
    });