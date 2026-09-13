
# Security: Authentication, Authorization & Hardening

Merged security reference (formerly the standalone `dev-auth` skill plus the backend auth patterns). Load the topic files under `references/security/` for deep detail.

## Core Workflow

1. **Threat model** — Identify attack surface and threats
2. **Design** — Plan security controls
3. **Implement** — Write secure code with defense in depth; see code examples below
4. **Validate** — Test security controls with explicit checkpoints (see below)
5. **Document** — Record security decisions

### Validation Checkpoints

After each implementation step, verify:

- **Authentication**: Test brute-force protection (lockout/rate limit triggers), session fixation resistance, token expiration, and invalid-credential error messages (must not leak user existence).
- **Authorization**: Verify horizontal and vertical privilege escalation paths are blocked; test with tokens belonging to different roles/users.
- **Input handling**: Confirm SQL injection payloads (`' OR 1=1--`) are rejected; confirm XSS payloads (`<script>alert(1)</script>`) are escaped or rejected.
- **Headers/CORS**: Validate with a security scanner (e.g., `curl -I`, Mozilla Observatory) that security headers are present and CORS origin allowlist is correct.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| OWASP | `references/security/owasp-prevention.md` | OWASP Top 10 patterns |
| Authentication | `references/security/authentication.md` | Password hashing, JWT |
| Input Validation | `references/security/input-validation.md` | Zod, SQL injection |
| XSS/CSRF | `references/security/xss-csrf.md` | XSS prevention, CSRF |
| Headers | `references/security/security-headers.md` | Helmet, rate limiting |

## Constraints

### MUST DO
- Hash passwords with bcrypt/argon2 (never MD5/SHA-1/unsalted hashes)
- Use parameterized queries (never string-interpolated SQL)
- Validate and sanitize all user input before use
- Implement rate limiting on auth endpoints
- Set security headers (CSP, HSTS, X-Frame-Options)
- Log security events (failed auth, privilege escalation attempts)
- Store secrets in environment variables or secret managers (never in source code)

### MUST NOT DO
- Store passwords in plaintext or reversibly encrypted form
- Trust user input without validation
- Expose sensitive data in logs or error responses
- Use weak or deprecated algorithms (MD5, SHA-1, DES, ECB mode)
- Hardcode secrets or credentials in code

## Code Examples

### Password Hashing (bcrypt)

```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12; // minimum 10; 12 balances security and performance

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
```

### Parameterized SQL Query (Node.js / pg)

```typescript
// NEVER: `SELECT * FROM users WHERE email = '${email}'`
// ALWAYS: use positional parameters
import { Pool } from 'pg';
const pool = new Pool();

export async function getUserByEmail(email: string) {
  const { rows } = await pool.query(
    'SELECT id, email, role FROM users WHERE email = $1',
    [email]  // value passed separately — never interpolated
  );
  return rows[0] ?? null;
}
```

### Input Validation with Zod

```typescript
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

export function validateLoginInput(raw: unknown) {
  const result = LoginSchema.safeParse(raw);
  if (!result.success) {
    // Return generic error — never echo raw input back
    throw new Error('Invalid credentials format');
  }
  return result.data;
}
```

### JWT Validation

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!; // never hardcode

export function verifyToken(token: string): jwt.JwtPayload {
  // Throws if expired, tampered, or wrong algorithm
  const payload = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],   // explicitly allowlist algorithm
    issuer: 'your-app',
    audience: 'your-app',
  });
  if (typeof payload === 'string') throw new Error('Invalid token payload');
  return payload;
}
```

### Securing an Endpoint — Full Flow

```typescript
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const app = express();
app.use(helmet()); // sets CSP, HSTS, X-Frame-Options, etc.
app.use(express.json({ limit: '10kb' })); // limit payload size

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/login', authLimiter, async (req, res) => {
  // 1. Validate input
  const { email, password } = validateLoginInput(req.body);

  // 2. Authenticate — parameterized query, constant-time compare
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // Generic message — do not reveal whether email exists
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 3. Authorize — issue scoped, short-lived token
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'your-app', audience: 'your-app' }
  );

  // 4. Secure response — token in httpOnly cookie, not body
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict' });
  return res.json({ message: 'Authenticated' });
});
```

## Next.js API Route Patterns

Express-flavored examples above; these are the Next.js route-handler equivalents. They pair with `verifyToken` from the JWT Validation example above and `ApiError` from the main skill's centralized error handler.

### requireAuth Helper

```typescript
export async function requireAuth(request: Request) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) {
    throw new ApiError(401, 'Missing authorization token')
  }

  return verifyToken(token)
}

// Usage in API route
export async function GET(request: Request) {
  const user = await requireAuth(request)

  const data = await getDataForUser(user.userId)

  return NextResponse.json({ success: true, data })
}
```

### Role-Based Access Control

```typescript
type Permission = 'read' | 'write' | 'delete' | 'admin'

interface User {
  id: string
  role: 'admin' | 'moderator' | 'user'
}

const rolePermissions: Record<User['role'], Permission[]> = {
  admin: ['read', 'write', 'delete', 'admin'],
  moderator: ['read', 'write', 'delete'],
  user: ['read', 'write']
}

export function hasPermission(user: User, permission: Permission): boolean {
  return rolePermissions[user.role].includes(permission)
}

export function requirePermission(permission: Permission) {
  return (handler: (request: Request, user: User) => Promise<Response>) => {
    return async (request: Request) => {
      const user = await requireAuth(request)

      if (!hasPermission(user, permission)) {
        throw new ApiError(403, 'Insufficient permissions')
      }

      return handler(request, user)
    }
  }
}

// Usage - HOF wraps the handler
export const DELETE = requirePermission('delete')(
  async (request: Request, user: User) => {
    // Handler receives authenticated user with verified permission
    return new Response('Deleted', { status: 200 })
  }
)
```

## Output Templates

When implementing security features, provide:
1. Secure implementation code
2. Security considerations noted
3. Configuration requirements (env vars, headers)
4. Testing recommendations

## Knowledge Reference

OWASP Top 10, bcrypt/argon2, JWT, OAuth 2.0, OIDC, CSP, CORS, rate limiting, input validation, output encoding, encryption (AES, RSA), TLS, security headers
