#!/bin/bash
# Keeps the Next dev server alive: if port 3000 stops answering, restart it.
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --max-time 4 http://localhost:3000/; then
    echo "[$(date '+%H:%M:%S')] dev server down — restarting" >> .zscripts/keepalive.log
    bun run dev >> dev.log 2>&1
  fi
  sleep 5
done
