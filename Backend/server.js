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

// In-Memory Cache (Hashmap) for O(1) read performance
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

        res.json({ 
            shortCode, 
            shortUrl: `${baseUrl}/${shortCode}`,
            originalUrl: url
        });
    } catch (error) {
        console.error('Create Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        // 1. Check Cache (Hashmap)
        if (urlCache.has(shortCode)) {
            console.log(`Cache Hit: ${shortCode}`);
            return res.redirect(urlCache.get(shortCode));
        }

        // 2. Check Database
        const urlData = await Url.findOne({ shortCode });

        if (!urlData) {
            return res.status(404).send(getErrorPage('404', 'URL Not Found', 'This link does not exist.'));
        }

        if (isExpired(urlData)) {
            return res.status(410).send(getErrorPage('410', 'Link Expired', 'This link is no longer active.'));
        }

        // 3. Update Cache and Stats
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

// Helper for consistency in error pages
function getErrorPage(code, title, message) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
            <style>
                body {
                    font-family: 'Segoe UI', sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                }
                .container {
                    background: white;
                    padding: 50px;
                    border-radius: 20px;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    max-width: 500px;
                }
                h1 { color: #ff4757; font-size: 3em; margin: 0 0 20px 0; }
                p { color: #666; font-size: 1.2em; margin-bottom: 30px; }
                a {
                    display: inline-block;
                    padding: 15px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    font-weight: 600;
                }
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