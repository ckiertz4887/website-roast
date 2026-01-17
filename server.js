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

// Validate required environment variables
if (!ELEVENLABS_API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY environment variable is required');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
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
// CACHING
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

// --------------------
// EXPRESS APP
// --------------------
const app = express();

app.use(cors());
app.use(express.json());

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
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Fetch and analyze the content of this website: ${url}

First, search for and retrieve the actual content from this website. Then provide your response in EXACTLY this JSON format (no other text, just the JSON):

{
  "pageText": "the full text content you found on the page, including all headings, paragraphs, button text, and marketing copy",
  "roast": "A 2-3 paragraph sarcastic, cynical roast of this website. Be witty and cutting. Mock their corporate speak, vague promises, and desperate attempts to sound important. Channel your inner disappointed copywriter who's seen too many 'revolutionary' startups. Don't be mean about the actual product/service, just the way they present themselves. Include specific examples from their site. Make it entertaining and funny - this will be read aloud so make it flow well when spoken."
}`
        }]
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
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
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
  `);
});
