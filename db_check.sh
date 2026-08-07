#!/bin/bash

export PGHOST=/tmp
export PGPORT=5432
export PGDATABASE=opportunity_radar
export PGUSER=laxmansirvi

echo "=== ALL TABLES ==="
psql -c "\dt"

echo -e "\n=== ROW COUNTS & SAMPLE DATA ==="
tables=("candidates" "candidate_intelligence_profiles" "search_plans")

for table in "${tables[@]}"; do
  echo "--- Table: $table ---"
  psql -c "SELECT COUNT(*) FROM $table;" || true
  psql -x -c "SELECT * FROM $table ORDER BY created_at DESC LIMIT 1;" || true
done
