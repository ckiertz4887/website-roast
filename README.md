# 🔥 Website Roaster

AI-powered sarcastic website analysis tool that roasts corporate buzzword-laden websites.

## Features

- **AI Roasts**: Claude analyzes websites and generates witty, sarcastic critiques
- **Text-to-Speech**: ElevenLabs v3 reads roasts aloud with expressive delivery
- **Report Card**: Grades websites on buzzword count, vague claims, CTA desperation, and more
- **Audio Player**: Full controls with play/pause, skip ±15s, progress bar, and waveform visualization
- **Caching**: Results cached for 24 hours to save API costs

## Setup

### Prerequisites
- Node.js 18+
- Anthropic API key
- ElevenLabs API key

### Installation

```bash
npm install
```

### Environment Variables

Set these environment variables:

```bash
ELEVENLABS_API_KEY=your_elevenlabs_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### Running Locally

```bash
npm start
```

Then open http://localhost:3001

## Deployment

This app is configured for Railway deployment:

1. Connect your GitHub repo to Railway
2. Add environment variables in Railway dashboard
3. Deploy!

## API Endpoints

- `GET /health` - Health check
- `POST /api/analyze` - Analyze a website
- `POST /api/tts` - Generate text-to-speech audio

## License

MIT
