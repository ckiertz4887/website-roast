const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

// --------------------
// CONFIGURATION
// --------------------
const PORT = process.env.PORT || 3001;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Validate required environment variables
if (!ELEVENLABS_API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY environment variable is required');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.warn('WARNING: Upstash credentials not set - sharing will be disabled');
}

// --------------------
// UPSTASH REDIS HELPERS
// --------------------
async function redisSet(key, value, expirationSeconds = 60 * 60 * 24 * 30) {
  // Store for 30 days by default
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('[Redis] Missing Upstash credentials');
    return false;
  }
  
  try {
    // Upstash REST API uses a different format - send command as array in body
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', expirationSeconds])
    });
    
    const result = await response.json();
    console.log('[Redis] Set response:', result);
    
    if (result.error) {
      console.error('[Redis] Set error:', result.error);
      return false;
    }
    
    return result.result === 'OK';
  } catch (e) {
    console.error('[Redis] Set error:', e);
    return false;
  }
}

async function redisGet(key) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('[Redis] Missing Upstash credentials');
    return null;
  }
  
  try {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', key])
    });
    
    const data = await response.json();
    console.log('[Redis] Get response for', key, ':', data.result ? 'found' : 'not found');
    
    if (data.error) {
      console.error('[Redis] Get error:', data.error);
      return null;
    }
    
    return data.result ? JSON.parse(data.result) : null;
  } catch (e) {
    console.error('[Redis] Get error:', e);
    return null;
  }
}

// --------------------
// CONTENT FILTERING
// --------------------
const BLOCKED_DOMAINS = [
  'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn',
  'brazzers', 'bangbros', 'realitykings', 'naughtyamerica', 'mofos',
  'onlyfans', 'fansly', 'chaturbate', 'stripchat', 'livejasmin',
  'cam4', 'bongacams', 'myfreecams', 'camsoda',
  'porn', 'xxx', 'sex', 'adult', 'nsfw', 'hentai', 'rule34',
  'spankbang', 'eporner', 'tube8', 'xtube', 'motherless',
  'fetlife', 'literotica', 'erotic'
];

const BLOCKED_TLDS = ['.xxx', '.porn', '.sex', '.adult'];

function isBlockedSite(url) {
  const lowerUrl = url.toLowerCase();
  for (const tld of BLOCKED_TLDS) {
    if (lowerUrl.includes(tld)) return true;
  }
  for (const domain of BLOCKED_DOMAINS) {
    if (lowerUrl.includes(domain)) return true;
  }
  return false;
}

// --------------------
// CACHING (in-memory for API responses)
// --------------------
const websiteCache = new Map();
const audioCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function isCacheValid(entry) {
  if (!entry) return false;
  return (Date.now() - entry.timestamp) < CACHE_TTL;
}

function createHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function generateShareId() {
  return crypto.randomBytes(6).toString('base64url'); // 8 char ID
}

// --------------------
// EXPRESS APP
// --------------------
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for audio

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------
// ANALYZE ENDPOINT
// --------------------
app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'Missing "url" in request body' });
    }
    
    if (isBlockedSite(url)) {
      return res.status(403).json({ 
        error: 'This site cannot be roasted',
        details: 'We only roast corporate websites, not... whatever that is. Keep it classy! 🎩'
      });
    }
    
    const cacheKey = url.toLowerCase().replace(/\/$/, '');
    const cached = websiteCache.get(cacheKey);
    
    if (isCacheValid(cached)) {
      console.log(`[Analyze] Cache HIT for: ${url}`);
      return res.json(cached.data);
    }
    
    console.log(`[Analyze] Cache MISS - Roasting website: ${url}`);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Fetch and analyze the content of this website: ${url}

First, search for and retrieve the actual content from this website. Then provide your response in EXACTLY this JSON format (no other text before or after, just the JSON):

