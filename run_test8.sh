#!/bin/bash
pkill -f "node server.js" || true
pkill -f "node src/server.js" || true
pkill -f "npm run start" || true
sleep 1

echo "Starting services..."
cd profile-builder
npm run start > ../builder.log 2>&1 &
PID_PB=$!
cd ..
sleep 4 # wait for them to start

echo -e "\n=== Test 8: Malformed JSON body ==="
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John"'
echo ""

echo -e "\nCleaning up..."
kill -INT $PID_PB 2>/dev/null
wait $PID_PB 2>/dev/null || true
