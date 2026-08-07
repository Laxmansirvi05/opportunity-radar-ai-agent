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

echo -e "\n=== Test 6: 25+ jobs and 100+ skills ==="
JOBS=$(python3 -c 'import json; print(json.dumps([{"title": f"Job {i}", "company": f"Comp {i}"} for i in range(30)]))')
SKILLS=$(python3 -c 'import json; print(json.dumps([f"Skill {i}" for i in range(120)]))')
PAYLOAD=$(python3 -c "import json; print(json.dumps({'name':'Mega', 'email':'mega@ex.com', 'experience': $JOBS, 'skills': $SKILLS}))")
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d "$PAYLOAD"
echo ""

echo -e "\nCleaning up..."
kill -INT $PID_AI $PID_PB 2>/dev/null
wait $PID_AI $PID_PB 2>/dev/null || true
