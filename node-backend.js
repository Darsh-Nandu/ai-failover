import express from 'express';
import fetch from 'node-fetch';
import 'dotenv/config';

const app = express();
app.use(express.json());

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
    for (const[sessionId, expiry] of activeSessions) {
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
        })
    });
    
    if (!res.ok) {
        const err = res.json().catch(() => ({}));
        throw Object.assign(new Error(err?.error?.message || 'Groq API error'), { status: res.status });
    }

    const data = await res.json();
    return data.choices[0].message.content;
}

// Routes

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  const sessionId = req.headers['x-session-id'] || `anon-${Date.now()}`;
 
  if (!message) return res.status(400).json({ error: 'message is required' });
 
  // Count this session as active
  registerSession(sessionId);
  const activeUsers = getActiveCount();
 
  const chosenKey  = selectKey(activeUsers);
  const isFallback = chosenKey === KEY_2;
 
  console.log(`[${new Date().toISOString()}] session=${sessionId} active=${activeUsers} api=${isFallback ? 2 : 1}`);
 
  try {
    const reply = await callGroq(chosenKey, message);
    res.json({
      reply,
      usedFallback: isFallback,
      activeUsers,
      threshold: THRESHOLD,
      notice: isFallback
        ? 'High demand — answered by our secondary model. No extra charge.'
        : null,
    });
  } catch (err) {
    // If primary fails with 429, try fallback key regardless of load
    if (!isFallback && (err.status === 429 || err.status >= 500)) {
      console.warn('Primary key failed, emergency fallback to Key 2');
      try {
        const reply = await callGroq(KEY_2, message);
        return res.json({
          reply,
          usedFallback: true,
          activeUsers,
          notice: 'Primary API unavailable — answered by fallback. No extra charge.',
        });
      } catch (fallbackErr) {
        return res.status(503).json({ error: 'Both APIs unavailable. Please try again.' });
      }
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});
 
// Status endpoint — useful for monitoring dashboards
app.get('/api/status', (_req, res) => {
  const active = getActiveCount();
  res.json({
    activeUsers: active,
    threshold: THRESHOLD,
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
});