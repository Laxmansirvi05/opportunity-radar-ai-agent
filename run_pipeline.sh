#!/bin/bash
echo "Stopping existing services..."
pkill -f "node server.js" || true
pkill -f "node src/server.js" || true
pkill -f "npm run start" || true
sleep 1

echo "Ensuring DB/Redis is up..."
docker compose up -d

echo "Starting microservices..."
(cd ai-gateway && npm run start > ../ai-gateway.log 2>&1) &
PID_AI=$!
(cd profile-builder && npm run start > ../profile-builder.log 2>&1) &
PID_PB=$!
(cd render-service && npm run start > ../render-service.log 2>&1) &
PID_RS=$!
(cd search-planner && npm run start > ../search-planner.log 2>&1) &
PID_SP=$!

echo "Waiting for services to initialize (10 seconds)..."
sleep 10

echo "Importing n8n workflow..."
npx --yes n8n import:workflow --input=workflows.json

echo "Executing n8n workflow..."
npx --yes n8n execute --id "3bwLRC7IC0yDFog7" > pipeline_execution.json 2> pipeline_execution_error.log

echo "Execution complete. Cleaning up..."
kill -INT $PID_AI $PID_PB $PID_RS $PID_SP 2>/dev/null
wait $PID_AI $PID_PB $PID_RS $PID_SP 2>/dev/null || true

echo "Done. See pipeline_execution.json for output."
