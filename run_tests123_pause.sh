#!/bin/bash
pkill -f "node server.js" || true
pkill -f "npm run start" || true
pkill -f "node src/index.js" || true
sleep 1

cd ai-gateway
npm run start > ../gateway.log 2>&1 &
PID_GW=$!
cd ../profile-builder
npm run start > ../builder.log 2>&1 &
PID_PB=$!
cd ..
sleep 5

echo "Test 1: Empty object"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{}'

echo -e "\n\nSleeping for 8 seconds..."
sleep 8

echo "Test 2: Resume with only name and email"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John Doe", "email": "john@example.com"}'

echo -e "\n\nSleeping for 8 seconds..."
sleep 8

echo "Test 3: experience: []"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John", "email": "j@ex.com", "experience": []}'

echo -e "\n"
kill -INT $PID_GW $PID_PB 2>/dev/null
