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
  if (!UPSTASH_REDIS_REST_URL) {
    console.error('[Redis] No UPSTASH_REDIS_REST_URL configured');
    return false;
  }
  
  try {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/set/${key}?EX=${expirationSeconds}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Redis] Set failed:', response.status, errorText);
      return false;
    }
    
    const result = await response.json();
    console.log('[Redis] Set result:', result);
    return result.result === 'OK';
  } catch (e) {
    console.error('[Redis] Set error:', e);
    return false;
  }
}

async function redisGet(key) {
  if (!UPSTASH_REDIS_REST_URL) return null;
  
  try {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${key}`, {
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`
      }
    });
    const data = await response.json();
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
  "roast": "A 2-3 paragraph witty roast of this website. You're a comedian doing a bit about corporate websites. Mix sharp observations with humor - use funny analogies, point out absurdities with a smile, joke about buzzwords. Be clever, not cruel. Make fun of HOW they present themselves, not the product itself. Use good comedic timing with setups and punchlines. Make it fun to listen to.

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
      console.error('[Share] Missing required fields:', { url: !!url, roast: !!roast, results: !!results });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!UPSTASH_REDIS_REST_URL) {
      console.error('[Share] Upstash not configured');
      return res.status(500).json({ error: 'Sharing is not configured' });
    }
    
    const shareId = generateShareId();
    
    const shareData = {
      url,
      roast,
      results,
      audio: audio || null, // base64 encoded audio if provided
      createdAt: Date.now()
    };
    
    console.log(`[Share] Attempting to save roast ${shareId} for ${url} (audio: ${audio ? 'yes' : 'no'})`);
    
    const saved = await redisSet(`roast:${shareId}`, shareData);
    
    if (!saved) {
      console.error('[Share] Failed to save to Redis');
      return res.status(500).json({ error: 'Failed to save roast' });
    }
    
    console.log(`[Share] Successfully saved roast ${shareId} for ${url}`);
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

// Serve shared roast page
app.get('/r/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
