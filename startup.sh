#!/bin/sh
if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/api/health; then
  exit 0
fi
cd /workspace/edge-shipping
PORT=8080 node server.js >/tmp/edge-shipping.log 2>&1 &
