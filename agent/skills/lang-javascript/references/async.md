# JavaScript Async Patterns

Promises, async/await, error handling, and concurrency utilities.

## async/await First

Use `async`/`await` as the default for asynchronous code. It reads top-to-bottom like synchronous code and makes error
handling straightforward.

```js
// Good — clear sequential flow
async function fetchUserPosts(userId) {
  const user = await getUser(userId);
  const posts = await getPosts(user.id);
  return posts;
}

// Avoid — .then() chains for sequential operations
function fetchUserPosts(userId) {
  return getUser(userId)
    .then((user) => getPosts(user.id));
}
```

### Key Rules

- **Always `await` promises.** A missing `await` creates a floating promise — the operation runs but its result and
  errors are silently lost.
- **Mark the function `async`** if it uses `await`.
- **Return values, not `return await`.** In a non-try/catch context, `return promise` and `return await promise` behave
  identically. Use `return await` only inside `try` blocks where you need to catch the awaited error.

```js
// Unnecessary await
async function getUser(id) {
  return await fetchUser(id); // just: return fetchUser(id);
}

// Necessary await — catch needs it
async function getUser(id) {
  try {
    return await fetchUser(id);
  } catch (err) {
    return null;
  }
}
```

## Error Handling

### try/catch with async/await

Wrap `await` calls in `try`/`catch` when you need to handle errors at that level. Don't wrap everything — let errors
propagate to a top-level handler when possible.

```js
// Good — granular error handling where needed
async function loadConfig() {
  try {
    const data = await readFile("config.json", "utf8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") return DEFAULT_CONFIG;
    throw err; // re-throw unexpected errors
  }
}
```

### Never Swallow Errors

Every `catch` must do something meaningful: rethrow, return a fallback, or report. An empty `catch` hides bugs.

```js
// Bad — error silently disappears
try { await riskyOperation(); } catch (err) {}

// Bad — console.log is not handling
try { await riskyOperation(); } catch (err) { console.log(err); }

// Good — handle or propagate
try {
  await riskyOperation();
} catch (err) {
  reportError(err);
  throw err;
}
```

### Throw Error Objects, Not Strings

Always throw `Error` instances (or subclasses). String throws lose stack traces:

```js
// Bad — no stack trace
throw "Something went wrong";
throw { message: "fail" };

// Good
throw new Error("Something went wrong");
throw new TypeError(`Expected string, got ${typeof value}`);
```

### Custom Error Classes

For errors callers need to distinguish, use custom error classes:

```js
class NotFoundError extends Error {
  constructor(resource, id) {
    super(`${resource} ${id} not found`);
    this.name = "NotFoundError";
    this.resource = resource;
    this.id = id;
  }
}

// Usage
throw new NotFoundError("User", userId);

// Catching
try { ... } catch (err) {
  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  throw err;
}
```

### Unhandled Rejections

Always attach `.catch()` to promise chains that aren't awaited. Unhandled rejections crash Node.js and produce console
errors in browsers:

```js
// Bad — floating promise, errors lost
fetchData();

// Good — fire-and-forget with error handling
fetchData().catch(reportError);

// Good — top-level await (ESM)
await fetchData();
```

## Concurrency

### Promise.all — Parallel Independent Work

When operations are independent, run them in parallel:

```js
// Bad — sequential when it doesn't need to be
const users = await getUsers();
const posts = await getPosts();
const comments = await getComments();

// Good — parallel
const [users, posts, comments] = await Promise.all([
  getUsers(),
  getPosts(),
  getComments(),
]);
```

`Promise.all` rejects as soon as any promise rejects. The other promises continue running but their results are not
available.

### Promise.allSettled — When All Results Matter

Use when you need results from all operations regardless of individual failures:

```js
const results = await Promise.allSettled([
  fetchFromPrimary(),
  fetchFromFallback(),
]);

const successes = results
  .filter((r) => r.status === "fulfilled")
  .map((r) => r.value);
```

### Promise.race and Promise.any

- **`Promise.race`**: resolves/rejects with the first settled promise. Use for timeouts.
- **`Promise.any`**: resolves with the first fulfilled promise. Rejects only when ALL promises reject. Use for
  fallbacks.

```js
// Timeout pattern
const result = await Promise.race([
  fetchData(),
  timeout(5000),
]);

// Fallback pattern
const data = await Promise.any([
  fetchFromCDN(),
  fetchFromOrigin(),
]);
```

### Avoid Sequential Awaits in Loops

```js
// Bad — each iteration waits for the previous one
for (const url of urls) {
  const data = await fetch(url); // sequential!
}

// Good — parallel when order doesn't matter
const results = await Promise.all(urls.map((url) => fetch(url)));

// Good — controlled concurrency for large arrays
// (use a library like p-map for concurrency limiting)
```

