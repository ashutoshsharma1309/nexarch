/**
 * `docker-compose.yml` + a run README for the bundled export. Combines the
 * backend/frontend build contexts Phases 5-6 already emit (each generated
 * project ships its own Dockerfile); this only orchestrates the two of them
 * plus a database service, it does not re-generate the Dockerfiles.
 */
import type { ProjectArtifacts } from '../workspace.types.js';

export function generateDockerCompose(artifacts: ProjectArtifacts): string {
  const dbEngine = artifacts.architecture?.database.engine.toLowerCase() ?? 'mysql';
  const isMysql = dbEngine.includes('mysql');

  return `services:
  db:
    image: ${isMysql ? 'mysql:8' : 'postgres:16'}
    restart: unless-stopped
    environment:
${
  isMysql
    ? `      MYSQL_DATABASE: ${artifacts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}
      MYSQL_ROOT_PASSWORD: change-me`
    : `      POSTGRES_DB: ${artifacts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}
      POSTGRES_PASSWORD: change-me`
}
    ports:
      - '${isMysql ? '3306:3306' : '5432:5432'}'
    volumes:
      - db-data:${isMysql ? '/var/lib/mysql' : '/var/lib/postgresql/data'}

  backend:
    build: ./backend
    restart: unless-stopped
    depends_on:
      - db
    environment:
      DATABASE_URL: \${DATABASE_URL}
      JWT_SECRET: \${JWT_SECRET}
      PORT: 4000
    ports:
      - '4000:4000'

  frontend:
    build: ./frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - '5173:80'

volumes:
  db-data:
`;
}

export function generateDockerReadme(artifacts: ProjectArtifacts): string {
  return `# ${artifacts.projectName} — Docker package

## Run

\`\`\`bash
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
docker compose up --build
\`\`\`

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

## Services

- **db** — the project's database
- **backend** — the generated API server, built from \`./backend\`
- **frontend** — the generated client, built from \`./frontend\`
`;
}
