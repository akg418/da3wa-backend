# da3wa-backend

Authentication REST API: username/password sign-up and sign-in, Google OAuth 2.0, and stateless
JWT bearer tokens, backed by MongoDB.

- **Sign up / sign in** with a username and password (Argon2id hashing)
- **Sign in with Google** using the OAuth 2.0 authorization-code flow
- **One credential**: a JWT returned in the response body. No cookies, no CSRF token
- **Interactive API docs** at `/docs`, generated from the same schemas that validate requests
- **Typed and tested**: TypeScript, Zod, 45 tests

---

## Table of contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Running the server](#4-running-the-server)
5. [Verify it works](#5-verify-it-works)
6. [Setting up Google sign-in](#6-setting-up-google-sign-in)
7. [Frontend integration](#7-frontend-integration)
8. [API reference](#8-api-reference)
9. [API documentation (Swagger)](#9-api-documentation-swagger)
10. [Testing](#10-testing)
11. [Project structure](#11-project-structure)
12. [Security notes](#12-security-notes)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Requirements

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 20.19 | Developed on 26.8.1. Check with `node -v` |
| **npm** | >= 10 | Ships with Node. Check with `npm -v` |
| **MongoDB** | >= 6 | Local, Atlas, or the built-in in-memory mode — see below |
| **Google OAuth credentials** | — | Only needed for Google sign-in. Everything else works without them |
| **A C++ toolchain** | — | `argon2` compiles a native module on install. macOS: Xcode Command Line Tools. Debian/Ubuntu: `build-essential python3` |

### Choosing a database

You need **one** of these three:

**A. Local MongoDB Community** — recommended for development. Data survives restarts.

```bash
# macOS (Homebrew)
brew tap mongodb/brew
brew trust mongodb/brew
brew install mongodb-community

# Ubuntu/Debian: follow https://www.mongodb.com/docs/manual/administration/install-on-linux/
# Windows: https://www.mongodb.com/try/download/community
```

**B. In-memory** — zero setup. Set `MONGODB_URI=memory` and the server starts a throwaway
MongoDB inside its own process. **All data is lost when the server stops.** Development and tests
only; it is refused in production.

**C. MongoDB Atlas** — a free hosted cluster at <https://www.mongodb.com/atlas>. Use its
connection string as `MONGODB_URI`.

---

## 2. Installation

**Step 1 — get the code**

```bash
git clone <your-repo-url> da3wa-backend
cd da3wa-backend
```

**Step 2 — install dependencies**

```bash
npm install
```

This compiles the `argon2` native module, so the first install takes a minute.

**Step 3 — start MongoDB** (skip if you chose Atlas or `memory`)

```bash
# macOS: start now and on every login
brew services start mongodb/brew/mongodb-community

# Linux (systemd)
sudo systemctl start mongod
```

Confirm it answers:

```bash
mongosh --eval 'db.runCommand({ ping: 1 })'
# -> { ok: 1 }
```

**Step 4 — create your environment file**

```bash
cp .env.example .env
```

**Step 5 — generate a JWT secret** and paste it into `.env` as `JWT_SECRET`

```bash
openssl rand -hex 32
```

That is enough to run username/password authentication. For Google sign-in, continue to
[section 6](#6-setting-up-google-sign-in).

---

## 3. Configuration

Every variable lives in `.env`. The server validates all of them at boot and **refuses to start**
with a message naming each one that is missing or malformed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |
| `PORT` | no | `3000` | Port the API listens on |
| `API_PREFIX` | no | `/api/v1` | Prefix for every route. Must start with `/` |
| `MONGODB_URI` | **yes** | — | Connection string, or the literal `memory` |
| `JWT_SECRET` | **yes** | — | Token signing key, minimum 32 characters |
| `JWT_EXPIRES_IN` | no | `1h` | Token lifetime: `<number><s\|m\|h\|d>` |
| `COOKIE_SECURE` | no | `false` | Set `true` when serving over HTTPS |
| `COOKIE_SAME_SITE` | no | `lax` | Keep `lax`; `strict` breaks Google sign-in |
| `SWAGGER_ENABLED` | no | `true` | `false` returns 404 at `/docs` |
| `GOOGLE_CLIENT_ID` | **yes** | — | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | **yes** | — | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | **yes** | — | Must match Google Console verbatim |
| `FRONTEND_URL` | **yes** | — | Your web client's origin. Also the CORS allow-list |
| `FRONTEND_AUTH_CALLBACK_PATH` | no | `/auth/callback` | Where the Google callback redirects |

`GOOGLE_*` are required at boot even if you never call the Google routes — put any placeholder
there if you only need username/password auth.

The two cookie settings apply **only** to the signed `oauth_state` cookie used during Google
sign-in. No session cookie is ever set.

---

## 4. Running the server

```bash
npm run dev      # development, restarts on file changes, pretty logs
npm run build    # type-check and compile TypeScript into dist/
npm start        # run the compiled build (use this in production)
npm test         # run the full test suite
npm run test:watch
```

`npm run dev` reloads on changes under `src/`, but **not** on changes to `.env` — restart it
manually after editing environment variables.

---

## 5. Verify it works

With the server running:

```bash
# 1. Is the service and its database healthy?
curl http://localhost:3000/api/v1/health
# {"success":true,"data":{"status":"ok","database":"connected"}}

# 2. Register — the access token comes straight back
curl -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}'

# 3. Sign in and capture the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}' | jq -r .data.accessToken)

# 4. Use it
curl http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

Then open <http://localhost:3000/docs> for the interactive API documentation.

---

## 6. Setting up Google sign-in

**Step 1 — create a Google Cloud project** at <https://console.cloud.google.com/>.

**Step 2 — configure the OAuth consent screen** (newer consoles call this *Google Auth Platform*):

- Audience: **External**
- Fill in the app name, user support email, and developer contact
- Scopes: `openid`, `userinfo.email`, `userinfo.profile` — all non-sensitive, no Google review needed
- While the app is in **Testing**, add your own Google account under **Test users**. Without this
  Google answers `access_denied`

**Step 3 — create credentials**: *Credentials → Create credentials → OAuth client ID → Web application*

- **Authorized redirect URIs**: `http://localhost:3000/api/v1/auth/google/callback`

  This must match `GOOGLE_CALLBACK_URL` character for character. Use `localhost`, not
  `127.0.0.1` — Google treats them as different origins. No trailing slash.
- Authorized JavaScript origins: leave empty. This is a server-side code flow

**Step 4 — copy the client ID and secret into `.env`**, then restart the server.

**Step 5 — start the flow from a browser**:

```
http://localhost:3000/api/v1/auth/google
```

It must be a **top-level browser navigation** (address bar, or `window.location.href = ...`).
It will not work from `curl`, `fetch`, or Swagger UI's "Try it out" — those are XHR requests and
the browser blocks the cross-origin redirect to Google.

**What happens next**

1. The API stores a random `state` in a signed, httpOnly, 10-minute `oauth_state` cookie and
   redirects to Google
2. You pick an account and consent
3. Google redirects to `/api/v1/auth/google/callback`, which verifies the `state`, exchanges the
   code, and validates the ID token
4. The API redirects to your frontend with the token in the **URL fragment** — fragments are never
   sent to a server, so the token stays out of access logs and `Referer` headers:

```
http://localhost:5173/auth/callback#access_token=eyJ...&token_type=Bearer&expires_in=3600
```

If nothing is running on `FRONTEND_URL` you will see a "site can't be reached" page — the token is
still there in the address bar.

### Account linking

A Google sign-in whose email matches an existing account attaches `googleId` to it and sets
`authProviders` to `["local", "google"]`. Note that `POST /auth/signup` does **not** store an
email, so accounts created that way will not link automatically — a Google sign-in creates a
separate user.

---

## 7. Frontend integration

The API is a plain JSON service with bearer-token auth, so any client works. There is nothing to
configure beyond `FRONTEND_URL`, which is the CORS allow-list — requests from any other origin are
rejected by the browser.

A working single-file demo client lives in [`examples/frontend-demo.html`](examples/frontend-demo.html):

```bash
# terminal 1
npm run dev

# terminal 2
node examples/serve.mjs      # http://localhost:5173
```

It covers register, login, `/me`, logout, "Continue with Google", and reading the token out of the
OAuth callback fragment. The essentials:

```javascript
const API = 'http://localhost:3000/api/v1';

// Register or sign in — the token comes back in the body
const res = await fetch(`${API}/auth/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice_99', password: 'password1' }),
});
const { data } = await res.json();
localStorage.setItem('accessToken', data.accessToken);

// Every protected request
await fetch(`${API}/auth/me`, {
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
});

// Google: a top-level navigation, never fetch()
window.location.href = `${API}/auth/google`;

// On your /auth/callback page
const params = new URLSearchParams(window.location.hash.slice(1));
localStorage.setItem('accessToken', params.get('access_token'));
history.replaceState(null, '', window.location.pathname);
```

Do not use `credentials: 'include'` — there is no session cookie, and it is not needed.

---

## 8. API reference

Base path: `/api/v1`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Service and database status. `503` when MongoDB is unreachable |
| `POST` | `/auth/signup` | — | Register with `username` + `password`, returns a token |
| `POST` | `/auth/signin` | — | Sign in, returns a token |
| `GET` | `/auth/google` | — | Start Google sign-in (redirects to Google) |
| `GET` | `/auth/google/callback` | — | Google's callback; redirects to the frontend with a token |
| `GET` | `/auth/me` | Bearer | Profile of the authenticated user |
| `POST` | `/auth/logout` | Bearer | Acknowledgement; the client discards its token |

Outside the base path: `GET /docs`, `GET /docs/json`, `GET /docs/yaml`.

Routes under `/auth` are rate limited to **10 requests per minute per IP** and answer `429` with a
`retry-after` header beyond that. CORS preflights do not count toward the limit.

### Validation rules

**Username**

- 3–30 characters
- Letters, numbers and underscores only
- **Must not start with a number** → `"Username cannot start with a number"`
- Stored lowercase, so sign-in is case-insensitive

**Password**

- At least 8 characters
- At least one letter and at least one number

### Success response

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "id": "6a9ad9288c047ed0a05e2d83",
      "username": "alice_99",
      "authProviders": ["local"]
    }
  }
}
```

### Error response

Every failure uses the same envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "username", "message": "Username cannot start with a number" }]
  }
}
```

`details` is present only for `VALIDATION_ERROR`.

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A field failed validation |
| `BAD_REQUEST` | 400 | Malformed request, e.g. unparseable JSON |
| `UNAUTHORIZED` | 401 | Bad credentials, or a missing/invalid/expired token |
| `OAUTH_ERROR` | 401 | Google sign-in failed or the `state` did not match |
| `FORBIDDEN` | 403 | Reserved |
| `NOT_FOUND` | 404 | No such route |
| `CONFLICT` | 409 | Username already taken |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 9. API documentation (Swagger)

With the server running:

- **<http://localhost:3000/docs>** — interactive Swagger UI. Click **Authorize**, paste an
  `accessToken` (without the `Bearer ` prefix), and every protected endpoint becomes callable from
  the page
- **`/docs/json`** — the OpenAPI 3.1 document
- **`/docs/yaml`** — the same document as YAML

The document is generated from the Zod schemas that actually validate requests and serialize
responses, so it cannot drift from the API. `tests/integration/openapi.test.ts` fails the build if
a route is added without documentation, if the docs describe a route that does not exist, or if any
operation is missing a summary, description, `operationId`, tag, security declaration, or response
descriptions.

Set `SWAGGER_ENABLED=false` to stop serving `/docs`.

---

## 10. Testing

```bash
npm test
```

45 tests across 6 files. They spin up their own in-memory MongoDB, so **no running database is
required** and your development data is never touched.

| File | Covers |
|---|---|
| `tests/unit/auth.schemas.test.ts` | Username and password rules |
| `tests/unit/password.test.ts` | Argon2 hashing and verification |
| `tests/unit/auth.service.test.ts` | Sign-up, sign-in, Google account linking |
| `tests/integration/auth.local.test.ts` | Register/login/logout over HTTP, error cases |
| `tests/integration/auth.google.test.ts` | Full OAuth callback with Google's token exchange mocked |
| `tests/integration/openapi.test.ts` | Docs match the real routes; Swagger UI loads |

---

## 11. Project structure

```
src/
├── app.ts                       # Fastify app factory (plugins, hooks, health route)
├── server.ts                    # Entry point: connect DB, listen, graceful shutdown
├── config/
│   ├── env.ts                   # Zod-validated environment
│   ├── database.ts              # Mongoose connection (+ in-memory mode)
│   └── swagger.ts               # OpenAPI document and Swagger UI
├── models/user.model.ts         # Mongoose user schema
├── schemas/api.schemas.ts       # Shared response envelopes -> OpenAPI
├── modules/auth/
│   ├── auth.routes.ts           # Routes + their OpenAPI schemas
│   ├── auth.controller.ts       # Request handlers
│   ├── auth.service.ts          # Sign-up / sign-in / Google user resolution
│   ├── auth.schemas.ts          # Username and password rules
│   ├── auth.token.ts            # Access-token issuing
│   ├── auth.cookies.ts          # OAuth `state` cookie only
│   └── google-oauth.service.ts  # Google authorization URL + code exchange
├── middleware/
│   ├── authenticate.ts          # Bearer token guard
│   └── error-handler.ts         # Uniform error envelope
└── utils/                       # Argon2 hashing, error types
examples/
├── frontend-demo.html           # Single-file client exercising the whole API
└── serve.mjs                    # Serves the demo on :5173
tests/
├── unit/  integration/  helpers/
```

---

## 12. Security notes

- Passwords hashed with **Argon2id**; `passwordHash` is `select: false` and never serialized
- Access tokens are stateless JWTs verified from the `Authorization: Bearer` header only
- Google sign-in is protected by a signed, httpOnly `state` cookie, and ID tokens are verified
  against the client ID
- **Helmet** security headers, including a Content-Security-Policy
- CORS restricted to `FRONTEND_URL`
- Rate limiting: 10 requests/minute per IP on `/auth`
- Sign-in returns a generic `Invalid credentials` for both an unknown username and a wrong
  password, so the endpoint cannot be used to enumerate accounts

Because tokens are stateless, `POST /auth/logout` cannot revoke them server-side — it only tells
the client to discard its copy. Keep `JWT_EXPIRES_IN` short if that matters to you. Real revocation
needs refresh tokens with a server-side store.

**Before deploying:** set a fresh `JWT_SECRET`, `NODE_ENV=production`, `COOKIE_SECURE=true`, and
consider `SWAGGER_ENABLED=false`.

---

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017` | MongoDB is not running: `brew services start mongodb/brew/mongodb-community` |
| `Invalid environment variables:` at boot | A value in `.env` is missing or malformed; the message lists each field |
| `npm install` fails building `argon2` | Missing a C++ toolchain — install Xcode Command Line Tools (macOS) or `build-essential python3` (Debian/Ubuntu) |
| `401 Missing Authorization header` | Send `Authorization: Bearer <accessToken>` |
| `401 Access token has expired` | Sign in again, or raise `JWT_EXPIRES_IN` |
| `429 Too Many Requests` | Auth rate limit — wait a minute |
| CORS error in the browser | `FRONTEND_URL` does not exactly match your client's origin, scheme and port included |
| Google: `redirect_uri_mismatch` | The URI in Google Console differs from `GOOGLE_CALLBACK_URL` |
| Google: `access_denied` | Your account is not listed under **Test users** while the consent screen is in Testing |
| Google: `invalid_client` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are wrong or still placeholders |
| Google: `401 Invalid OAuth state` | The `oauth_state` cookie did not come back. Keep `COOKIE_SAME_SITE=lax`, and finish the flow within 10 minutes |
| `/docs` returns 404 | `SWAGGER_ENABLED=false` in `.env` |

---

## Not implemented

- Refresh tokens with rotation and revocation
- Email on sign-up, profile updates, password reset
- A manual "link my Google account" endpoint for a signed-in user

## License

ISC
