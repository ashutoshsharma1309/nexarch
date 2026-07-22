/**
 * Scalability recommendations — documentation only. Advisory, not applied
 * automatically: scaling decisions depend on real traffic the generated
 * project doesn't have yet.
 */
import type { DeploymentArtifacts, ScalabilityDocs } from '../deployment.types.js';

export function generateScalabilityDocs(artifacts: DeploymentArtifacts): ScalabilityDocs {
  const markdown = `# Scalability recommendations — ${artifacts.projectName}

These are starting points, not requirements — apply them when metrics
(see \`/metrics\` and the Monitoring section of the deployment guide)
actually show the bottleneck they address.

## Horizontal scaling

The backend is stateless (auth is JWT-based, no server-side session
store), so it scales horizontally by running more container replicas
behind a load balancer with no sticky-session requirement. On
Docker Compose, that's \`docker compose up --scale backend=3\`; on ECS/Cloud
Run/App Service, it's the platform's native replica/instance count.

## Vertical scaling

Cheaper to reach for first — bump the CPU/memory limits in
\`docker-compose.prod.yml\` (or the target's instance size) before adding
replicas. Watch \`process_memory_heap_used_bytes\` from \`/metrics\` to know
when you're actually memory-bound versus CPU-bound.

## Caching

- **Read-heavy endpoints**: add a Redis (or platform-managed cache) layer in front of expensive queries; the dependency graph shows exactly which service methods are read-only and safe to cache.
- **HTTP caching**: set \`Cache-Control\` headers on public GET endpoints that don't vary per user.

## CDN

Serve the frontend's static build (\`frontend/dist\`) through a CDN
(CloudFront, Cloudflare, the platform's built-in CDN on Vercel/Netlify) —
it's a static SPA bundle with no server-side rendering, so this is a
pure win with no application changes required.

## Load balancing

Required as soon as you run more than one backend replica.
Docker Compose needs an external reverse proxy (nginx, Traefik) in front
of the \`backend\` service; ECS, Cloud Run, App Service, Render, and
Railway all provide this natively.

## Queue workers

None of the generated endpoints are long-running by default. If a future
feature needs background work (bulk imports, email sending, report
generation), move it off the request/response cycle into a queue
(BullMQ + Redis, SQS, Cloud Tasks) rather than blocking an HTTP worker —
the dependency graph's "Impact Simulation" can help scope exactly which
files that change touches before you build it.
`;

  return { markdown };
}
