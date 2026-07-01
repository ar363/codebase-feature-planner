from pydantic import BaseModel


class IngestRequest(BaseModel):
    path: str


class IngestResponse(BaseModel):
    status: str
    chunks_indexed: int


class PlanRequest(BaseModel):
    feature_request: str
    codebase_path: str


class PlanResponse(BaseModel):
    plan: str
