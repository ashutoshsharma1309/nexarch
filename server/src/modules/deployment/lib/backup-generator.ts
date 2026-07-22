/**
 * Backup/restore/disaster-recovery documentation. Documentation only, per
 * spec — no backup automation code (that belongs to the database provider
 * or a scheduled job outside this generated project's scope).
 */
import type { BackupDocs, DeploymentArtifacts } from '../deployment.types.js';

export function generateBackupDocs(artifacts: DeploymentArtifacts): BackupDocs {
  const isMysql = !(artifacts.architecture?.database?.engine ?? '')
    .toLowerCase()
    .includes('postgres');
  const dumpCmd = isMysql
    ? 'mysqldump -h $DB_HOST -u $DB_USER -p $DB_NAME | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz'
    : 'pg_dump -h $DB_HOST -U $DB_USER $DB_NAME | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz';
  const restoreCmd = isMysql
    ? 'gunzip -c backup-FILE.sql.gz | mysql -h $DB_HOST -u $DB_USER -p $DB_NAME'
    : 'gunzip -c backup-FILE.sql.gz | psql -h $DB_HOST -U $DB_USER $DB_NAME';

  const markdown = `# Backup & Disaster Recovery — ${artifacts.projectName}

## Database backup

\`\`\`bash
${dumpCmd}
\`\`\`

Run on a schedule (cron, GitHub Actions scheduled workflow, or your
managed database provider's built-in snapshots) and ship the archive to
object storage (S3, GCS, or equivalent) — never leave the only copy on
the same host as the database.

**Recommended cadence**: daily full backup, retained 30 days; hourly
incremental if the provider supports it and the data changes fast enough
to justify it.

## Restore procedure

1. Provision a fresh database instance (or a scratch instance for a dry run first).
2. Restore the archive:

   \`\`\`bash
   ${restoreCmd}
   \`\`\`

3. Point \`DATABASE_URL\` at the restored instance and run \`npx prisma migrate deploy\` to confirm the schema is current.
4. Smoke-test \`GET /health\` and a handful of read endpoints before cutting traffic over.

## Disaster recovery

- **RPO (Recovery Point Objective)**: bounded by backup frequency — daily backups mean up to 24h of data loss in the worst case. Tighten this with more frequent backups or database-native point-in-time recovery if the provider supports it.
- **RTO (Recovery Time Objective)**: time to provision a new instance + restore + redeploy the app pointing at it. Rehearse this at least once — an untested restore procedure is not a restore procedure.
- **Multi-region**: for targets that support it (AWS RDS, Cloud SQL, managed Postgres/MySQL), enable cross-region read replicas or automated snapshots to a second region.
- **Application state**: this app is stateless aside from the database — recovering the database and redeploying the container images (already tagged and stored per \`.github/workflows/deploy.yml\`) is sufficient to restore full service.
`;

  return { markdown };
}
