# Auth System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use kit:team-dev to implement this plan task-by-task.

**Goal:** Implement JWT authentication with refresh tokens

**Architecture:** Express middleware validates access tokens, refresh endpoint rotates tokens

**Tech Stack:** TypeScript, jsonwebtoken, bcrypt

---

### Task 1: Token Generation

**Files:**
- Create: `src/auth/tokens.ts`
- Test: `tests/auth/tokens.test.ts`

**Step 1: Write the failing test**

```typescript
import { generateAccessToken } from "../src/auth/tokens";

test("generates a valid JWT access token", () => {
  const token = generateAccessToken({ userId: "123" });
  expect(token).toBeDefined();
  expect(typeof token).toBe("string");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern tokens`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
import jwt from "jsonwebtoken";

export function generateAccessToken(payload: { userId: string }): string {
  return jwt.sign(payload, process.env.JWT_SECRET ?? "dev-secret", { expiresIn: "15m" });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern tokens`
Expected: PASS

### Task 2: Auth Middleware

**Files:**
- Create: `src/auth/middleware.ts`
- Test: `tests/auth/middleware.test.ts`

**Step 1: Write the failing test**

```typescript
test("rejects requests without Authorization header", async () => {
  const req = { headers: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await authMiddleware(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
});
```

**Step 2: Implement middleware**

```typescript
export async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET ?? "dev-secret");
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
```
