#!/bin/bash
# ZIAY server starter — loads env vars and starts standalone server
cd /home/z/my-project

# Load env vars manually (source .env doesn't work with file: URLs)
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="ziay-dev-secret-key-2026-change-in-production"

# Start standalone server
exec node .next/standalone/server.js
