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

echo -e "\n=== 2. Profile Builder - Test 10 (Austin TX) ==="
curl -s -X POST http://localhost:4100/profile/build \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Tex",
  "email": "tex@ex.com",
  "skills": ["JavaScript"],
  "projects": [{"name": "Relocation rules test", "description": "on-site only in Austin, TX, not open to relocation"}]
}' > out2.json
cat out2.json
echo ""

echo -e "\nCleaning up..."
kill -INT $PID_AI $PID_PB 2>/dev/null
wait $PID_AI $PID_PB 2>/dev/null || true
