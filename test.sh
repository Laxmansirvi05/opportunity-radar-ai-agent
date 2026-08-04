#!/bin/bash
echo "Test 1: Empty object"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{}'

echo -e "\n\nTest 2: Resume with only name and email"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John Doe", "email": "john@example.com"}'

echo -e "\n\nTest 3: experience: []"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John", "email": "j@ex.com", "experience": []}'

echo -e "\n\nTest 4: experience: null"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John", "email": "j@ex.com", "experience": null}'

echo -e "\n\nTest 5: No clear seniority signal"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{
  "name": "Jane", "email": "j2@ex.com",
  "experience": [{ "title": "Consultant", "startDate": "2020-01", "endDate": "2020-09" }]
}'

echo -e "\n\nTest 6: 25+ jobs and 100+ skills"
# Generate 30 jobs and 120 skills
JOBS=$(python3 -c 'import json; print(json.dumps([{"title": f"Job {i}", "company": f"Comp {i}"} for i in range(30)]))')
SKILLS=$(python3 -c 'import json; print(json.dumps([f"Skill {i}" for i in range(120)]))')
PAYLOAD=$(python3 -c "import json; print(json.dumps({'name':'Mega', 'email':'mega@ex.com', 'experience': $JOBS, 'skills': $SKILLS}))")
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d "$PAYLOAD"

echo -e "\n\nTest 7: Duplicate submission"
# Submit once, then again
PAYLOAD_DUP='{"name":"Dup", "email":"dup@ex.com", "experience": []}'
echo "Call 1:"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d "$PAYLOAD_DUP"
echo -e "\nCall 2:"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d "$PAYLOAD_DUP"

echo -e "\n\nTest 8: Malformed JSON body"
curl -s -X POST http://localhost:4100/profile/build -H "Content-Type: application/json" -d '{"name": "John"'

