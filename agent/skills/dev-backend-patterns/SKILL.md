---
name: dev-backend-patterns
description: Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes. Also covers authentication/authorization and security hardening — JWT, OAuth, RBAC, password hashing, input validation, XSS/CSRF, OWASP Top 10, and security headers. Use when building backend APIs, designing databases, or hardening server-side auth and security.
---

# Backend Development Patterns

## When to Activate

- Designing REST or GraphQL API endpoints
- Implementing repository, service, or controller layers
- Optimizing database queries (N+1, indexing, connection pooling)
- Adding caching (Redis, in-memory, HTTP cache headers)
- Setting up background jobs or async processing
- Structuring error handling and validation for APIs
- Building middleware (auth, logging, rate limiting)
- Implementing authentication, authorization, or security hardening (JWT, RBAC, OWASP, input validation, security headers)

## Reference Guide

Load detailed security guidance on demand — backend patterns are in this file:

| Topic | Reference | Load When |
|-------|-----------|----------|
| Security overview | [references/security.md](references/security.md) | Auth flows, JWT, RBAC, security workflow |
| OWASP Top 10 | [references/security/owasp-prevention.md](references/security/owasp-prevention.md) | OWASP vulnerability patterns |
| Password & JWT details | [references/security/authentication.md](references/security/authentication.md) | bcrypt/argon2 hashing, token flows |
| Input Validation | [references/security/input-validation.md](references/security/input-validation.md) | Zod schemas, SQL injection prevention |
| XSS / CSRF | [references/security/xss-csrf.md](references/security/xss-csrf.md) | XSS prevention, CSRF tokens |
| Security Headers | [references/security/security-headers.md](references/security/security-headers.md) | Helmet, CSP, CORS, rate limiting |

## API Design Patterns

### RESTful API Structure

```typescript
// PASS: Resource-based URLs, query parameters for filtering/sorting/pagination
GET    /api/markets                 # List resources
GET    /api/markets/:id             # Get single resource
POST   /api/markets                 # Create resource
PUT    /api/markets/:id             # Replace resource
PATCH  /api/markets/:id             # Update resource
DELETE /api/markets/:id             # Delete resource

GET /api/markets?status=active&sort=volume&limit=20&offset=0
```

### Repository Pattern

```typescript
interface MarketRepository {
  findAll(filters?: MarketFilters): Promise<Market[]>
  findById(id: string): Promise<Market | null>
  create(data: CreateMarketDto): Promise<Market>
  update(id: string, data: UpdateMarketDto): Promise<Market>
  delete(id: string): Promise<void>
}

class SupabaseMarketRepository implements MarketRepository {
  async findAll(filters?: MarketFilters): Promise<Market[]> {
    let query = supabase.from('markets').select('*')
    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.limit) query = query.limit(filters.limit)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
  }

  // Other methods...
}
```

### Service Layer Pattern

```typescript
// Business logic separated from data access
class MarketService {
  constructor(private marketRepo: MarketRepository) {}

  async searchMarkets(query: string, limit = 10): Promise<Market[]> {
    // Embed the query, vector-search, hydrate full records, sort by similarity
    const embedding = await generateEmbedding(query)
    const results = await this.vectorSearch(embedding, limit)
    const markets = await this.marketRepo.findByIds(results.map(r => r.id))
    return markets.sort((a, b) =>
      (results.find(r => r.id === a.id)?.score ?? 0) -
      (results.find(r => r.id === b.id)?.score ?? 0)
    )
  }

  private async vectorSearch(embedding: number[], limit: number) {}
}
```

### Middleware Pattern

```typescript
export function withAuth(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const user = await verifyToken(token)
      req.user = user
      return handler(req, res)
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}

// Usage: export default withAuth(handler) — handler gets req.user
```

## Database Patterns

### Query Optimization

```typescript
// PASS: GOOD: Select only needed columns
const { data } = await supabase
  .from('markets')
  .select('id, name, status, volume')
  .eq('status', 'active')
  .order('volume', { ascending: false })
  .limit(10)

// FAIL: BAD: Select everything — .select('*')
```

### N+1 Query Prevention

```typescript
// FAIL: BAD: N+1 query problem
const markets = await getMarkets()
for (const market of markets) {
  market.creator = await getUser(market.creator_id)  // N queries
}

// PASS: GOOD: Batch fetch
const markets = await getMarkets()
const creatorIds = markets.map(m => m.creator_id)
const creators = await getUsers(creatorIds)  // 1 query
const creatorMap = new Map(creators.map(c => [c.id, c]))

markets.forEach(market => {
  market.creator = creatorMap.get(market.creator_id)
})
```

