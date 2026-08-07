#!/bin/bash

echo "=== STARTING SERVICES ==="

(cd ai-gateway && npm run start > ../ai-gateway-direct.log 2>&1) &
PID_AI=$!
(cd render-service && npm run start > ../render-direct.log 2>&1) &
PID_RENDER=$!
(cd search-planner && npm run start > ../search-planner-direct.log 2>&1) &
PID_SEARCH=$!

sleep 6

echo -e "\n=== 5. TEST AI-GATEWAY DIRECTLY ==="
curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: 7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1" \
  -d '{
    "type": "task",
    "taskName": "build_profile",
    "payload": "{\"name\": \"Test User\"}"
  }'

echo -e "\n\n=== 6. TEST RENDER-SERVICE DIRECTLY ==="
curl -s -X POST http://localhost:3000/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

echo -e "\n\n=== 4. TEST SEARCH-PLANNER DIRECTLY ==="
curl -s -X POST http://localhost:4200/search-plan/build \
  -H "Content-Type: application/json" \
  -d '{
    "candidateId": "b0a6da9b-1111-2222-3333-444455556666",
    "cip": {
      "meta": { "schemaVersion": "2.0.0" },
      "literal": {},
      "careerDirection": { "targetRoles": ["Developer"], "stage": "mid", "dealBreakers": [], "relocation": false },
      "extractedSkills": { "core": ["JS"], "secondary": [], "domain": [] },
      "locationContext": { "current": "NY", "preferences": [] }
    }
  }'

# Cleanup processes
kill $PID_AI $PID_RENDER $PID_SEARCH 2>/dev/null
wait $PID_AI $PID_RENDER $PID_SEARCH 2>/dev/null || true
echo -e "\nAll tests finished, services killed."
