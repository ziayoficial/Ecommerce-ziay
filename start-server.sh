#!/bin/bash
# ZIAY server starter — loads .env and starts standalone server
cd /home/z/my-project

# Load .env
set -a
source .env 2>/dev/null || true
set +a

# Start standalone server
exec node .next/standalone/server.js
