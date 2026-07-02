import os
import pickle
from functools import lru_cache

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

from core.ingest import DATA_DIR, CHROMA_DIR, BM25_PATH, CHUNKS_PATH


@lru_cache(maxsize=1)
def _get_model():
    return SentenceTransformer("BAAI/bge-small-en-v1.5")


def _load_indexes():
    client = chromadb.PersistentClient(path=CHROMA_DIR, settings=Settings(anonymized_telemetry=False))
    collection = client.get_collection(name="code_chunks")

    with open(BM25_PATH, "rb") as f:
        bm25 = pickle.load(f)

    with open(CHUNKS_PATH, "rb") as f:
        chunks = pickle.load(f)

    return collection, bm25, chunks


def reciprocal_rank_fusion(vector_ids, bm25_ids, k=60):
    scores = {}
    for rank, id_ in enumerate(vector_ids):
        scores[id_] = scores.get(id_, 0) + 1 / (rank + k)
    for rank, id_ in enumerate(bm25_ids):
        scores[id_] = scores.get(id_, 0) + 1 / (rank + k)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


def query(query_text, top_k=8):
    collection, bm25, chunks = _load_indexes()
    model = _get_model()

    query_embedding = model.encode(query_text).tolist()

    vector_results = collection.query(
        query_embeddings=[query_embedding],
        n_results=20,
    )

    vector_ids = [int(id_) for id_ in vector_results["ids"][0]]

    tokenized_query = query_text.split()
    bm25_scores = bm25.get_scores(tokenized_query)
    bm25_ids = sorted(range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True)[:20]

    fused = reciprocal_rank_fusion(vector_ids, bm25_ids)[:top_k]

    results = []
    for chunk_id, score in fused:
        chunk = chunks[chunk_id]
        results.append({
            "content": chunk["content"],
            "filepath": chunk["filepath"],
            "start_line": chunk["start_line"],
            "end_line": chunk["end_line"],
            "score": round(score, 4),
        })

    return results
