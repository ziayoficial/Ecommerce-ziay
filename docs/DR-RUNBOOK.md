# Disaster Recovery Runbook

**Last updated:** Julio 2026
**RTO (Recovery Time Objective):** 4 hours
**RPO (Recovery Point Objective):** 24 hours (daily backup)

## Architecture

- **Primary DB:** PostgreSQL 16 (single instance)
- **App:** Next.js 16 standalone (Docker)
- **Socket.io:** chat-service on port 3003
- **Cache:** In-memory (no Redis in dev)
- **Backups:** Daily, local + offsite (S3-compatible)

## Recovery Procedures

### Database failure

1. **Detect:** `/api/health` returns 503, or Sentry alerts
2. **Assess:** Check PG container logs `docker logs ziay-postgres`
3. **Recover from backup:**
   ```bash
   # Stop app
   docker compose stop ziay
   # Restore latest backup
   ./scripts/backup-pg.sh restore latest
   # Verify
   docker compose exec postgres psql -U ziay -c "SELECT count(*) FROM \"Tenant\""
   # Restart
   docker compose up -d ziay
   ```
4. **Verify:** Health check passes, dashboard loads

### App failure

1. **Rollback:** `docker compose up -d --no-deps ziay:previous-tag`
2. **Verify:** Health check passes
3. **Investigate:** Check Sentry for the error that caused the crash

### Socket.io failure

1. Chat-service is non-critical (dashboard still works)
2. Restart: `docker compose restart chat-service`
3. Verify: `/health` on port 3003

### Full region failure

1. Provision new server
2. `git clone` + `docker compose pull`
3. Restore DB from offsite backup
4. Update DNS to new server
5. Verify end-to-end

## Backup Schedule

| What | Frequency | Retention | Location |
|------|-----------|-----------|----------|
| Database (pg_dump) | Daily 2AM | 30 days | Local + S3 |
| Uploads | Weekly | 90 days | S3 |
| Configs | On change | 90 days | Git |

## Testing

- **Monthly:** Restore backup to staging, verify row counts
- **Quarterly:** Full DR drill (provision new environment from backup)

## Contacts

- **On-call:** ops@ziay.co
- **DBA:** dba@ziay.co
- **Escalation:** +57 XXX XXX XXXX
