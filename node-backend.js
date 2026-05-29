import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Serve the frontend
app.use(express.static(__dirname));

// Config
const KEY_1 = process.env.GROQ_KEY_1;
const KEY_2 = process.env.GROQ_KEY_2;
const THRESHOLD = parseInt(process.env.THRESHOLD || '10', 10);
const MODEL = 'llama-3.1-8b-instant';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Real Concurrency Tracking
const activeSessions = new Map();
const SESSION_TTL_MS = 30_000;

function registerSession(sessionId) {
  activeSessions.set(sessionId, Date.now() + SESSION_TTL_MS);
}

function evictExpired() {
  const now = Date.now();
  for (const [sessionId, expiry] of activeSessions) {
    if (now > expiry) activeSessions.delete(sessionId);
  }
}

function getActiveCount() {
  evictExpired();
  return activeSessions.size;
}

// Routing Logic
function selectKey(activeUsers) {
  return activeUsers >= THRESHOLD ? KEY_2 : KEY_1;
}

// Groq API Call
async function callGroq(apiKey, message) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: message }],
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error?.message || 'Groq API error'), { status: res.status });
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// Routes
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  const sessionId = req.headers['x-session-id'] || `anon-${Date.now()}`;
  const ghostUsers = parseInt(req.headers['x-ghost-users'] || '0', 10);

  if (!message) return res.status(400).json({ error: 'message is required' });

  // Use env keys OR keys passed from the UI via body (for local-only usage without .env)
  const key1 = KEY_1 || req.body.key1;
  const key2 = KEY_2 || req.body.key2;

  if (!key1 || !key2) {
    return res.status(400).json({ error: 'API keys not configured. Set GROQ_KEY_1 and GROQ_KEY_2 in .env or pass them in the request.' });
  }

  // Allow the UI to override threshold per-request (frontend slider)
  const effectiveThreshold = req.body.threshold ? parseInt(req.body.threshold, 10) : THRESHOLD;

  registerSession(sessionId);
  // Combine real sessions with ghost users for routing decision
  const realUsers = getActiveCount();
  const activeUsers = realUsers + ghostUsers;

  const chosenKey = activeUsers >= effectiveThreshold ? key2 : key1;
  const isFallback = chosenKey === key2;

  console.log(`[${new Date().toISOString()}] session=${sessionId} real=${realUsers} ghost=${ghostUsers} total=${activeUsers} api=${isFallback ? 2 : 1}`);

  try {
    const reply = await callGroq(chosenKey, message);
    res.json({
      reply,
      usedFallback: isFallback,
      activeUsers,
      threshold: effectiveThreshold,
      notice: isFallback
        ? 'High demand — answered by our secondary model. No extra charge.'
        : null,
    });
  } catch (err) {
    // Emergency fallback: if primary hits rate limit or server error, try key2
    if (!isFallback && (err.status === 429 || err.status >= 500)) {
      console.warn('Primary key failed, emergency fallback to Key 2');
      try {
        const reply = await callGroq(key2, message);
        return res.json({
          reply,
          usedFallback: true,
          activeUsers,
          threshold: effectiveThreshold,
          notice: 'Primary API unavailable — answered by fallback. No extra charge.',
        });
      } catch (fallbackErr) {
        return res.status(503).json({ error: 'Both APIs unavailable. Please try again.' });
      }
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Status endpoint
app.get('/api/status', (_req, res) => {
  const active = getActiveCount();
  res.json({
    activeUsers: active,
    threshold: effectiveThreshold,
    currentApi: active >= THRESHOLD ? 2 : 1,
    isFallbackMode: active >= THRESHOLD,
  });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Load balancer running on http://localhost:${PORT}`);
  console.log(`Threshold: ${THRESHOLD} active users`);
  console.log(`Keys loaded: Key1=${!!KEY_1}, Key2=${!!KEY_2}`);
  console.log(`Frontend: http://localhost:${PORT}/index.html`);
});