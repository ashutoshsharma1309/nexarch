/**
 * Compose files and `.dockerignore`s that wire together the Dockerfiles
 * Phases 5/6 already generate (`backend/Dockerfile` on port 4000,
 * `frontend/Dockerfile` — nginx — on port 80). This module never emits a
 * Dockerfile itself.
 */
import type { DeploymentArtifacts, DeploymentFile, DockerBundle } from '../deployment.types.js';

function dbServiceName(engine: string | undefined): 'mysql' | 'postgres' {
  return (engine ?? 'mysql').toLowerCase().includes('postgres') ? 'postgres' : 'mysql';
}

function backendDockerignore(): DeploymentFile {
  return {
    path: 'backend/.dockerignore',
    language: 'ignore',
    content: `node_modules
dist
.env
.env.*
*.log
coverage
.git
`,
  };
}

function frontendDockerignore(): DeploymentFile {
  return {
    path: 'frontend/.dockerignore',
    language: 'ignore',
    content: `node_modules
dist
.env
.env.*
*.log
coverage
.git
`,
  };
}

function composeDev(artifacts: DeploymentArtifacts): DeploymentFile {
  const engine = dbServiceName(artifacts.architecture?.database?.engine);
  const isMysql = engine === 'mysql';
  const dbName = artifacts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'app';

  return {
    path: 'docker-compose.yml',
    language: 'yaml',
    content: `# Development compose — hot-reloadable services + a local database.
services:
  db:
    image: ${isMysql ? 'mysql:8' : 'postgres:16'}
    restart: unless-stopped
    environment:
${
  isMysql
    ? `      MYSQL_DATABASE: ${dbName}
      MYSQL_ROOT_PASSWORD: devpassword`
    : `      POSTGRES_DB: ${dbName}
      POSTGRES_PASSWORD: devpassword`
}
    ports:
      - '${isMysql ? '3306:3306' : '5432:5432'}'
    volumes:
      - db-data:/var/lib/${isMysql ? 'mysql' : 'postgresql/data'}
    healthcheck:
      test: ['CMD-SHELL', '${isMysql ? 'mysqladmin ping -h localhost' : 'pg_isready -U postgres'}']
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: development
      PORT: 4000
      DATABASE_URL: \${DATABASE_URL}
      JWT_SECRET: \${JWT_SECRET}
      CORS_ORIGINS: http://localhost:5173
    ports:
      - '4000:4000'

  frontend:
    build:
      context: ./frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - '5173:80'

volumes:
  db-data:
`,
  };
}

function composeProd(artifacts: DeploymentArtifacts): DeploymentFile {
  const engine = dbServiceName(artifacts.architecture?.database?.engine);
  const isMysql = engine === 'mysql';

  return {
    path: 'docker-compose.prod.yml',
    language: 'yaml',
    content: `# Production overlay — apply on top of docker-compose.yml:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# Assumes a managed database in production; the db service here is a
# fallback for self-hosted deployments and is omitted by default.
services:
  backend:
    restart: always
    environment:
      NODE_ENV: production
      LOG_LEVEL: info
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:4000/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'

  frontend:
    restart: always
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 128M
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:80']
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
${
  isMysql
    ? `
# db:
#   image: mysql:8
#   restart: always
#   deploy:
#     resources:
#       limits:
#         memory: 1G`
    : `
# db:
#   image: postgres:16
#   restart: always
#   deploy:
#     resources:
#       limits:
#         memory: 1G`
}
`,
  };
}

export function generateDockerBundle(artifacts: DeploymentArtifacts): DockerBundle {
  return {
    dockerignoreBackend: backendDockerignore(),
    dockerignoreFrontend: frontendDockerignore(),
    composeDev: composeDev(artifacts),
    composeProd: composeProd(artifacts),
  };
}
