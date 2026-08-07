#!/usr/bin/env python3
"""
patch-task6.py — parallelize Loop Over Items.

The loop is embarrassingly parallel but batchSize was unset (= 1), so 19
opportunities were scraped and LLM-processed strictly sequentially.

Batching alone would CORRUPT the run: every in-loop Code node runs in
runOnceForAllItems mode while using `$json`, which is item[0] only. They are
correct today purely because each batch holds one item. Batching 5 wide would
silently drop 4 of every 5 opportunities.

So each in-loop Code node is converted to runOnceForEachItem — where `$json`
genuinely means "the current item", exactly the semantics the code already
assumes — and its top-level `return [{json: X}]` becomes `return {json: X}`.

Also fixes a latent bug: the playwright node reads
  $node["Loop Over Items"].json.url
which resolves to a single item and would send the same URL for every item in
a batch. It becomes $json.url.
"""

import json
import re

PATH = "workflows.json"
BATCH_SIZE = 5

# Nodes that execute inside Loop Over Items, once per opportunity.
IN_LOOP_NODES = [
    "Clean HTML",
    "Extract Main Content.",
    "guard node",
    "JSON Parse",
    "Parse + Rank Opportunities",
    "Standardize Opportunity",
    "Resume Match Engine",
]

# `return [ {...} ];`  ->  `return {...};`   (top-level single-item returns)
RETURN_ARRAY = re.compile(r"return\s*\[\s*(\{.*?\})\s*,?\s*\]\s*;", re.DOTALL)


def convert_returns(code):
    """Unwrap top-level single-item array returns. Returns (code, count)."""
    count = 0

    def repl(m):
        nonlocal count
        inner = m.group(1)
        # Only unwrap when the array holds exactly one object literal. A comma
        # at brace-depth 0 would mean multiple items, which must not be touched.
        depth = 0
        for ch in inner:
            if ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
        if depth != 0:
            return m.group(0)
        count += 1
        return f"return {inner};"

    return RETURN_ARRAY.sub(repl, code), count


def main():
    with open(PATH) as f:
        doc = json.load(f)
    wf = doc[0]
    by_name = {n["name"]: n for n in wf["nodes"]}

    # 1. Batch the loop.
    loop = by_name["Loop Over Items"]
    loop["parameters"]["batchSize"] = BATCH_SIZE
    loop["parameters"].setdefault("options", {})
    print(f"  Loop Over Items: batchSize -> {BATCH_SIZE}")

    # 2. Convert in-loop Code nodes to per-item execution.
    for name in IN_LOOP_NODES:
        node = by_name[name]
        node["parameters"]["mode"] = "runOnceForEachItem"
        code = node["parameters"]["jsCode"]
        new_code, n = convert_returns(code)
        node["parameters"]["jsCode"] = new_code
        note = f"{n} return(s) unwrapped" if n else "no array return (already per-item shaped)"
        print(f"  {name:30} mode=runOnceForEachItem, {note}")

    # 3. Fix the single-item URL reference in the playwright fallback.
    pw = by_name["playwright"]
    params = pw["parameters"]["bodyParameters"]["parameters"]
    for p in params:
        if p["name"] == "url":
            before = p["value"]
            p["value"] = "={{ $json.url }}"
            print(f"  playwright url: {before}  ->  {p['value']}")

    with open(PATH, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("\nOK")


if __name__ == "__main__":
    main()
