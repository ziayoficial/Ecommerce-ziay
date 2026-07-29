#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "server.js" > /dev/null 2>&1; then
    echo "[$(date)] Starting server..." >> /home/z/my-project/keepalive.log
    cd /home/z/my-project/.next/standalone
    node server.js >> /home/z/my-project/dev.log 2>&1 &
    sleep 8
    if curl -s -o /dev/null http://localhost:3000/ 2>/dev/null; then
      echo "[$(date)] Server UP" >> /home/z/my-project/keepalive.log
    fi
    cd /home/z/my-project
  fi
  sleep 10
done
