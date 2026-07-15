#!/bin/bash
# Watchdog: mantiene el dev server de Next.js vivo
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date)] Server down — restarting..." >> /home/z/my-project/watchdog.log
    pkill -f "next dev" 2>/dev/null
    sleep 2
    NODE_OPTIONS='--max-old-space-size=2048' node node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev.log 2>&1 &
    SERVER_PID=$!
    echo "[$(date)] Started PID $SERVER_PID" >> /home/z/my-project/watchdog.log
    sleep 15
    if curl -s -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
      echo "[$(date)] Server UP (PID $SERVER_PID)" >> /home/z/my-project/watchdog.log
    else
      echo "[$(date)] Server failed to start" >> /home/z/my-project/watchdog.log
    fi
  fi
  sleep 20
done
