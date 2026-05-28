# Simulating fake traffic

When building a fallback system, you need a way to test it without 10 real users. Here are several approaches, from simplest to most realistic.

---

## Method 1: Manual ghost counter (what the demo uses)

The simplest approach — just set a number:

```javascript
let ghostUsers = 0;

// In your UI or test script
ghostUsers = 12; // pretend 12 people are online

// Your routing check
const isFallback = ghostUsers >= threshold;
```

Good for: demos, development testing, UI work.

---

## Method 2: setTimeout loop (simulates traffic bursts)

Automatically ramp up and down to watch the system switch:

```javascript
let activeUsers = 0;
const THRESHOLD = 10;

async function simulateTrafficBurst() {
  // Ramp up
  for (let i = 0; i <= 15; i++) {
    activeUsers = i;
    console.log(`Users: ${i} → API ${i >= THRESHOLD ? 2 : 1}`);
    await sleep(500); // 500ms between each "user joining"
  }

  // Hold
  await sleep(3000);

  // Ramp down
  for (let i = 15; i >= 0; i--) {
    activeUsers = i;
    console.log(`Users: ${i} → API ${i >= THRESHOLD ? 2 : 1}`);
    await sleep(500);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
simulateTrafficBurst();
```

Good for: watching the live traffic bar animate, testing threshold transitions.

---

## Method 3: Concurrent fetch flood (realistic HTTP load)

Sends real concurrent requests to see how your system handles them:

```javascript
async function floodTest(concurrency = 15) {
  const requests = Array.from({ length: concurrency }, (_, i) =>
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': `ghost-${i}` },
      body: JSON.stringify({ message: 'ping' })
    }).then(r => r.json())
  );

  const results = await Promise.all(requests);
  const fallbackCount = results.filter(r => r.usedFallback).length;
  console.log(`${fallbackCount}/${concurrency} requests used fallback API`);
}
```

Good for: backend integration testing, verifying your concurrency counter works.

---

## Method 4: Artillery or k6 (professional load testing)

For production-level testing, use a proper load testing tool.

**Using k6:**

```javascript
// save as load-test.js, run with: k6 run load-test.js
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp to 5 users (below threshold)
    { duration: '30s', target: 15 },  // Ramp to 15 users (above threshold)
    { duration: '30s', target: 0 },   // Ramp back down
  ],
};

export default function () {
  const res = http.post('http://localhost:3000/api/chat', 
    JSON.stringify({ message: 'Hello' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  console.log(`Status: ${res.status}, Fallback: ${res.json('usedFallback')}`);
  sleep(1);
}
```

Install k6: `brew install k6` (macOS) or download from [k6.io](https://k6.io).

---

## Interpreting results

When you run any simulation, look for:

| What to check | Expected behaviour |
|---|---|
| At 9 users (below threshold of 10) | All requests → API 1, no banner |
| At exactly 10 users | Switches to API 2, banner appears |
| At 15 users | Still API 2, banner still shown |
| Back to 9 users | Switches back to API 1, no banner |

The switch should be instantaneous — there's no hysteresis (delay before switching back). If you want a "cooldown" before switching back to API 1, add a timer.

---

## Adding cooldown (optional)

Prevent thrashing when users hover right at the threshold:

```javascript
let isFallbackMode = false;
let lastSwitchTime = 0;
const COOLDOWN_MS = 30_000; // 30 seconds before switching back

function getRoutingDecision(activeUsers, threshold) {
  const now = Date.now();
  const overThreshold = activeUsers >= threshold;
  const cooldownOver = (now - lastSwitchTime) > COOLDOWN_MS;

  if (overThreshold && !isFallbackMode) {
    isFallbackMode = true;
    lastSwitchTime = now;
  } else if (!overThreshold && isFallbackMode && cooldownOver) {
    isFallbackMode = false;
    lastSwitchTime = now;
  }

  return isFallbackMode;
}
```
