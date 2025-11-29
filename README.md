## Capsule Backend

Capsule lets you put your GitHub projects online in **one click** (more or less).  
This backend connects to your GitHub account, builds your app into a container, runs it on Kubernetes, and gives you a URL you can share.

---

## What does it do?

For **non‑technical readers**:

- You select a GitHub repository.
- Capsule:
  - Connects to GitHub securely.
  - Builds your app.
  - Starts it on a managed server cluster (Kubernetes).
  - Gives you a link to access it.
  - Shows you live logs so you can see what’s happening.

For **technical readers** (very short version):

- NestJS API that:
  - Authenticates users via Supabase.
  - Uses a GitHub App to access repositories.
  - Orchestrates builds and deployments through Redis + BullMQ.
  - Talks to Kubernetes to create Namespaces, Deployments, Services and Ingresses.
  - Streams build and deploy logs over WebSockets.

---

## High-level flow

1. **Connect GitHub**  
   The user links their GitHub account via a GitHub App installation.

2. **Create a deployment**  
   The frontend calls `POST /deployments` with repo + branch + port.

3. **Build**  
   A background worker:
   - Clones the repo.
   - Builds a Docker image in a temporary Kubernetes Job.
   - Pushes it to a container registry.

4. **Deploy**  
   Another worker:
   - Creates a per‑user Kubernetes namespace.
   - Creates a Deployment + Service + Ingress.
   - Waits until the app is ready, then stores and returns the public URL.

5. **Observe**  
   Logs and status updates are pushed to the UI in real time via WebSockets.

---

## Tech overview

- **Framework**: NestJS (Node.js + TypeScript)
- **Data & auth**: Supabase (Postgres + auth)
- **Background jobs**: BullMQ (Redis)
- **GitHub integration**: GitHub App (Octokit)
- **Runtime**: Kubernetes (Jobs + Deployments + Services + Ingress)
- **Real‑time**: WebSockets (Socket.IO)

---

## Local development

### Prerequisites

- Node.js (LTS)
- npm or pnpm
- Redis
- Access to:
  - A Kubernetes cluster
  - A container registry
  - A Supabase project (or equivalent)
  - A configured GitHub App

### Install & run

```bash
# Install dependencies
npm install

# Start in development mode
npm run start:dev
# or
npm run dev
```

Build & production:

```bash
npm run build
npm run start:prod
```

### Docker

A [Dockerfile](cci:7://file:///Users/theopoette/misc/capsule/backend/Dockerfile:0:0-0:0) is included:

```bash
docker build -t capsule-backend .
docker run --env-file .env -p 3000:3000 capsule-backend
```

---

## Configuration

Most settings are provided via environment variables:

- **GitHub App**: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_CLIENT_ID`
- **Supabase**: URL, keys, etc.
- **Redis**: `REDIS_HOST`, `REDIS_PORT`
- **Registry**: `REGISTRY_URL`, `REGISTRY_USER`, `REGISTRY_PASSWORD`
- **Domain**: `BASE_DOMAIN` (used to build deployment URLs)

Use [.env.example](cci:7://file:///Users/theopoette/misc/capsule/backend/.env.example:0:0-0:0) as a starting point and create your own [.env](cci:7://file:///Users/theopoette/misc/capsule/backend/.env:0:0-0:0) file.  
Do **not** commit secrets.

---

## Project structure (short)

```text
backend/
  src/
    app.module.ts          # Root Nest module
    auth/                  # Auth & guards
    build/                 # Build worker & services
    deployments/           # Deployments API & worker
    github/                # GitHub integration
    kubernetes/            # K8s client & helpers
    logs/                  # WebSocket log gateway
    supabase/              # Supabase client
    queue/, state/, ...    # Supporting modules
  builder/
    job-template.yaml      # K8s Job template for builds
  database.types.ts        # Supabase types
  Dockerfile
  package.json
  .env, .env.example, ...
```

---

## License

This project is open‑sourced under the MIT License.

You’re free to use, modify, and distribute this code under the terms of the MIT license.