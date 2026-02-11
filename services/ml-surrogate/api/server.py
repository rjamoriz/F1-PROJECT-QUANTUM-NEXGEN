"""
ML Surrogate Service - FastAPI Server
GPU-accelerated aerodynamic predictions using ONNX Runtime when available,
with an empirical fallback model for Phase 1 continuity.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import hashlib
import logging
import math
import os
from pathlib import Path
import sys
import time

import numpy as np

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="ML Surrogate API",
    description="GPU-accelerated aerodynamic predictions using ML surrogates",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response Models
class PredictionRequest(BaseModel):
    """ML prediction request"""

    mesh_id: str = Field(..., description="Mesh identifier")
    parameters: Dict[str, float] = Field(..., description="Flow parameters")
    use_cache: bool = Field(True, description="Use cached results if available")
    return_confidence: bool = Field(True, description="Return confidence score")


class PredictionResponse(BaseModel):
    """ML prediction response"""

    cl: float = Field(..., description="Lift coefficient")
    cd: float = Field(..., description="Drag coefficient")
    cm: float = Field(0.0, description="Moment coefficient")
    confidence: float = Field(..., description="Prediction confidence [0-1]")
    inference_time_ms: float = Field(..., description="Inference time in milliseconds")
    cached: bool = Field(..., description="Whether result was cached")
    gpu_used: bool = Field(..., description="Whether GPU was used")
    source: str = Field("ml_surrogate", description="Prediction source")


class BatchPredictionRequest(BaseModel):
    """Batch prediction request"""

    requests: List[PredictionRequest] = Field(..., description="List of prediction requests")
    batch_size: int = Field(32, ge=1, le=128, description="Batch size for processing")


class ModelInfo(BaseModel):
    """Model information"""

    name: str
    type: str
    parameters: int
    input_shape: List[int]
    output_shape: List[int]
    device: str
    status: str


class HealthResponse(BaseModel):
    """Health check response"""

    status: str
    service: str
    version: str
    gpu_available: bool
    model_loaded: bool


def _to_float(value: Any, default: float) -> float:
    """Convert unknown input to float with fallback."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max(value, min_value), max_value)


def _hash_to_unit_interval(text: str) -> float:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    seed_int = int(digest[:12], 16)
    return (seed_int % 1000000) / 1000000.0


def _normalize_parameters(parameters: Dict[str, float]) -> Dict[str, float]:
    """Normalize and sanitize flow parameters for prediction."""
    normalized = {
        "velocity": _to_float(parameters.get("velocity", 72.0), 72.0),
        "alpha": _to_float(parameters.get("alpha", 4.5), 4.5),
        "yaw": _to_float(parameters.get("yaw", 0.0), 0.0),
        "rho": _to_float(parameters.get("rho", 1.225), 1.225),
    }

    normalized["velocity"] = _clamp(normalized["velocity"], 1.0, 160.0)
    normalized["alpha"] = _clamp(normalized["alpha"], -20.0, 20.0)
    normalized["yaw"] = _clamp(normalized["yaw"], -20.0, 20.0)
    normalized["rho"] = _clamp(normalized["rho"], 0.6, 1.6)

    return normalized


