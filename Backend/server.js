const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS Configuration (UPDATED)
app.use(cors({
    origin: '*',  // Allow all origins temporarily for testing
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/urlshortener';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// URL Schema
const urlSchema = new mongoose.Schema({
    shortCode: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    url: {
        type: String,
        required: true
    },
    clicks: {
        type: Number,
        default: 0
    },
    expiryType: {
        type: String,
        enum: ['time', 'clicks', null],
        default: null
    },
    expiresAt: {
        type: Date,
        default: null
    },
    maxClicks: {
        type: Number,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Url = mongoose.model('Url', urlSchema);

// Helper Functions
function generateShortCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

function calculateExpiryDate(value, unit) {
    const now = new Date();
    const multipliers = {
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000
    };
    
    return new Date(now.getTime() + (value * multipliers[unit]));
}

function isExpired(urlData) {
    if (!urlData.expiryType) return false;
    
    if (urlData.expiryType === 'time' && urlData.expiresAt) {
        return new Date() > new Date(urlData.expiresAt);
    }
    
    if (urlData.expiryType === 'clicks' && urlData.maxClicks) {
        return urlData.clicks >= urlData.maxClicks;
    }
    
    return false;
}

// Routes
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'URL Shortener API is running',
        endpoints: {
            shorten: 'POST /shorten',
            redirect: 'GET /:shortCode'
        }
    });
});

app.post('/shorten', async (req, res) => {
    try {
        const { url, alias, expiryType, expiryValue, expiryUnit, maxClicks } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        let shortCode;

        if (alias) {
            if (!/^[a-zA-Z0-9-_]+$/.test(alias)) {
                return res.status(400).json({ 
                    error: 'Alias can only contain letters, numbers, hyphens, and underscores' 
                });
            }

            const existingAlias = await Url.findOne({ shortCode: alias });
            if (existingAlias) {
                return res.status(400).json({ 
                    error: 'This alias is already taken. Please choose another one.' 
                });
            }

            shortCode = alias;
        } else {
            shortCode = generateShortCode();
            let exists = await Url.findOne({ shortCode });
            while (exists) {
                shortCode = generateShortCode();
                exists = await Url.findOne({ shortCode });
            }
        }

        const urlData = {
            shortCode,
            url,
            clicks: 0
        };

        if (expiryType === 'time' && expiryValue && expiryUnit) {
            urlData.expiryType = 'time';
            urlData.expiresAt = calculateExpiryDate(expiryValue, expiryUnit);
        } else if (expiryType === 'clicks' && maxClicks) {
            urlData.expiryType = 'clicks';
            urlData.maxClicks = parseInt(maxClicks);
        }

        const newUrl = new Url(urlData);
        await newUrl.save();

        console.log(`✨ New short URL created: ${shortCode}`);
        console.log(`🔗 Points to: ${url}`);

        const baseUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;

        res.json({ 
            shortCode, 
            shortUrl: `${baseUrl}/${shortCode}`,
            originalUrl: url,
            expiryType: urlData.expiryType,
            expiresAt: urlData.expiresAt,
            maxClicks: urlData.maxClicks
        });
    } catch (error) {
        console.error('Error creating short URL:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const urlData = await Url.findOne({ shortCode });

        if (!urlData) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>404 - URL Not Found</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            margin: 0;
                        }
                        .error-container {
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
                            transition: transform 0.3s ease;
                        }
                        a:hover { transform: translateY(-3px); }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h1>404</h1>
                        <p>This short URL doesn't exist.</p>
                        <a href="${process.env.FRONTEND_URL || 'https://url-shortener-xi-flax.vercel.app'}">Go Back Home</a>
                    </div>
                </body>
                </html>
            `);
        }

        if (isExpired(urlData)) {
            console.log(`Expired link accessed: ${shortCode}`);
            return res.status(410).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>410 - Link Expired</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            margin: 0;
                        }
                        .error-container {
                            background: white;
                            padding: 50px;
                            border-radius: 20px;
                            text-align: center;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            max-width: 500px;
                        }
                        h1 { color: #ff4757; font-size: 3em; margin: 0 0 20px 0; }
                        .emoji { font-size: 4em; margin-bottom: 20px; }
                        p { color: #666; font-size: 1.2em; margin-bottom: 30px; }
                        .details { 
                            background: #f8f9fa; 
                            padding: 15px; 
                            border-radius: 10px; 
                            margin-bottom: 20px;
                            color: #555;
                            font-size: 0.95em;
                        }
                        a {
                            display: inline-block;
                            padding: 15px 40px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                            font-weight: 600;
                            transition: transform 0.3s ease;
                        }
                        a:hover { transform: translateY(-3px); }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="emoji">⏰</div>
                        <h1>Link Expired</h1>
                        <p>Sorry, this shortened URL has expired and is no longer accessible.</p>
                        <div class="details">
                            ${urlData.expiryType === 'time' 
                                ? `This link expired on ${new Date(urlData.expiresAt).toLocaleString()}`
                                : `This link was set to expire after ${urlData.maxClicks} clicks`}
                        </div>
                        <a href="${process.env.FRONTEND_URL || 'https://url-shortener-xi-flax.vercel.app'}">Create a New Link</a>
                    </div>
                </body>
                </html>
            `);
        }

        urlData.clicks++;
        await urlData.save();

        console.log(`🔗 Redirecting ${shortCode} to ${urlData.url} (Click #${urlData.clicks})`);

        res.redirect(urlData.url);
    } catch (error) {
        console.error('Error processing redirect:', error);
        res.status(500).send('Server error');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`URL Shortener API running on port ${PORT}`);
    console.log(`Database: MongoDB`);
    console.log(`Features: Link expiration enabled`);
});