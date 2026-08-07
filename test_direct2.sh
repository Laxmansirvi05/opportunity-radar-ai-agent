#!/bin/bash

echo "=== STARTING AI-GATEWAY ==="
(cd ai-gateway && npm run start > ../ai-gateway-direct2.log 2>&1) &
PID_AI=$!
sleep 2

echo -e "\n=== 5. TEST AI-GATEWAY DIRECTLY ==="
curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: 7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1" \
  -d '{
    "task": "build_profile",
    "input": "{\"name\": \"Test User\"}"
  }' > gateway-direct2.json
cat gateway-direct2.json

kill $PID_AI 2>/dev/null
wait $PID_AI 2>/dev/null || true
echo -e "\nAll tests finished."
