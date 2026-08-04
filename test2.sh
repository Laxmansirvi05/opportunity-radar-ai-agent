#!/bin/bash
echo "Test 9: Search Planner missing inferred"
# Need a valid candidate ID from earlier or just a mock one.
CANDIDATE_ID=$(uuidgen)
PAYLOAD=$(python3 -c "import json; print(json.dumps({'candidateId': '$CANDIDATE_ID', 'cip': {'meta': {'schemaVersion': '2.0.0'}, 'literal': {}}}))")
curl -s -X POST http://localhost:4200/search-plan/build -H "Content-Type: application/json" -d "$PAYLOAD"

echo -e "\n\nTest 10: Not open to relocation"
# First we need to mock the LLM to return this? No, we just submit a resume and see what the Gateway inferred.
# The prompt says "A resume whose text explicitly says something like 'on-site only in Austin, TX, not open to relocation'".
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{
  "name": "Tex",
  "email": "tex@ex.com",
  "skills": ["JavaScript"],
  "projects": [{"description": "on-site only in Austin, TX, not open to relocation"}]
}' > out10.json
cat out10.json

# Now send the cip to search planner
CIP=$(cat out10.json | jq '.cip')
ID=$(cat out10.json | jq -r '.candidateId')
if [ "$CIP" != "null" ]; then
  echo -e "\n\nSending to search-planner:"
  PAYLOAD_SP=$(jq -n --arg id "$ID" --argjson cip "$CIP" '{candidateId: $id, cip: $cip}')
  curl -s -X POST http://localhost:4200/search-plan/build -H "Content-Type: application/json" -d "$PAYLOAD_SP"
else
  echo -e "\n\nFailed to get CIP from PB"
fi
