# Groq API Fallback Load Balancer

A demand-aware API router that automatically switches between two Groq API keys when traffic exceeds a threshold — inspired by how Google Gemini handles high-demand periods. When too many users are hitting the primary API, new requests silently fall back to a secondary API key, and users see a friendly "high demand" notice.

---

## How it works

```
User Request
     │
     ▼
┌─────────────────────────────┐
│   Load Balancer             │
│   Active users >= threshold?│
└──────┬──────────────────────┘
       │
   ┌───┴───┐
  No      Yes
   │        │
   ▼        ▼
API Key 1  API Key 2
(primary)  (fallback)
   │        │
   └───┬────┘
       ▼
  Response + banner
  (if fallback was used)
```

The threshold (default: 10 active users) is fully configurable. When demand is high:
- The request goes to API Key 2 automatically
- A yellow "high demand" banner appears in the UI
- The user is informed they won't be charged extra
- No request is dropped or delayed

---

## Features

- **Zero dropped requests** — always routes to one of two keys
- **Visual feedback** — Gemini-style "high demand" banner when falling back
- **Fake traffic simulator** — simulate ghost users to test fallback without real load
- **Adjustable threshold** — slider from 1–20 active users
- **Live traffic bar** — visual indicator of current API load
- **Per-request routing log** — every request shows which API handled it

---

## Getting started

### 1. Get your Groq API keys

1. Go to [console.groq.com](https://console.groq.com)
2. Sign in or create an account (free)
3. Navigate to **API Keys** in the sidebar
4. Create two keys — name them `primary` and `fallback`

### 2. Run the app

The app is a single HTML file with no build step required.

```bash
git clone https://github.com/your-username/groq-fallback-lb
cd groq-fallback-lb
open index.html   # macOS
# or just double-click index.html in your file explorer
```

### 3. Enter your keys

Paste Key 1 into the "Primary" field and Key 2 into the "Fallback" field in the UI.

---

## Simulating fake traffic (for testing)

You don't need 10 real users to test the fallback. Use the built-in simulator:

1. Set the **threshold** slider (e.g. 5)
2. Enter a number in the **"Simulate ghost users"** field (e.g. 6)
3. Click **Apply**
4. Send a message — it will route to API 2 and show the fallback banner

This is how you'd demo the system without any real traffic.

### Programmatic simulation

If you're integrating this into a backend, you can fake traffic by maintaining a counter:

```javascript
// Simulate N concurrent users
let activeUsers = 0;

function simulateTraffic(n) {
  activeUsers = n;
}

function shouldFallback(threshold = 10) {
  return activeUsers >= threshold;
}

// Example: simulate 12 users, threshold 10 → routes to API 2
simulateTraffic(12);
console.log(shouldFallback()); // true → use API Key 2
```

---

## File structure

```
groq-fallback-lb/
├── index.html          # The full app (single file)
├── README.md           # This file
├── docs/
│   ├── architecture.md # Deep dive on routing logic
│   └── simulate.md     # Guide to traffic simulation methods
└── examples/
    └── node-backend.js # Node.js backend version with real concurrency tracking
```

---

## Core routing logic (annotated)

```javascript
// The entire fallback decision is one line:
const isFallback = activeUsers >= threshold;

// Pick the right key
const activeKey = isFallback ? key2 : key1;

// Make the API call — nothing else changes
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + activeKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: userMessage }]
  })
});

// Tell the user if fallback was used
if (isFallback) {
  showBanner('High demand — answered by our secondary model. No extra charge.');
}
```

The beauty of this pattern: the API call itself is identical. Only the key changes.

---

## Extending this project

### Add a third API key (circuit breaker pattern)

```javascript
const keys = [key1, key2, key3];

function getKey(activeUsers, threshold) {
  const tier = Math.floor(activeUsers / threshold);
  return keys[Math.min(tier, keys.length - 1)];
}
```

### Add real concurrency tracking (Node.js backend)

```javascript
let activeSessions = new Set();

app.post('/chat', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  activeSessions.add(sessionId);

  const key = activeSessions.size >= THRESHOLD ? KEY_2 : KEY_1;

  try {
    const reply = await callGroq(key, req.body.message);
    res.json({ reply, usedFallback: key === KEY_2 });
  } finally {
    // Remove after response completes
    setTimeout(() => activeSessions.delete(sessionId), 30_000);
  }
});
```

---

## Contributing

PRs welcome. Especially interested in:
- Redis-backed concurrency counter for multi-instance deployments
- Automatic key health checks (if Key 1 errors, switch regardless of load)
- Analytics dashboard showing fallback rate over time

---

## License

MIT