import os
import json
import uuid
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_data")
HISTORY_PATH = os.path.join(DATA_DIR, "history.json")

def _load_history():
    if not os.path.exists(HISTORY_PATH):
        return {"workspaces": [], "plans": []}
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"workspaces": [], "plans": []}

def _save_history(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(HISTORY_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def add_workspace(path: str):
    if not path:
        return
    data = _load_history()
    # Normalize path formatting
    norm_path = os.path.normpath(path)
    if norm_path not in data["workspaces"]:
        data["workspaces"].append(norm_path)
        _save_history(data)

def delete_workspace(path: str):
    data = _load_history()
    norm_path = os.path.normpath(path)
    if norm_path in data["workspaces"]:
        data["workspaces"].remove(norm_path)
        _save_history(data)

def add_plan(codebase_path: str, feature_request: str, plan_content: str, events: list):
    data = _load_history()
    
    if codebase_path:
        norm_path = os.path.normpath(codebase_path)
        if norm_path not in data["workspaces"]:
            data["workspaces"].append(norm_path)
            
    plan_id = str(uuid.uuid4())
    new_plan = {
        "id": plan_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "codebase_path": os.path.normpath(codebase_path) if codebase_path else "",
        "feature_request": feature_request,
        "plan": plan_content,
        "events": events
    }
    
    data["plans"].insert(0, new_plan)
    _save_history(data)
    return plan_id

def get_history_summary():
    data = _load_history()
    plans_summary = []
    for p in data["plans"]:
        plans_summary.append({
            "id": p["id"],
            "timestamp": p["timestamp"],
            "codebase_path": p["codebase_path"],
            "feature_request": p["feature_request"]
        })
    return {
        "workspaces": data["workspaces"],
        "plans": plans_summary
    }

def get_plan_detail(plan_id: str):
    data = _load_history()
    for p in data["plans"]:
        if p["id"] == plan_id:
            return p
    return None

def delete_plan(plan_id: str):
    data = _load_history()
    original_len = len(data["plans"])
    data["plans"] = [p for p in data["plans"] if p["id"] != plan_id]
    if len(data["plans"]) < original_len:
        _save_history(data)
        return True
    return False
