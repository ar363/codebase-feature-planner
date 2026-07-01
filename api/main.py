from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from core.models import IngestRequest, IngestResponse, PlanRequest, PlanResponse
from core.ingest import ingest
from core.agent import generate_plan

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


@app.post("/plan", response_model=PlanResponse)
def plan_endpoint(req: PlanRequest):
    try:
        plan = generate_plan(req.feature_request, req.codebase_path)
        return PlanResponse(plan=plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
