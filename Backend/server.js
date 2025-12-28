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
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// In-Memory Cache (Hashmap)
const urlCache = new Map();

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
        message: 'URL Shortener API',
        cacheSize: urlCache.size
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

        const baseUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;

        // ✅ FIXED: Added expiry details back to the response
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

        // 1. Check Cache
        if (urlCache.has(shortCode)) {
            console.log(`Cache Hit: ${shortCode}`);
            return res.redirect(urlCache.get(shortCode));
        }

        // 2. Check DB
        const urlData = await Url.findOne({ shortCode });

        if (!urlData) {
            return res.status(404).send(getErrorPage('404', 'URL Not Found', 'This link does not exist.'));
        }

        if (isExpired(urlData)) {
            return res.status(410).send(getErrorPage('410', 'Link Expired', 'This link is no longer active.'));
        }

        // 3. Update Cache
        if (!urlData.expiryType) {
            urlCache.set(shortCode, urlData.url);
        }

        urlData.clicks++;
        await urlData.save();

        res.redirect(urlData.url);
    } catch (error) {
        console.error('Redirect Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Clean Dark Theme for Error Pages
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
                <a href="${process.env.FRONTEND_URL || '#'}">Go Home</a>
            </div>
        </body>
        </html>
    `;
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});