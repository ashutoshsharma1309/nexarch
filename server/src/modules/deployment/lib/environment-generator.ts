/**
 * Environment templates. Variable names match exactly what the generated
 * backend already reads (`backend-generator/lib/emit-project-files.ts`'s
 * `.env.example`: NODE_ENV, PORT, LOG_LEVEL, DATABASE_URL, CORS_ORIGINS,
 * JWT_SECRET) plus the frontend's `VITE_API_BASE_URL` escape hatch — this
 * module documents and validates that contract, it doesn't invent a new one.
 */
import type { DeploymentArtifacts, EnvironmentBundle, EnvVarRule } from '../deployment.types.js';

function rules(): EnvVarRule[] {
  return [
    {
      name: 'NODE_ENV',
      required: true,
      secret: false,
      description: 'Runtime mode — development, production, or test.',
      example: 'production',
    },
    {
      name: 'PORT',
      required: true,
      secret: false,
      description: 'Port the backend HTTP server listens on.',
      example: '4000',
    },
    {
      name: 'LOG_LEVEL',
      required: false,
      secret: false,
      description: 'Winston log level — error, warn, info, http, or debug.',
      example: 'info',
    },
    {
      name: 'DATABASE_URL',
      required: true,
      secret: true,
      description: 'Prisma connection string for the primary database.',
      example: 'mysql://user:password@host:3306/database',
    },
    {
      name: 'CORS_ORIGINS',
      required: true,
      secret: false,
      description: 'Comma-separated list of origins allowed to call the API.',
      example: 'https://app.example.com',
    },
    {
      name: 'JWT_SECRET',
      required: true,
      secret: true,
      description: 'Signing secret for access/refresh tokens (Security Engine).',
      example: 'a long random string — never reuse the placeholder',
    },
    {
      name: 'VITE_API_BASE_URL',
      required: false,
      secret: false,
      description: 'Frontend build-time override for the API base URL, for split deployments.',
      example: 'https://api.example.com/api/v1',
    },
  ];
}

function renderEnvFile(values: Record<string, string>, comment: string): string {
  const lines = [comment, ''];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');
  return lines.join('\n');
}

function envExample(): { path: string; content: string } {
  return {
    path: '.env.example',
    content: renderEnvFile(
      {
        NODE_ENV: 'development',
        PORT: '4000',
        LOG_LEVEL: 'debug',
        DATABASE_URL: '"mysql://user:password@localhost:3306/database"',
        CORS_ORIGINS: 'http://localhost:5173',
        JWT_SECRET: 'change-me-in-production-please',
        VITE_API_BASE_URL: '',
      },
      '# Copy to .env and fill in real values. Never commit the filled-in file.',
    ),
  };
}

function envDevelopment(artifacts: DeploymentArtifacts): { path: string; content: string } {
  const dbName = artifacts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'app';
  return {
    path: '.env.development',
    content: renderEnvFile(
      {
        NODE_ENV: 'development',
        PORT: '4000',
        LOG_LEVEL: 'debug',
        DATABASE_URL: `"mysql://root:devpassword@localhost:3306/${dbName}"`,
        CORS_ORIGINS: 'http://localhost:5173',
        JWT_SECRET: 'dev-only-secret-not-for-production',
      },
      '# Local development defaults — matches docker-compose.yml.',
    ),
  };
}

function envProduction(): { path: string; content: string } {
  return {
    path: '.env.production',
    content: renderEnvFile(
      {
        NODE_ENV: 'production',
        PORT: '4000',
        LOG_LEVEL: 'info',
        DATABASE_URL: '__SET_IN_DEPLOYMENT_TARGET_SECRETS__',
        CORS_ORIGINS: '__SET_TO_YOUR_PRODUCTION_DOMAIN__',
        JWT_SECRET: '__SET_IN_DEPLOYMENT_TARGET_SECRETS__',
      },
      "# Placeholders only — production secrets belong in your deployment\n# target's secret store (GitHub Actions secrets, platform env vars), never\n# committed to the repository.",
    ),
  };
}

function docs(rulesList: EnvVarRule[]): { path: string; content: string } {
  const lines = [
    '# Environment variables',
    '',
    '| Variable | Required | Secret | Description |',
    '| --- | --- | --- | --- |',
    ...rulesList.map(
      (rule) =>
        `| \`${rule.name}\` | ${rule.required ? 'yes' : 'no'} | ${rule.secret ? 'yes' : 'no'} | ${rule.description} |`,
    ),
    '',
    '## Setting secrets',
    '',
    '- **Local development**: copy `.env.example` to `.env`.',
    '- **CI/CD**: store secret values as GitHub Actions repository secrets and reference them as `${{ secrets.NAME }}` in workflows.',
    "- **Hosting platforms**: set them through the platform's environment variable UI (Vercel/Netlify/Render/Railway project settings) or infrastructure-as-code for cloud targets.",
    '',
  ];
  return { path: 'ENVIRONMENT.md', content: lines.join('\n') };
}

export function generateEnvironmentBundle(artifacts: DeploymentArtifacts): EnvironmentBundle {
  const validationRules = rules();
  const example = envExample();
  const development = envDevelopment(artifacts);
  const production = envProduction();
  const doc = docs(validationRules);

  return {
    envExample: { ...example, language: 'env' },
    envDevelopment: { ...development, language: 'env' },
    envProduction: { ...production, language: 'env' },
    validationRules,
    docs: { ...doc, language: 'markdown' },
  };
}