## Promise Construction

### Avoid the Constructor When Unnecessary

Most async code should compose existing promises with `async`/`await`. Only use `new Promise()` to wrap callback-based
APIs:

```js
// Unnecessary — already have a promise
const result = new Promise((resolve) => {
  resolve(existingPromise); // just return existingPromise directly
});

// Legitimate — wrapping a callback API
function readFileAsync(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, "utf8", (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}
```

### Cancellation with AbortController

Use `AbortController` for cancellable async operations:

```js
const controller = new AbortController();
const { signal } = controller;

const response = await fetch(url, { signal });

// Cancel from elsewhere
controller.abort();
```

Handle the abort in the caller — a cancellation is not an error to report:

```js
try {
  const response = await fetch(url, { signal });
} catch (error) {
  if (error.name === "AbortError") return; // cancelled by the user
  throw error;
}
```

## Promise Utilities

Small promise helpers that come up constantly:

```js
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = (url, timeout = 5000) => {
  return Promise.race([
    fetch(url),
    delay(timeout).then(() => Promise.reject(new Error("Timeout"))),
  ]);
};
```

## Retry with Exponential Backoff

For flaky operations (network calls), retry with capped exponential backoff:

```js
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.min(1000 * 2 ** i, 10000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};
```

## for-await-of

Use `for await...of` with async iterables:

```js
async function processStream(stream) {
  for await (const chunk of stream) {
    process(chunk);
  }
}
```

## Async Generators

```javascript
// Async generator for pagination
async function* fetchPaginatedData(baseUrl) {
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${baseUrl}?page=${page}`);
    const data = await response.json();

    yield data.items;

    hasMore = data.hasMore;
    page++;
  }
}

// Usage
for await (const items of fetchPaginatedData('/api/items')) {
  processItems(items);
}

// Async generator with error handling
async function* streamWithRetry(source) {
  let retries = 3;

  while (retries > 0) {
    try {
      for await (const chunk of source) {
        yield chunk;
      }
      break;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await delay(1000);
    }
  }
}
```

## Concurrent Queue Management

```javascript
// Limit concurrent operations
class AsyncQueue {
  #queue = [];
  #running = 0;
  #maxConcurrent;

  constructor(maxConcurrent = 3) {
    this.#maxConcurrent = maxConcurrent;
  }

  async run(fn) {
    while (this.#running >= this.#maxConcurrent) {
      await new Promise(resolve => this.#queue.push(resolve));
    }

    this.#running++;
    try {
      return await fn();
    } finally {
      this.#running--;
      const resolve = this.#queue.shift();
      if (resolve) resolve();
    }
  }
}

// Usage
const queue = new AsyncQueue(2);
const results = await Promise.all(
  urls.map(url => queue.run(() => fetch(url)))
);
```

## Event Loop Understanding

```javascript
// Microtasks vs Macrotasks
console.log('1: Synchronous');

setTimeout(() => console.log('2: Macrotask (setTimeout)'), 0);

Promise.resolve().then(() => console.log('3: Microtask (Promise)'));

queueMicrotask(() => console.log('4: Microtask (queueMicrotask)'));

console.log('5: Synchronous');

// Output order: 1, 5, 3, 4, 2

// Avoid blocking the event loop
const processLargeArray = async (items) => {
  const results = [];
  const chunkSize = 100;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    results.push(...chunk.map(processItem));

    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return results;
};
```


## Stream Processing

```javascript
// Process ReadableStream
const processStream = async (url) => {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    result += decoder.decode(value, { stream: true });
  }

  return result;
};

// Transform streams
const transformStream = new TransformStream({
  transform(chunk, controller) {
    const transformed = chunk.toString().toUpperCase();
    controller.enqueue(transformed);
  }
});

const response = await fetch('/data');
const transformed = response.body.pipeThrough(transformStream);
```

## Quick Reference

| Pattern | Use Case | Example |
|---------|----------|---------|
| `Promise.all()` | Parallel, fail-fast | `await Promise.all([p1, p2])` |
| `Promise.allSettled()` | Parallel, all results | `await Promise.allSettled([p1, p2])` |
| `Promise.race()` | First to complete | `await Promise.race([p1, p2])` |
| `Promise.any()` | First to succeed | `await Promise.any([p1, p2])` |
| `async function*` | Async iteration | `for await (const x of gen())` |
| `AbortController` | Cancellation | `fetch(url, { signal })` |
| `queueMicrotask()` | Priority microtask | `queueMicrotask(fn)` |