### Transaction Pattern

```typescript
async function createMarketWithPosition(
  marketData: CreateMarketDto,
  positionData: CreatePositionDto
) {
  const { data, error } = await supabase.rpc('create_market_with_position', {
    market_data: marketData,
    position_data: positionData
  })

  if (error) throw new Error('Transaction failed')
  return data
}
```

```sql
CREATE OR REPLACE FUNCTION create_market_with_position(
  market_data jsonb, position_data jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  -- Implicit transaction: both inserts commit or roll back together
  INSERT INTO markets VALUES (market_data);
  INSERT INTO positions VALUES (position_data);
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

## Caching Strategies

### Redis Caching Layer (cache-aside)

Check cache first; on miss fetch from the database and store with a TTL:

```typescript
class CachedMarketRepository implements MarketRepository {
  constructor(
    private baseRepo: MarketRepository,
    private redis: RedisClient
  ) {}

  async findById(id: string): Promise<Market | null> {
    // Check cache first
    const cached = await this.redis.get(`market:${id}`)

    if (cached) {
      return JSON.parse(cached)
    }

    // Cache miss - fetch from database
    const market = await this.baseRepo.findById(id)

    if (market) {
      // Cache for 5 minutes
      await this.redis.setex(`market:${id}`, 300, JSON.stringify(market))
    }

    return market
  }

  async invalidateCache(id: string): Promise<void> {
    await this.redis.del(`market:${id}`)
  }
}
```

## Error Handling Patterns

### Centralized Error Handler

```typescript
class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message)
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

export function errorHandler(error: unknown, req: Request): Response {
  if (error instanceof ApiError) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: error.statusCode })
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({
      success: false,
      error: 'Validation failed',
      details: error.errors
    }, { status: 400 })
  }

  // Log unexpected errors
  console.error('Unexpected error:', error)

  return NextResponse.json({
    success: false,
    error: 'Internal server error'
  }, { status: 500 })
}

// Usage: wrap route handlers in try/catch and delegate to errorHandler(error, request)
```

### Retry with Exponential Backoff

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (i < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}

// Usage: const data = await fetchWithRetry(() => fetchFromAPI())
```

## Authentication & Authorization

Authentication, authorization, and OWASP hardening live in [references/security.md](references/security.md) — JWT validation, requireAuth/RBAC permission gates, password hashing, input validation, XSS/CSRF, security headers. Load it (or a topic file under `references/security/`) before implementing any auth or security code.

## Rate Limiting

### Simple In-Memory Rate Limiter

```typescript
class RateLimiter {
  private requests = new Map<string, number[]>()

  async checkLimit(identifier: string, maxRequests: number, windowMs: number): Promise<boolean> {
    const now = Date.now()
    const recent = (this.requests.get(identifier) || []).filter(t => now - t < windowMs)

    if (recent.length >= maxRequests) return false  // Rate limit exceeded

    recent.push(now)
    this.requests.set(identifier, recent)
    return true
  }
}

// Usage: per-IP limit of 100 req/min; return 429 when !limiter.checkLimit(ip, 100, 60000)
```

## Background Jobs & Queues

### Simple Queue Pattern

```typescript
class JobQueue<T> {
  private queue: T[] = []
  private processing = false

  async add(job: T): Promise<void> {
    this.queue.push(job)
    if (!this.processing) this.process()
  }

  private async process(): Promise<void> {
    this.processing = true
    while (this.queue.length > 0) {
      try {
        await this.execute(this.queue.shift()!)
      } catch (error) {
        console.error('Job failed:', error)
      }
    }
    this.processing = false
  }

  private async execute(job: T): Promise<void> {
    // Job execution logic
  }
}

// Usage: in a POST handler, `await indexQueue.add({ marketId })` instead of blocking on the work
```

## Logging & Monitoring

### Structured Logging

```typescript
class Logger {
  private log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context }))
  }

  info(message: string, context?: Record<string, unknown>) { this.log('info', message, context) }
  warn(message: string, context?: Record<string, unknown>) { this.log('warn', message, context) }
  error(message: string, error: Error, context?: Record<string, unknown>) {
    this.log('error', message, { ...context, error: error.message, stack: error.stack })
  }
}

const logger = new Logger()

// Usage
export async function GET(request: Request) {
  const requestId = crypto.randomUUID()
  logger.info('Fetching markets', { requestId, method: 'GET', path: '/api/markets' })

  try {
    const markets = await fetchMarkets()
    return NextResponse.json({ success: true, data: markets })
  } catch (error) {
    logger.error('Failed to fetch markets', error as Error, { requestId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```
