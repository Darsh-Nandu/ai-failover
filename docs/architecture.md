# Architecture: How the fallback router works

## The core idea

Most API load balancers are complex — they track latency, error rates, and retry budgets. This one is intentionally simple: **it's a threshold check on one number**.

```
if (activeUsers >= threshold) {
  useKey2();
} else {
  useKey1();
}
```

That's it. The simplicity is the point. You don't need distributed systems infrastructure to implement Gemini-style graceful degradation.

---

## What counts as an "active user"?

In the demo, it's ghost users you simulate manually. In a real system, you'd track one of:

| Method | Best for | Accuracy |
|---|---|---|
| Concurrent HTTP connections | Backend server | High |
| Active sessions with a heartbeat | Web app | Medium |
| Requests in last 60 seconds | Stateless API | Medium |
| Redis counter with TTL | Multi-instance | High |

The threshold number should match whichever unit you pick. If you count "requests in the last minute", a threshold of 10 means "more than 10 requests per minute triggers fallback."

---

## Request lifecycle

```
1. User sends message
        │
2. Load balancer reads: activeUsers = 8, threshold = 10
        │
3. 8 < 10 → isFallback = false → use Key 1
        │
4. API call to Groq with Key 1
        │
5. Response received
        │
6. UI shows response (no banner — normal path)
```

vs. when traffic is high:

```
1. User sends message
        │
2. Load balancer reads: activeUsers = 12, threshold = 10
        │
3. 12 >= 10 → isFallback = true → use Key 2
        │
4. API call to Groq with Key 2
        │
5. Response received
        │
6. UI shows yellow "high demand" banner + response
```

The only differences between paths 1 and 2: which key is used, and whether the banner appears.

---

## Why two separate API keys?

Groq's free tier has rate limits per key. By using two keys from two separate accounts, you effectively double your rate limit budget. This is the same reason Gemini routes to a different model — it's a different quota pool.

**Important:** Both keys should be on the same or equivalent models so the quality of the response doesn't degrade. If you use a smaller/faster model on Key 2, tell users: "Answered by our faster model during high demand."

---

## What this system does NOT handle

- **Key 2 is also overloaded** — no third-tier fallback (but easy to add, see README)
- **Key rotation** — keys don't cycle back and forth; Key 1 is always primary
- **Error-based fallback** — if Key 1 returns a 429 error, this system doesn't automatically retry on Key 2 (you'd add a try/catch for that)
- **Real-time user counting** — the demo uses simulated ghost users; real deployments need a proper counter

---

## Adding error-based fallback

If Key 1 fails (rate limit, outage), you can catch and retry on Key 2:

```javascript
async function callWithFallback(message, key1, key2) {
  try {
    return await callGroq(key1, message);
  } catch (err) {
    if (err.status === 429 || err.status >= 500) {
      console.warn('Key 1 failed, falling back to Key 2:', err.message);
      return await callGroq(key2, message);
    }
    throw err; // Re-throw non-retryable errors
  }
}
```

Combined with load-based routing, this gives you both proactive and reactive fallback.
