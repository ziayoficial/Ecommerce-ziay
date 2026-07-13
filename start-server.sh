#!/bin/bash
cd /home/z/my-project
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="ziay-prod-secret-change-with-openssl-rand-base64-32"
export ENCRYPTION_KEY="ziay-encryption-key-change-with-openssl-rand-hex-32"
exec node .next/standalone/server.js
