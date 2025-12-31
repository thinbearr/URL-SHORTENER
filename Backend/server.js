const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

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

// LRU Cache Configuration
const MAX_CACHE_SIZE = 5; // Small size for easy demo
const urlCache = new Map();
const operationLog = []; // Store operations for visualization

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
function logOperation(type, key, timeMs, complexity) {
    operationLog.push({
        type,
        key: key ? key.substring(0, 3) + '***' : null, // Privacy: show abc***
        time: timeMs,
        complexity,
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
app.get('/', (req, res) => {
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
    
    // Send initial data
    res.write(`data: ${JSON.stringify(operationLog.slice(-20))}\n\n`);
    
    // Send updates every second
    const interval = setInterval(() => {
        if (operationLog.length > 0) {
            const recentOps = operationLog.slice(-20);
            res.write(`data: ${JSON.stringify(recentOps)}\n\n`);
        }
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
        const { url, alias, expiryType, expiryValue, expiryUnit, maxClicks } = req.body;

        if (!url) return res.status(400).json({ error: 'URL is required' });
        if (!isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL format' });

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

        // Add to cache (only non-expiring URLs for simplicity)
        if (!urlData.expiryType) {
            addToCache(shortCode, url);
        }

        const baseUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;

        console.log(`Created: ${shortCode} → ${url}`);

        res.json({
            shortCode,
            shortUrl: `${baseUrl}/${shortCode}`,
            originalUrl: url,
            expiryType: urlData.expiryType,
            expiresAt: urlData.expiresAt,
            maxClicks: urlData.maxClicks
        });
    } catch (error) {
        console.error('Create Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const overallStart = performance.now();

        // 1. Check Cache (O(1))
        const cachedUrl = getFromCache(shortCode);
        
        if (cachedUrl) {
            console.log(`✅ Cache HIT: ${shortCode}`);
            
            // Still need to update click count in DB
            await Url.findOneAndUpdate({ shortCode }, { $inc: { clicks: 1 } });
            
            return res.redirect(cachedUrl);
        }

        // 2. Cache Miss - Query Database (O(log n))
        const dbStart = performance.now();
        const urlData = await Url.findOne({ shortCode });
        const dbTime = (performance.now() - dbStart).toFixed(2);
        
        logOperation('MISS', shortCode, dbTime, 'O(log n)');

        if (!urlData) {
            return res.status(404).send(getErrorPage('404', 'URL Not Found', 'This link does not exist.'));
        }

        if (isExpired(urlData)) {
            return res.status(410).send(getErrorPage('410', 'Link Expired', 'This link is no longer active.'));
        }

        // 3. Add to cache for future requests (only non-expiring)
        if (!urlData.expiryType) {
            addToCache(shortCode, urlData.url);
        }

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`URL Shortener API running on port ${PORT}`);
    console.log(`LRU Cache Size: ${MAX_CACHE_SIZE}`);
    console.log(`Database: MongoDB`);
    console.log(`Live Operations: /live-operations`);
});