{
  "pageText": "the full text content you found on the page including headings, paragraphs, and marketing copy",
  "roast": "A 3-4 paragraph witty roast of this website. You're a comedian doing a bit about corporate websites. Mix sharp observations with humor - use funny analogies, point out absurdities with a smile, joke about buzzwords. Be clever, not cruel. Make fun of HOW they present themselves, not the product itself. Use good comedic timing with setups and punchlines. Make it fun to listen to. Really dig into the material - find multiple angles to riff on.

IMPORTANT: Include ElevenLabs audio tags throughout for expressive delivery:
- Use [sighs] when expressing exasperation at buzzwords
- Use [chuckles] or [laughs] after jokes
- Use [sarcastically] before sarcastic observations  
- Use [dramatically] for dramatic effect
- Use [pause] for comedic timing before punchlines

Example: '[sighs] Oh look, another company that\\'s \"revolutionizing\" something. [sarcastically] How refreshing. [pause] They\\'ve managed to use the word synergy three times in one paragraph. [chuckles] That\\'s actually impressive.'"
}`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Analyze] Anthropic error: ${response.status}`, errorText);
      return res.status(response.status).json({ 
        error: `Anthropic API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    console.log(`[Analyze] Successfully got response from Claude`);
    
    websiteCache.set(cacheKey, { data, timestamp: Date.now() });
    res.json(data);
    
  } catch (error) {
    console.error('[Analyze] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// --------------------
// TTS ENDPOINT
// --------------------
const VOICE_ID = 'G0yjIg3xY8gEJZkHpjVm';

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Missing "text" in request body' });
    }
    
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
    }
    
    const cacheKey = createHash(text + VOICE_ID);
    const cached = audioCache.get(cacheKey);
    
    if (isCacheValid(cached)) {
      console.log(`[TTS] Cache HIT`);
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': cached.audioBuffer.byteLength,
        'X-Cache': 'HIT'
      });
      return res.send(Buffer.from(cached.audioBuffer));
    }
    
    console.log(`[TTS] Cache MISS - Generating speech`);
    
    // Add sassy/sarcastic delivery instruction at the start
    const enhancedText = `[sassy, sarcastic, comedic tone throughout] ${text}`;
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: enhancedText,
        model_id: 'eleven_v3',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TTS] ElevenLabs error: ${response.status}`, errorText);
      return res.status(response.status).json({ 
        error: `ElevenLabs API error: ${response.status}`,
        details: errorText
      });
    }
    
    const audioBuffer = await response.arrayBuffer();
    
    audioCache.set(cacheKey, { audioBuffer, timestamp: Date.now() });
    console.log(`[TTS] Cached audio`);
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength,
      'X-Cache': 'MISS'
    });
    res.send(Buffer.from(audioBuffer));
    
  } catch (error) {
    console.error('[TTS] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// --------------------
// SHARE ENDPOINTS
// --------------------

// Save a roast for sharing
app.post('/api/share', async (req, res) => {
  try {
    const { url, roast, results, audio } = req.body;
    
    if (!url || !roast || !results) {
      console.error('[Share] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
      console.error('[Share] Upstash not configured');
      return res.status(500).json({ error: 'Sharing is not configured - missing Upstash credentials' });
    }
    
    const shareId = generateShareId();
    
    const shareData = {
      url,
      roast,
      results,
      audio: audio || null, // base64 encoded audio if provided
      createdAt: Date.now()
    };
    
    console.log(`[Share] Saving roast ${shareId} for ${url} (audio: ${audio ? 'yes' : 'no'}, size: ${JSON.stringify(shareData).length} bytes)`);
    
    const saved = await redisSet(`roast:${shareId}`, shareData);
    
    if (!saved) {
      console.error('[Share] Failed to save to Redis');
      return res.status(500).json({ error: 'Failed to save roast to database' });
    }
    
    console.log(`[Share] Successfully saved roast ${shareId}`);
    res.json({ shareId, shareUrl: `https://www.wroast.co/r/${shareId}` });
    
  } catch (error) {
    console.error('[Share] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get a shared roast
app.get('/api/share/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const data = await redisGet(`roast:${id}`);
    
    if (!data) {
      return res.status(404).json({ error: 'Roast not found' });
    }
    
    console.log(`[Share] Retrieved roast ${id}`);
    res.json(data);
    
  } catch (error) {
    console.error('[Share] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Serve shared roast page with dynamic meta tags
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Fetch the roast data to get the URL being roasted
    const data = await redisGet(`roast:${id}`);
    
    if (data && data.url) {
      // Extract domain from the roasted URL for the title
      let domain = 'a website';
      try {
        domain = new URL(data.url).hostname.replace('www.', '');
      } catch (e) {}
      
      // Get a short preview of the roast (first 150 chars, strip audio tags)
      const roastPreview = data.roast
        .replace(/\[(?:sighs?|chuckles?|laughs?|sarcastically|dramatically|pause|sassy|sarcastic|comedic)[^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 150) + '...';
      
      // Read the index.html and inject dynamic meta tags
      const fs = require('fs');
      let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      
      // Replace the meta tags
      html = html.replace(
        /<title>.*?<\/title>/,
        `<title>🔥 ${domain} just got roasted!</title>`
      );
      html = html.replace(
        /<meta property="og:title" content=".*?">/,
        `<meta property="og:title" content="🔥 ${domain} just got roasted!">`
      );
      html = html.replace(
        /<meta property="og:description" content=".*?">/,
        `<meta property="og:description" content="${roastPreview.replace(/"/g, '&quot;')}">`
      );
      html = html.replace(
        /<meta property="og:url" content=".*?">/,
        `<meta property="og:url" content="https://www.wroast.co/r/${id}">`
      );
      html = html.replace(
        /<meta property="og:image" content=".*?">/,
        `<meta property="og:image" content="https://www.wroast.co/api/og/${id}">`
      );
      html = html.replace(
        /<meta name="twitter:title" content=".*?">/,
        `<meta name="twitter:title" content="🔥 ${domain} just got roasted!">`
      );
      html = html.replace(
        /<meta name="twitter:description" content=".*?">/,
        `<meta name="twitter:description" content="${roastPreview.replace(/"/g, '&quot;')}">`
      );
      html = html.replace(
        /<meta name="twitter:image" content=".*?">/,
        `<meta name="twitter:image" content="https://www.wroast.co/api/og/${id}">`
      );
      
      return res.send(html);
    }
  } catch (e) {
    console.error('[Share Page] Error fetching roast data:', e);
  }
  
  // Fallback to regular index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generate OG image for shared roasts
app.get('/api/og/:id', async (req, res) => {
  const { id } = req.params;
  
  let domain = 'Your Website';
  let grade = '?';
  let isDefault = id === 'default';
  
  if (!isDefault) {
    try {
      const data = await redisGet(`roast:${id}`);
      
      if (data) {
        try {
          domain = new URL(data.url).hostname.replace('www.', '');
        } catch (e) {}
        
        // Calculate grade based on results
        if (data.results) {
          const score = Math.min(100, 
            (data.results.buzzwords?.total || 0) * 3 + 
            (data.results.vagueClaims?.total || 0) * 5 + 
            (data.results.ctas?.total || 0) * 2
          );
          if (score < 20) grade = 'A';
          else if (score < 40) grade = 'B';
          else if (score < 60) grade = 'C';
          else if (score < 80) grade = 'D';
          else grade = 'F';
        }
      }
    } catch (e) {
      console.error('[OG Image] Error:', e);
    }
  }
  
  // Generate a simple SVG image
  const svg = isDefault ? `
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0f0f1a"/>
          <stop offset="50%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#16213e"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <text x="600" y="200" font-family="system-ui, sans-serif" font-size="80" fill="#ff6b6b" text-anchor="middle">🔥 Website Roaster 🔥</text>
      <text x="600" y="320" font-family="system-ui, sans-serif" font-size="42" fill="#ffffff" text-anchor="middle">How Cringe Is Your Website?</text>
      <text x="600" y="420" font-family="system-ui, sans-serif" font-size="32" fill="#888888" text-anchor="middle">AI-powered roasts of corporate buzzword salad</text>
      <text x="600" y="520" font-family="system-ui, sans-serif" font-size="28" fill="#8b5cf6" text-anchor="middle">wroast.co</text>
    </svg>
  ` : `
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0f0f1a"/>
          <stop offset="50%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#16213e"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <text x="600" y="180" font-family="system-ui, sans-serif" font-size="72" fill="#ff6b6b" text-anchor="middle">🔥 ROASTED 🔥</text>
      <text x="600" y="300" font-family="system-ui, sans-serif" font-size="64" fill="#ffffff" text-anchor="middle" font-weight="bold">${domain}</text>
      <text x="600" y="400" font-family="system-ui, sans-serif" font-size="48" fill="#888888" text-anchor="middle">Corporate Cringe Grade:</text>
      <text x="600" y="520" font-family="system-ui, sans-serif" font-size="120" fill="${grade === 'A' ? '#22c55e' : grade === 'B' ? '#84cc16' : grade === 'C' ? '#eab308' : grade === 'D' ? '#f97316' : '#ef4444'}" text-anchor="middle" font-weight="bold">${grade}</text>
    </svg>
  `;
  
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.send(svg);
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`
🔥 Website Roaster API Server
   Running on port ${PORT}
   Environment: ${process.env.NODE_ENV || 'development'}
   Sharing: ${UPSTASH_REDIS_REST_URL ? 'enabled' : 'disabled'}
  `);
});
