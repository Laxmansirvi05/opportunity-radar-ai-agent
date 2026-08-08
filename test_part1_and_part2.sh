#!/bin/bash

# ================== PART 1 ==================
echo -e "=== PART 1: TEST RENDER-SERVICE ==="
(cd render-service && npm run start > ../render-service.log 2>&1) &
PID_RENDER=$!
sleep 5

curl -s -X POST http://localhost:3100/fetch \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{"url": "https://example.com"}' > render-result.json

cat render-result.json
echo ""

kill $PID_RENDER 2>/dev/null
wait $PID_RENDER 2>/dev/null || true

# ================== PART 2 ==================
echo -e "\n=== PART 2: TEST AI-GATEWAY ==="
(cd ai-gateway && npm run start > ../ai-gateway.log 2>&1) &
PID_AI=$!
sleep 3

echo "Running exact curl from prompt..."
curl -s -X POST http://localhost:4000/tasks/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{"taskType": "cip_extraction", "payload": {"text": "Senior Node.js developer with 5 years experience."}}'

echo -e "\n\nRunning properly formatted curl to trigger build_profile LLM task..."
curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{
    "task": "build_profile",
    "input": "Senior Node.js developer with 5 years experience."
  }'
echo ""
sleep 2

echo -e "\n=== AI-GATEWAY LOG ==="
tail -n 50 ai-gateway.log

kill $PID_AI 2>/dev/null
wait $PID_AI 2>/dev/null || true
