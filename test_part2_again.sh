#!/bin/bash

echo -e "\n=== PART 2: TEST AI-GATEWAY (ATTEMPT 3) ==="
(cd ai-gateway && npm run start > ../ai-gateway.log 2>&1) &
PID_AI=$!
sleep 3

echo -e "Running properly formatted curl to trigger build_profile LLM task..."
curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{
    "task": "build_profile",
    "input": "{\"text\": \"Senior Node.js developer with 5 years experience.\"}"
  }' > gateway-result-3.json
cat gateway-result-3.json
echo ""
sleep 2

echo -e "\n=== AI-GATEWAY LOG ==="
tail -n 50 ai-gateway.log

kill $PID_AI 2>/dev/null
wait $PID_AI 2>/dev/null || true