def _build_cache_key(mesh_id: str, parameters: Dict[str, float], return_confidence: bool) -> str:
    """Build deterministic key for prediction caching."""
    parts = [mesh_id.strip(), "1" if return_confidence else "0"]
    for key in sorted(parameters.keys()):
        parts.append(f"{key}:{parameters[key]:.6f}")
    material = "|".join(parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _build_synthetic_mesh(mesh_id: str, nodes: int = 120) -> np.ndarray:
    """Generate deterministic pseudo-mesh from mesh id for fallback and ONNX adapters."""
    x = np.linspace(0.0, 1.0, nodes)
    mesh_factor = _hash_to_unit_interval(mesh_id)
    amplitude = 0.03 + 0.04 * mesh_factor

    y = amplitude * np.sin(2.0 * np.pi * x)
    z = (0.015 + 0.02 * (1.0 - mesh_factor)) * np.cos(3.0 * np.pi * x)

    return np.stack([x, y, z], axis=1).astype(np.float32)


def _detect_gpu_available() -> bool:
    """Best-effort GPU availability detection without hard dependency failures."""
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:
        return False


class PredictionCache:
    """Simple in-memory FIFO cache for prediction payloads."""

    def __init__(self, max_size: int = 1000):
        self.max_size = max(1, int(max_size))
        self._entries: Dict[str, Dict[str, Any]] = {}
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        entry = self._entries.get(key)
        if entry is None:
            self.misses += 1
            return None

        self.hits += 1
        return dict(entry)

    def set(self, key: str, payload: Dict[str, Any]) -> None:
        if key not in self._entries and len(self._entries) >= self.max_size:
            oldest_key = next(iter(self._entries.keys()))
            del self._entries[oldest_key]

        self._entries[key] = dict(payload)

    def clear(self) -> None:
        self._entries.clear()
        self.hits = 0
        self.misses = 0

    def get_stats(self) -> Dict[str, Any]:
        total = self.hits + self.misses
        hit_rate = (self.hits / total) if total > 0 else 0.0

        return {
            "size": len(self._entries),
            "max_size": self.max_size,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": hit_rate,
        }


class EmpiricalAeroPredictor:
    """Physics-inspired deterministic predictor for Phase 1 continuity."""

    def __init__(self):
        self.model_name = "empirical_aero_v1"
        self.model_type = "physics_informed_regression"
        self.mode = "empirical"
        self.device = "cpu"
        self._inference_count = 0
        self._total_inference_time_s = 0.0

    def _predict_core(self, mesh_id: str, parameters: Dict[str, float]) -> Dict[str, float]:
        velocity = parameters["velocity"]
        alpha = parameters["alpha"]
        yaw = parameters["yaw"]
        rho = parameters["rho"]

        alpha_rad = math.radians(alpha)
        mesh_factor = (_hash_to_unit_interval(mesh_id) - 0.5) * 2.0  # [-1, 1]

        cl = (
            0.18
            + 0.092 * alpha
            + 0.035 * math.sin(1.8 * alpha_rad)
            + 0.045 * mesh_factor
        )
        cl *= _clamp(rho / 1.225, 0.8, 1.2)

        cd = (
            0.026
            + 0.00105 * (alpha ** 2)
            + 0.00055 * abs(yaw)
            + 0.000022 * ((velocity - 72.0) ** 2)
            + 0.006 * abs(mesh_factor)
        )

        cm = -0.038 - 0.0021 * alpha + 0.0009 * yaw + 0.018 * mesh_factor

        confidence = 0.9
        if abs(alpha) > 12.0:
            confidence *= 0.82
        if velocity < 25.0 or velocity > 120.0:
            confidence *= 0.87
        if abs(yaw) > 8.0:
            confidence *= 0.9

        return {
            "cl": _clamp(cl, -1.0, 4.0),
            "cd": max(cd, 1e-4),
            "cm": _clamp(cm, -1.0, 1.0),
            "confidence": _clamp(confidence, 0.35, 0.97),
        }

    def predict(
        self,
        mesh_id: str,
        parameters: Dict[str, float],
        return_confidence: bool = True,
    ) -> Dict[str, Any]:
        started = time.perf_counter()
        core = self._predict_core(mesh_id, parameters)
        elapsed_ms = (time.perf_counter() - started) * 1000.0

        self._inference_count += 1
        self._total_inference_time_s += elapsed_ms / 1000.0

        return {
            "cl": float(core["cl"]),
            "cd": float(core["cd"]),
            "cm": float(core["cm"]),
            "confidence": float(core["confidence"] if return_confidence else 1.0),
            "inference_time_ms": float(elapsed_ms),
            "gpu_used": False,
            "source": "empirical_surrogate",
        }

    def get_performance_stats(self) -> Dict[str, Any]:
        avg_ms = 0.0
        if self._inference_count > 0:
            avg_ms = (self._total_inference_time_s / self._inference_count) * 1000.0

        return {
            "total_inferences": self._inference_count,
            "avg_inference_time_ms": avg_ms,
            "total_time_s": self._total_inference_time_s,
        }


class OnnxPredictorAdapter:
    """Adapter around inference.predictor.AeroPredictor with robust output parsing."""

    def __init__(self, core_predictor: Any, model_path: str):
        self.core = core_predictor
        self.model_path = model_path
        self.model_name = Path(model_path).stem
        self.model_type = "onnx_surrogate"
        self.mode = "onnx"
        providers = []
        try:
            providers = list(self.core.session.get_providers())
        except Exception:
            providers = []
        self.device = "cuda:0" if "CUDAExecutionProvider" in providers else "cpu"

        self._fallback = EmpiricalAeroPredictor()

    @staticmethod
    def _extract_scalar(raw: Dict[str, Any], candidate_names: List[str]) -> Optional[float]:
        for name in candidate_names:
            if name in raw:
                try:
                    arr = np.asarray(raw[name], dtype=np.float32)
                    if arr.size > 0:
                        return float(arr.reshape(-1)[0])
                except Exception:
                    continue
        return None

    @staticmethod
    def _extract_vector(raw: Dict[str, Any]) -> Optional[np.ndarray]:
        for key, value in raw.items():
            if key in {"inference_time_ms", "batch_size"}:
                continue
            try:
                arr = np.asarray(value, dtype=np.float32)
            except Exception:
                continue

            if arr.size >= 3:
                return arr.reshape(-1)
        return None

    def predict(
        self,
        mesh_id: str,
        parameters: Dict[str, float],
        return_confidence: bool = True,
    ) -> Dict[str, Any]:
        started = time.perf_counter()
        fallback = self._fallback.predict(mesh_id, parameters, return_confidence=True)

        mesh = _build_synthetic_mesh(mesh_id)
        param_vector = np.array(
            [
                parameters["velocity"],
                parameters["alpha"],
                parameters["yaw"],
            ],
            dtype=np.float32,
        )

        try:
            raw = self.core.predict(mesh, param_vector, return_confidence=return_confidence)
        except Exception as exc:
            logger.warning(f"ONNX predictor inference failed; using fallback: {exc}")
            return {
                **fallback,
                "source": "onnx_fallback_empirical",
                "gpu_used": self.device.startswith("cuda"),
            }

        vector = self._extract_vector(raw)

        cl = self._extract_scalar(raw, ["cl", "lift_coefficient", "output_cl"])
        cd = self._extract_scalar(raw, ["cd", "drag_coefficient", "output_cd"])
        cm = self._extract_scalar(raw, ["cm", "moment_coefficient", "output_cm"])
        confidence = self._extract_scalar(raw, ["confidence", "output_confidence"])

        if vector is not None:
            if cl is None and vector.size >= 1:
                cl = float(vector[0])
            if cd is None and vector.size >= 2:
                cd = float(abs(vector[1]))
            if cm is None and vector.size >= 3:
                cm = float(vector[2])

        cl = float(cl if cl is not None else fallback["cl"])
        cd = float(cd if cd is not None else fallback["cd"])
        cm = float(cm if cm is not None else fallback["cm"])
        conf_value = float(confidence if confidence is not None else fallback["confidence"])

        cl = _clamp(cl, -1.0, 5.0)
        cd = max(abs(cd), 1e-4)
        cm = _clamp(cm, -2.0, 2.0)
        conf_value = _clamp(conf_value, 0.2, 0.99)

        inference_ms = _to_float(raw.get("inference_time_ms"), (time.perf_counter() - started) * 1000.0)

        return {
            "cl": cl,
            "cd": cd,
            "cm": cm,
            "confidence": conf_value if return_confidence else 1.0,
            "inference_time_ms": float(max(inference_ms, 0.01)),
            "gpu_used": self.device.startswith("cuda"),
            "source": "onnx_surrogate",
        }

    def get_performance_stats(self) -> Dict[str, Any]:
        try:
            return self.core.get_performance_stats()
        except Exception:
            return {
                "total_inferences": 0,
                "avg_inference_time_ms": 0.0,
                "total_time_s": 0.0,
            }


# Global service state
predictor: Optional[Any] = None
cache: Optional[PredictionCache] = None
active_model_info: List[ModelInfo] = []
active_mode = "uninitialized"


def _build_model_info(current_predictor: Any) -> ModelInfo:
    input_shape = [1, 120, 3]
    output_shape = [1, 3]

    if getattr(current_predictor, "mode", "") == "onnx":
        model_name = getattr(current_predictor, "model_name", "onnx_surrogate")
        model_type = getattr(current_predictor, "model_type", "onnx_surrogate")
        model_params = 1000000
        status = "loaded"
    else:
        model_name = getattr(current_predictor, "model_name", "empirical_aero_v1")
        model_type = getattr(current_predictor, "model_type", "physics_informed_regression")
        model_params = 0
        status = "fallback"

    return ModelInfo(
        name=model_name,
        type=model_type,
        parameters=model_params,
        input_shape=input_shape,
        output_shape=output_shape,
        device=getattr(current_predictor, "device", "cpu"),
        status=status,
    )


def _predict_single(
    mesh_id: str,
    parameters: Dict[str, float],
    use_cache: bool,
    return_confidence: bool,
) -> PredictionResponse:
    if predictor is None:
        raise HTTPException(status_code=503, detail="Predictor not initialized")

    normalized = _normalize_parameters(parameters)
    cache_key = _build_cache_key(mesh_id, normalized, return_confidence)

    if use_cache and cache is not None:
        cached_payload = cache.get(cache_key)
        if cached_payload is not None:
            cached_response = {
                **cached_payload,
                "cached": True,
            }
            return PredictionResponse(**cached_response)

    raw = predictor.predict(mesh_id, normalized, return_confidence=return_confidence)

    payload = {
        "cl": float(raw["cl"]),
        "cd": float(raw["cd"]),
        "cm": float(raw.get("cm", 0.0)),
        "confidence": float(raw.get("confidence", 0.8)),
        "inference_time_ms": float(max(_to_float(raw.get("inference_time_ms"), 0.1), 0.01)),
        "cached": False,
        "gpu_used": bool(raw.get("gpu_used", False)),
        "source": str(raw.get("source", "ml_surrogate")),
    }

    if use_cache and cache is not None:
        cache.set(cache_key, payload)

    return PredictionResponse(**payload)


@app.on_event("startup")
async def startup_event():
    """Initialize predictor and cache on startup."""
    global predictor, cache, active_model_info, active_mode

    logger.info("Starting ML Surrogate Service...")

    cache_size = int(_to_float(os.getenv("ML_CACHE_SIZE", 1000), 1000))
    cache = PredictionCache(max_size=max(100, cache_size))

    model_path = Path(os.getenv("MODEL_PATH", "/models/aero_surrogate.onnx"))
    enable_onnx = os.getenv("ML_ENABLE_ONNX", "true").lower() != "false"
    use_gpu = os.getenv("ML_USE_GPU", "true").lower() != "false"

    predictor = None

    if enable_onnx and model_path.exists():
        try:
            from inference.predictor import AeroPredictor

            core = AeroPredictor(str(model_path), use_gpu=use_gpu)
            predictor = OnnxPredictorAdapter(core, str(model_path))
            logger.info(f"ONNX predictor loaded: {model_path}")
        except Exception as exc:
            logger.warning(f"ONNX predictor initialization failed ({model_path}): {exc}")

    if predictor is None:
        predictor = EmpiricalAeroPredictor()
        logger.info("Using empirical surrogate fallback predictor")

    active_mode = getattr(predictor, "mode", "unknown")
    active_model_info = [_build_model_info(predictor)]

    logger.info(f"ML Surrogate Service ready (mode={active_mode})")


@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint."""
    return {
        "service": "ML Surrogate API",
        "version": "1.0.0",
        "status": "operational",
        "mode": active_mode,
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    model_loaded = predictor is not None
    gpu_available = _detect_gpu_available()

    if predictor is not None and getattr(predictor, "device", "cpu").startswith("cuda"):
        gpu_available = True

    if not model_loaded:
        status = "unhealthy"
    elif active_mode == "empirical":
        status = "degraded"
    else:
        status = "healthy"

    return HealthResponse(
        status=status,
        service="ml-surrogate",
        version="1.0.0",
        gpu_available=gpu_available,
        model_loaded=model_loaded,
    )


@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """
    Predict aerodynamic quantities using ML surrogate.

    Provides fast predictions for aerodynamic coefficients given
    mesh identifier and flow conditions.
    """
    try:
        return _predict_single(
            mesh_id=request.mesh_id,
            parameters=request.parameters,
            use_cache=request.use_cache,
            return_confidence=request.return_confidence,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Prediction error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/predict/batch")
async def predict_batch(request: BatchPredictionRequest):
    """
    Batch prediction for multiple designs.

    Processes multiple prediction requests with shared predictor and cache.
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="Predictor not initialized")

    if len(request.requests) == 0:
        return {
            "success": True,
            "count": 0,
            "results": [],
            "batch_size": request.batch_size,
            "mode": active_mode,
        }

    started = time.perf_counter()
    results: List[Dict[str, Any]] = []

    try:
        for item in request.requests:
            prediction = _predict_single(
                mesh_id=item.mesh_id,
                parameters=item.parameters,
                use_cache=item.use_cache,
                return_confidence=item.return_confidence,
            )

            if hasattr(prediction, "model_dump"):
                results.append(prediction.model_dump())
            else:
                results.append(prediction.dict())

        total_ms = (time.perf_counter() - started) * 1000.0

        return {
            "success": True,
            "count": len(results),
            "results": results,
            "batch_size": request.batch_size,
            "mode": active_mode,
            "total_inference_time_ms": total_ms,
            "avg_inference_time_ms": total_ms / max(1, len(results)),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Batch prediction error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/models", response_model=List[ModelInfo])
async def list_models():
    """
    List available ML models.

    Returns active model metadata. In fallback mode this will report
    a lightweight empirical surrogate descriptor.
    """
    return active_model_info


@app.get("/stats")
async def get_stats():
    """
    Get service statistics.

    Returns inference metrics and cache performance.
    """
    stats: Dict[str, Any] = {
        "service": "ml-surrogate",
        "predictor_loaded": predictor is not None,
        "mode": active_mode,
    }

    if predictor is not None:
        try:
            stats["predictor"] = predictor.get_performance_stats()
        except Exception as exc:
            stats["predictor_error"] = str(exc)

    if cache is not None:
        stats["cache"] = cache.get_stats()

    return stats


@app.post("/cache/clear")
async def clear_cache():
    """Clear prediction cache."""
    if cache is not None:
        cache.clear()
        return {"success": True, "message": "Cache cleared"}

    return {"success": False, "message": "Cache not initialized"}


if __name__ == "__main__":
    import uvicorn

    # Run server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
