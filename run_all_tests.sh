#!/bin/bash
pkill -f "node server.js" || true
pkill -f "node src/server.js" || true
pkill -f "npm run start" || true
sleep 1

echo "Starting services..."
cd ai-gateway
npm run start > ../gateway.log 2>&1 &
PID_AI=$!
cd ../profile-builder
npm run start > ../builder.log 2>&1 &
PID_PB=$!
cd ..
sleep 4 # wait for them to start

echo -e "\n=== 1. AI Gateway Direct Test ==="
curl -s -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${GATEWAY_API_KEY}" \
  -d '{"task": "build_profile", "input": "{\"text\": \"Senior Node.js developer with 5 years experience.\"}"}' > out1.json
cat out1.json
echo ""

echo -e "\n=== 2. Profile Builder - Test 10 (Austin TX) ==="
curl -s -X POST http://localhost:4100/profile/build \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Tex",
  "email": "tex@ex.com",
  "skills": ["JavaScript"],
  "projects": [{"description": "on-site only in Austin, TX, not open to relocation"}]
}' > out2.json
cat out2.json
echo ""

echo -e "\n=== 3. Profile Builder - test.sh (all 8 tests) ==="
chmod +x test.sh
./test.sh > test_sh_output.txt 2>&1
cat test_sh_output.txt

echo -e "\nCleaning up..."
kill -INT $PID_AI $PID_PB 2>/dev/null
wait $PID_AI $PID_PB 2>/dev/null || true
