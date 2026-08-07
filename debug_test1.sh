#!/bin/bash
pkill -f "node server.js" || true
pkill -f "npm run start" || true
sleep 1

cd ai-gateway
node server.js > debug_gateway.log 2>&1 &
PID=$!
sleep 2

curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{"task": "build_profile", "input": "{\"text\": \"Senior Node.js developer with 5 years experience.\"}"}' > ../out_debug.json
cat ../out_debug.json
echo ""

sleep 2
kill -INT $PID
sleep 1
cat debug_gateway.log
