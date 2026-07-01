import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from core.models import IngestRequest, IngestResponse, PlanRequest, PlanResponse, BrowseRequest, BrowseResponse
from core.ingest import ingest
from core.agent import stream_plan, generate_plan

app = FastAPI(title="Codebase Feature Planner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ingest", response_model=IngestResponse)
def ingest_endpoint(req: IngestRequest):
    try:
        count = ingest(req.path)
        return IngestResponse(status="ok", chunks_indexed=count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@app.post("/plan", response_model=PlanResponse)
def plan_endpoint(req: PlanRequest):
    try:
        plan = generate_plan(req.feature_request, req.codebase_path)
        return PlanResponse(plan=plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/plan/stream")
def plan_stream_endpoint(req: PlanRequest):
    def event_stream():
        for event in stream_plan(req.feature_request, req.codebase_path):
            yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
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
