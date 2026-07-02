import json
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.models import IngestRequest, IngestResponse, PlanRequest, PlanResponse, BrowseRequest, BrowseResponse
from core.ingest import ingest
from core.agent import stream_plan, generate_plan
from core.retrieve import _get_model as _warmup_model
from core import history as hist

app = FastAPI(title="Codebase Feature Planner")


@app.on_event("startup")
def warmup():
    """Pre-load the embedding model so the first query/ingest isn't slow."""
    try:
        _warmup_model()
    except Exception:
        pass  # model not available yet (e.g. first download deferred)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Ingest ─────────────────────────────────────────────────────────────────────

@app.post("/ingest", response_model=IngestResponse)
def ingest_endpoint(req: IngestRequest):
    try:
        count = ingest(req.path)
        hist.add_workspace(req.path)
        return IngestResponse(status="ok", chunks_indexed=count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Browse ─────────────────────────────────────────────────────────────────────

@app.post("/browse", response_model=BrowseResponse)
def browse_endpoint(req: BrowseRequest):
    path = req.path
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")
    try:
        names = sorted(os.listdir(path))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    entries = []
    for name in names:
        full = os.path.join(path, name)
        if os.path.isdir(full):
            entries.append({"name": name, "is_dir": True, "path": full})
    return BrowseResponse(entries=entries)


# ── Plan ───────────────────────────────────────────────────────────────────────

@app.post("/plan", response_model=PlanResponse)
def plan_endpoint(req: PlanRequest):
    try:
        plan = generate_plan(req.feature_request, req.codebase_path)
        hist.add_plan(req.codebase_path, req.feature_request, plan, [])
        return PlanResponse(plan=plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/plan/stream")
def plan_stream_endpoint(req: PlanRequest):
    def event_stream():
        collected_events = []
        final_plan = ""

        for event in stream_plan(req.feature_request, req.codebase_path):
            et = event["type"]
            # Track events for history (exclude raw chunk streams to keep it light)
            if et in ("thought", "tool_call", "tool_result", "error"):
                collected_events.append(event)
            elif et in ("plan_chunk", "done") and event.get("data"):
                final_plan = event["data"]

            yield f"event: {et}\ndata: {json.dumps(event['data'])}\n\n"

        # Persist to history after streaming completes
        if final_plan:
            hist.add_plan(req.codebase_path, req.feature_request, final_plan, collected_events)

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── History ────────────────────────────────────────────────────────────────────

class WorkspaceRequest(BaseModel):
    path: str


@app.get("/history")
def get_history():
    return hist.get_history_summary()


@app.post("/history/workspace")
def add_workspace(req: WorkspaceRequest):
    if not req.path.strip():
        raise HTTPException(status_code=400, detail="Path cannot be empty")
    hist.add_workspace(req.path)
    return {"status": "ok"}


@app.delete("/history/workspace")
def delete_workspace(path: str = Query(..., description="Workspace path to remove")):
    hist.delete_workspace(path)
    return {"status": "ok"}


@app.get("/history/plan/{plan_id}")
def get_plan(plan_id: str):
    plan = hist.get_plan_detail(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@app.delete("/history/plan/{plan_id}")
def delete_plan(plan_id: str):
    deleted = hist.delete_plan(plan_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "ok"}
