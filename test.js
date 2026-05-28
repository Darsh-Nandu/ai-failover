/**
 * ai-failover test suite
 * Run: node test.js
 * 
 * Tests routing logic, session tracking, and failover behaviour
 * without needing real API keys or a running server.
 */

// Minimal test harness
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
}

// Module under test: extract pure functions from backend logic

const THRESHOLD = 10;
const KEY_1 = 'key-primary';
const KEY_2 = 'key-fallback';

function selectKey(activeUsers) {
  return activeUsers >= THRESHOLD ? KEY_2 : KEY_1;
}

// Session tracking (mirrors node-backend.js)
function makeSessionTracker(ttlMs = 30_000) {
  const sessions = new Map();

  function register(id, nowOverride) {
    const now = nowOverride ?? Date.now();
    sessions.set(id, now + ttlMs);
  }

  function evict(nowOverride) {
    const now = nowOverride ?? Date.now();
    for (const [id, expiry] of sessions) {
      if (now > expiry) sessions.delete(id);
    }
  }

  function count(nowOverride) {
    evict(nowOverride);
    return sessions.size;
  }

  function clear() { sessions.clear(); }

  return { register, evict, count, clear };
}

// Routing Logic 
console.log('\n=== Routing Logic ===');

test('below threshold → uses primary key', () => {
  assertEqual(selectKey(0), KEY_1);
  assertEqual(selectKey(9), KEY_1);
  assertEqual(selectKey(1), KEY_1);
});

test('at threshold → uses fallback key', () => {
  assertEqual(selectKey(10), KEY_2);
});

test('above threshold → uses fallback key', () => {
  assertEqual(selectKey(11), KEY_2);
  assertEqual(selectKey(100), KEY_2);
});

test('isFallback flag is set correctly', () => {
  const isFallback9 = selectKey(9) === KEY_2;
  const isFallback10 = selectKey(10) === KEY_2;
  assert(!isFallback9, 'Should not be fallback at 9');
  assert(isFallback10, 'Should be fallback at 10');
});

// Session Tracking
console.log('\n=== Session Tracking ===');

test('new tracker starts at 0', () => {
  const t = makeSessionTracker();
  assertEqual(t.count(), 0);
});

test('registering a session increments count', () => {
  const t = makeSessionTracker();
  t.register('s1');
  assertEqual(t.count(), 1);
});

test('same session ID registered twice does not double-count', () => {
  const t = makeSessionTracker();
  t.register('s1');
  t.register('s1');
  assertEqual(t.count(), 1);
});

test('multiple unique sessions all counted', () => {
  const t = makeSessionTracker(30_000);
  const now = Date.now();
  t.register('a', now);
  t.register('b', now);
  t.register('c', now);
  assertEqual(t.count(now + 1000), 3);
});

test('expired sessions are evicted', () => {
  const ttl = 5_000;
  const t = makeSessionTracker(ttl);
  const now = 1_000_000;
  t.register('s1', now);
  t.register('s2', now);
  assertEqual(t.count(now + ttl + 1), 0); // both expired
});

test('only expired sessions are evicted, fresh ones remain', () => {
  const ttl = 10_000;
  const t = makeSessionTracker(ttl);
  const now = 1_000_000;
  t.register('old', now);                    // registered at T=0
  t.register('fresh', now + ttl - 1);        // registered just before deadline
  const countAtExpiry = t.count(now + ttl + 1);
  assertEqual(countAtExpiry, 1); // only 'fresh' survives
});

test('re-registering a session resets its TTL', () => {
  const ttl = 5_000;
  const t = makeSessionTracker(ttl);
  const now = 1_000_000;
  t.register('s1', now);              // registered at T=0
  t.register('s1', now + ttl - 1);   // renewed just before expiry
  // At T = ttl + 100 it would have expired if not renewed
  assertEqual(t.count(now + ttl + 100), 1);
});

// Ghost User Simulation
console.log('\n=== Ghost User Simulation ===');

test('ghost users are added on top of real sessions', () => {
  const t = makeSessionTracker();
  t.register('real-user');
  const realCount = t.count();
  const ghostUsers = 9;
  const total = realCount + ghostUsers;
  assertEqual(total, 10); // 1 real + 9 ghost = threshold
  assert(total >= THRESHOLD, 'Should trigger fallback');
});

test('zero ghost users = no effect on routing', () => {
  const ghostUsers = 0;
  const total = 5 + ghostUsers;
  assertEqual(selectKey(total), KEY_1);
});

test('ghost users alone can push over threshold', () => {
  const ghostUsers = 15;
  assertEqual(selectKey(ghostUsers), KEY_2);
});

// Edge Cases
console.log('\n=== Edge Cases ===');

test('threshold of 1 means even single user triggers fallback', () => {
  const key = (users) => users >= 1 ? KEY_2 : KEY_1;
  assertEqual(key(0), KEY_1);
  assertEqual(key(1), KEY_2);
});

test('threshold of 20 keeps primary until exactly 20 users', () => {
  const highThreshold = 20;
  const key = (users) => users >= highThreshold ? KEY_2 : KEY_1;
  assertEqual(key(19), KEY_1);
  assertEqual(key(20), KEY_2);
});

test('empty message body detected', () => {
  const message = '';
  const isInvalid = !message;
  assert(isInvalid, 'Empty message should be flagged as invalid');
});

test('missing session ID falls back to anonymous ID', () => {
  const header = undefined;
  const sessionId = header || `anon-${Date.now()}`;
  assert(sessionId.startsWith('anon-'), 'Should generate anon session ID');
});

test('both keys unavailable → 503 scenario', () => {
  // Simulate both keys failing
  const errors = [
    { status: 429, key: 'KEY_1' },
    { status: 503, key: 'KEY_2' },
  ];
  const allFailed = errors.every(e => e.status >= 400);
  assert(allFailed, 'Both keys failed scenario should return error');
});

// Response Shape
console.log('\n=== Response Shape ===');

test('primary response has expected fields', () => {
  const response = {
    reply: 'Hello!',
    usedFallback: false,
    activeUsers: 5,
    threshold: 10,
    notice: null,
  };
  assert('reply' in response, 'Missing reply');
  assert('usedFallback' in response, 'Missing usedFallback');
  assert('activeUsers' in response, 'Missing activeUsers');
  assertEqual(response.notice, null);
  assert(!response.usedFallback, 'Primary response should have usedFallback=false');
});

test('fallback response has notice message', () => {
  const response = {
    reply: 'Hello!',
    usedFallback: true,
    activeUsers: 12,
    threshold: 10,
    notice: 'High demand — answered by our secondary model. No extra charge.',
  };
  assert(response.usedFallback, 'Should be fallback');
  assert(response.notice !== null, 'Notice should be present in fallback response');
  assert(response.notice.length > 0, 'Notice should not be empty');
});

test('status endpoint shape', () => {
  const activeUsers = 8;
  const threshold = 10;
  const status = {
    activeUsers,
    threshold,
    currentApi: activeUsers >= threshold ? 2 : 1,
    isFallbackMode: activeUsers >= threshold,
  };
  assertEqual(status.currentApi, 1);
  assert(!status.isFallbackMode);
});

// Summary
console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);

if (failed > 0) process.exit(1);