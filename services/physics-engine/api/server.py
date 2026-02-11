"""
FastAPI server for Physics Engine Service
Provides VLM and Panel method aerodynamic calculations
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
import sys
import os
import logging
import math

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vlm.solver import VortexLatticeMethod, WingGeometry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Physics Engine API",
    description="Aerodynamic calculations using VLM and Panel methods",
    version="1.0.0"
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
class GeometryRequest(BaseModel):
    """Wing geometry parameters"""
    span: float = Field(..., gt=0, description="Wing span in meters")
    chord: float = Field(..., gt=0, description="Root chord in meters")
    twist: float = Field(0.0, description="Geometric twist in degrees")
    dihedral: float = Field(0.0, description="Dihedral angle in degrees")
    sweep: float = Field(0.0, description="Sweep angle in degrees")
    taper_ratio: float = Field(1.0, gt=0, le=1, description="Tip/root chord ratio")


class SimulationRequest(BaseModel):
    """VLM simulation request"""
    geometry: GeometryRequest
    velocity: float = Field(..., gt=0, description="Freestream velocity in m/s")
    alpha: float = Field(..., ge=-20, le=20, description="Angle of attack in degrees")
    yaw: float = Field(0.0, ge=-20, le=20, description="Yaw angle in degrees")
    rho: float = Field(1.225, gt=0, description="Air density in kg/m³")
    n_panels_x: int = Field(20, ge=5, le=100, description="Chordwise panels")
    n_panels_y: int = Field(10, ge=5, le=100, description="Spanwise panels")


class SweepRequest(BaseModel):
    """Alpha sweep request payload"""
    geometry: GeometryRequest
    velocity: float = Field(..., gt=0)
    alpha_start: float = Field(-10, ge=-20, le=20)
    alpha_end: float = Field(10, ge=-20, le=20)
    alpha_step: float = Field(1.0, gt=0, le=5)
    n_panels_x: int = Field(20, ge=5, le=100)
    n_panels_y: int = Field(10, ge=5, le=100)


class FlowFieldRequest(BaseModel):
    """Flow field visualization request"""
    mesh_id: str = Field("wing_v3.2", description="Mesh identifier")
    velocity: float = Field(..., gt=0, description="Freestream velocity in m/s")
    alpha: float = Field(..., ge=-20, le=20, description="Angle of attack in degrees")


class PanelSolveRequest(BaseModel):
    """Panel method visualization request"""
    mesh_id: str = Field("wing_v3.2", description="Mesh identifier")
    velocity: float = Field(..., gt=0, description="Freestream velocity in m/s")
    alpha: float = Field(..., ge=-20, le=20, description="Angle of attack in degrees")


class BatchSimulateRequest(BaseModel):
    """Batch VLM synthetic generation request"""
    n_samples: int = Field(100, ge=1, le=50000)
    speed_range: List[float] = Field(default_factory=lambda: [100.0, 300.0], min_items=2, max_items=2)
    yaw_range: List[float] = Field(default_factory=lambda: [0.0, 10.0], min_items=2, max_items=2)


class LatticeNodeResponse(BaseModel):
    """VLM panel node force/pressure response"""
    node_id: int = Field(..., description="Linear panel index")
    span_index: int = Field(..., description="Spanwise index")
    chord_index: int = Field(..., description="Chordwise index")
    position: List[float] = Field(..., description="Control point position [x,y,z]")
    gamma: float = Field(..., description="Panel circulation strength")
    cp: float = Field(..., description="Local pressure coefficient")
    lift: float = Field(..., description="Local lift force contribution [N]")
    drag: float = Field(..., description="Local drag force contribution [N]")
    side_force: float = Field(..., description="Local side force contribution [N]")
    force_vector: List[float] = Field(..., description="Force vector [Fx,Fy,Fz]")


class AeroResponse(BaseModel):
    """Aerodynamic results"""
    cl: float = Field(..., description="Lift coefficient")
    cd: float = Field(..., description="Drag coefficient")
    cm: float = Field(..., description="Moment coefficient")
    l_over_d: float = Field(..., description="Lift-to-drag ratio")
    lift: float = Field(..., description="Lift force in N")
    drag: float = Field(..., description="Drag force in N")
    side_force: float = Field(..., description="Side force in N")
    moment: float = Field(..., description="Pitching moment in N·m")
    pressure: List[float] = Field(..., description="Pressure coefficient distribution")
    gamma: List[float] = Field(..., description="Vortex circulation strength at each panel")
    lattice_nodes: List[LatticeNodeResponse] = Field(
        default_factory=list,
        description="Per-panel node metrics for drag/lift visualization"
    )
    n_panels: int = Field(..., description="Total number of panels")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str


# Global solver cache (for performance)
solver_cache = {}


@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint"""
    return {
        "service": "Physics Engine API",
        "version": "1.0.0",
        "status": "operational"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        service="physics-engine",
        version="1.0.0"
    )


@app.post("/vlm/solve", response_model=AeroResponse)
async def solve_vlm(request: SimulationRequest):
    """
    Solve aerodynamics using Vortex Lattice Method.
    
    This endpoint computes aerodynamic forces and moments for a given
    wing geometry and flow conditions using the VLM solver.
    
    Args:
        request: Simulation parameters including geometry and flow conditions
        
    Returns:
        Aerodynamic coefficients, forces, and pressure distribution
        
    Raises:
        HTTPException: If solver fails or invalid parameters
    """
    try:
        logger.info(f"VLM solve request: V={request.velocity}m/s, α={request.alpha}°")
        
        # Create geometry
        geometry = WingGeometry(
            span=request.geometry.span,
            chord=request.geometry.chord,
            twist=request.geometry.twist,
            dihedral=request.geometry.dihedral,
            sweep=request.geometry.sweep,
            taper_ratio=request.geometry.taper_ratio
        )
        
        # Initialize solver
        cache_key = f"{request.n_panels_x}x{request.n_panels_y}"
        if cache_key not in solver_cache:
            solver_cache[cache_key] = VortexLatticeMethod(
                n_panels_x=request.n_panels_x,
                n_panels_y=request.n_panels_y
            )
        
        vlm = solver_cache[cache_key]
        vlm.setup_geometry(geometry)
        
        # Solve
        result = vlm.solve(
            velocity=request.velocity,
            alpha=request.alpha,
            yaw=request.yaw,
            rho=request.rho
        )
        
        # Prepare response
        l_over_d = result.cl / result.cd if result.cd > 0 else 0

        lattice_nodes = []
        for idx in range(result.gamma.shape[0]):
            force_vec = result.panel_forces[idx]
            cp_position = result.control_points[idx]
            lattice_nodes.append({
                "node_id": int(idx),
                "span_index": int(idx // request.n_panels_x),
                "chord_index": int(idx % request.n_panels_x),
                "position": cp_position.tolist(),
                "gamma": float(result.gamma[idx]),
                "cp": float(result.pressure[idx]),
                "lift": float(force_vec[2]),
                "drag": float(-force_vec[0]),
                "side_force": float(force_vec[1]),
                "force_vector": force_vec.tolist(),
            })

        response = AeroResponse(
            cl=result.cl,
            cd=result.cd,
            cm=result.cm,
            l_over_d=l_over_d,
            lift=result.forces['lift'],
            drag=result.forces['drag'],
            side_force=result.forces['side'],
            moment=result.forces['moment'],
            pressure=result.pressure.tolist(),
            gamma=result.gamma.tolist(),
            lattice_nodes=lattice_nodes,
            n_panels=request.n_panels_x * request.n_panels_y
        )
        
        logger.info(f"VLM solution: CL={result.cl:.4f}, CD={result.cd:.4f}")
        
        return response
        
    except Exception as e:
        logger.error(f"VLM solver error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Solver error: {str(e)}")


@app.post("/vlm/sweep")
async def alpha_sweep(request: SweepRequest):
    """
    Perform angle of attack sweep.
    
    Computes aerodynamic coefficients for a range of angles of attack.
    Useful for generating lift curves and finding optimal operating points.
    
    Args:
        geometry: Wing geometry
        velocity: Freestream velocity
        alpha_start: Starting angle of attack
        alpha_end: Ending angle of attack
        alpha_step: Step size
        n_panels_x: Chordwise panels
        n_panels_y: Spanwise panels
        
    Returns:
        List of results for each angle of attack
    """
    try:
        import numpy as np
        
        alphas = np.arange(request.alpha_start, request.alpha_end + request.alpha_step, request.alpha_step)
        results = []
        
        # Create geometry
        geom = WingGeometry(
            span=request.geometry.span,
            chord=request.geometry.chord,
            twist=request.geometry.twist,
            dihedral=request.geometry.dihedral,
            sweep=request.geometry.sweep,
            taper_ratio=request.geometry.taper_ratio
        )
        
        # Initialize solver
        vlm = VortexLatticeMethod(n_panels_x=request.n_panels_x, n_panels_y=request.n_panels_y)
        vlm.setup_geometry(geom)
        
        # Sweep through angles
        for alpha in alphas:
            result = vlm.solve(velocity=request.velocity, alpha=float(alpha))
            
            results.append({
                'alpha': float(alpha),
                'cl': result.cl,
                'cd': result.cd,
                'cm': result.cm,
                'l_over_d': result.cl / result.cd if result.cd > 0 else 0
            })
        
        logger.info(f"Alpha sweep complete: {len(results)} points")
        
        return {
            'sweep_type': 'alpha',
            'n_points': len(results),
            'results': results
        }
        
    except Exception as e:
        logger.error(f"Alpha sweep error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Sweep error: {str(e)}")


@app.get("/vlm/validate")
async def validate_solver():
    """
    Validate VLM solver against known results.
    
    Tests the solver against NACA 0012 airfoil data at 5 degrees AoA.
    Expected CL ≈ 0.55 from experimental data.
    
    Returns:
        Validation results with error metrics
    """
    try:
        # NACA 0012 at 5 degrees
        geometry = WingGeometry(
            span=1.0,
            chord=0.2,
            twist=0.0,
            dihedral=0.0,
            sweep=0.0,
            taper_ratio=1.0
        )
        
        vlm = VortexLatticeMethod(n_panels_x=20, n_panels_y=10)
        vlm.setup_geometry(geometry)
        
        result = vlm.solve(velocity=50.0, alpha=5.0)
        
        # Expected values (from experimental data)
        expected_cl = 0.55
        expected_cd_range = (0.01, 0.05)
        
        # Compute errors
        cl_error = abs(result.cl - expected_cl) / expected_cl * 100
        cd_valid = expected_cd_range[0] <= result.cd <= expected_cd_range[1]
        
        validation = {
            'test': 'NACA 0012 at 5° AoA',
            'computed_cl': result.cl,
            'expected_cl': expected_cl,
            'cl_error_percent': cl_error,
            'computed_cd': result.cd,
            'cd_valid': cd_valid,
            'l_over_d': result.cl / result.cd,
            'passed': cl_error < 10 and cd_valid
        }
        
        logger.info(f"Validation: CL error = {cl_error:.2f}%")
        
        return validation
        
    except Exception as e:
        logger.error(f"Validation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Validation error: {str(e)}")


@app.post("/api/v1/flow-field")
async def flow_field(request: FlowFieldRequest):
    """
    Generate flow-field visualization payload compatible with frontend viewers.
    """
    try:
        vectors = []
        streamlines = []
        vortex_cores = []
        pressure_data = []

        velocity_scale = request.velocity / 70.0
        alpha_rad = math.radians(request.alpha)

        for i in range(10):
            for j in range(10):
                for k in range(4):
                    x = (i - 5) * 0.2
                    y = k * 0.12
                    z = (j - 5) * 0.12
                    radial = math.sqrt(x * x + z * z) + 1e-6
                    swirl = math.sin(radial * 2.8 + alpha_rad) * 0.08
                    vx = (1.0 + 0.18 * math.cos(radial + alpha_rad)) * velocity_scale
                    vy = swirl
                    vz = 0.03 + 0.05 * math.sin(x * 1.9)

                    vectors.append({
                        "position": [round(x, 5), round(y, 5), round(z, 5)],
                        "velocity": [round(vx, 5), round(vy, 5), round(vz, 5)],
                    })

                    pressure = -0.5 * (vx * vx + vy * vy + vz * vz)
                    pressure_data.append({
                        "position": [round(x, 5), round(y, 5), round(z, 5)],
                        "value": round(pressure, 6),
                    })

        for line_idx in range(8):
            y = (line_idx - 3.5) * 0.16
            points = []
            for step in range(55):
                x = -1.2 + step * 0.05
                z = 0.08 * math.sin((x + y) * 2.7 + alpha_rad)
                points.append([round(y, 5), round(z, 5), round(x, 5)])
            streamlines.append({"points": points})

        vortex_cores.append({
            "position": [0.0, 0.07, 0.12],
            "radius": 0.085,
            "strength": round(1.4 + abs(alpha_rad) * 0.6, 4),
        })
        vortex_cores.append({
            "position": [0.0, 0.05, 0.68],
            "radius": 0.055,
            "strength": round(0.8 + abs(alpha_rad) * 0.2, 4),
        })

        magnitudes = [
            math.sqrt(v["velocity"][0] ** 2 + v["velocity"][1] ** 2 + v["velocity"][2] ** 2)
            for v in vectors
        ]
        pressure_values = [p["value"] for p in pressure_data]

        return {
            "mesh_id": request.mesh_id,
            "vectors": vectors,
            "streamlines": streamlines,
            "vortexCores": vortex_cores,
            "pressureData": pressure_data,
            "statistics": {
                "maxVelocity": round(max(magnitudes), 5),
                "minPressure": round(min(pressure_values), 6),
                "maxVorticity": round(max(core["strength"] for core in vortex_cores) * 1.8, 5),
                "turbulenceIntensity": round(0.12 + min(0.14, abs(alpha_rad) * 0.4), 5),
            },
        }
    except Exception as exc:
        logger.error(f"Flow-field generation error: {exc}")
        raise HTTPException(status_code=500, detail=f"Flow-field generation error: {exc}")


@app.post("/api/v1/panel-solve")
async def panel_solve(request: PanelSolveRequest):
    """
    Generate panel-method compatible visualization payload.
    """
    try:
        n_span = 18
        n_chord = 14
        alpha_rad = math.radians(request.alpha)
        velocity_scale = request.velocity / 70.0

        panels = []
        source_strength = []
        streamlines = []

        for i in range(n_span):
            for j in range(n_chord):
                y = (i - n_span / 2) * 0.1
                x1 = j * 0.055
                x2 = (j + 1) * 0.055
                camber = 0.02 * math.sin(j / max(n_chord - 1, 1) * math.pi)

                panels.append({
                    "vertices": [
                        [round(y, 5), round(camber, 5), round(x1, 5)],
                        [round(y + 0.1, 5), round(camber, 5), round(x1, 5)],
                        [round(y + 0.1, 5), round(camber, 5), round(x2, 5)],
                    ],
                    "indices": [0, 1, 2],
                })
                panels.append({
                    "vertices": [
                        [round(y, 5), round(camber, 5), round(x1, 5)],
                        [round(y + 0.1, 5), round(camber, 5), round(x2, 5)],
                        [round(y, 5), round(camber, 5), round(x2, 5)],
                    ],
                    "indices": [0, 1, 2],
                })

                strength = math.exp(-j / 4.8) * (1 + 0.2 * math.sin(alpha_rad)) * velocity_scale
                source_strength.append(round(strength, 6))
                source_strength.append(round(strength, 6))

        for idx in range(16):
            y = (idx - 8) * 0.14
            points = []
            for step in range(32):
                x = -0.25 + step * 0.045
                z = 0.08 + math.sin(x * 5 + alpha_rad) * 0.025
                points.append([round(y, 5), round(z, 5), round(x, 5)])
            streamlines.append({"points": points})

        cl = round(2.1 + 0.075 * request.alpha + 0.08 * velocity_scale, 5)
        cd = round(max(0.03, 0.32 + 0.012 * abs(request.alpha) + 0.02 * velocity_scale), 5)
        cm = round(-0.11 - 0.008 * request.alpha, 5)

        return {
            "mesh_id": request.mesh_id,
            "panels": panels,
            "sourceStrength": source_strength,
            "streamlines": streamlines,
            "coefficients": {
                "Cl": cl,
                "Cd": cd,
                "Cm": cm,
            },
            "pressureCoefficients": [round(-2.0 * value, 6) for value in source_strength],
        }
    except Exception as exc:
        logger.error(f"Panel-solve generation error: {exc}")
        raise HTTPException(status_code=500, detail=f"Panel-solve generation error: {exc}")


@app.post("/api/vlm/batch-simulate")
async def batch_simulate(request: BatchSimulateRequest):
    """
    Generate synthetic batch VLM-like samples for dataset pipelines.
    """
    try:
        v_min = min(request.speed_range[0], request.speed_range[1])
        v_max = max(request.speed_range[0], request.speed_range[1])
        yaw_min = min(request.yaw_range[0], request.yaw_range[1])
        yaw_max = max(request.yaw_range[0], request.yaw_range[1])

        sample_preview = []
        preview_count = min(request.n_samples, 25)
        for idx in range(preview_count):
            progress = idx / max(preview_count - 1, 1)
            speed = v_min + (v_max - v_min) * progress
            yaw = yaw_min + (yaw_max - yaw_min) * ((idx * 7) % preview_count) / max(preview_count - 1, 1)
            cl = 1.85 + 0.0045 * speed - 0.022 * abs(yaw)
            cd = 0.18 + 0.0014 * speed + 0.008 * abs(yaw)

            sample_preview.append({
                "sample_id": idx + 1,
                "speed_kmh": round(speed, 4),
                "yaw_deg": round(yaw, 4),
                "cl": round(cl, 6),
                "cd": round(cd, 6),
                "l_over_d": round(cl / max(cd, 1e-6), 6),
            })

        avg_cl = sum(item["cl"] for item in sample_preview) / max(len(sample_preview), 1)
        avg_cd = sum(item["cd"] for item in sample_preview) / max(len(sample_preview), 1)

        return {
            "status": "completed",
            "n_samples": request.n_samples,
            "speed_range": [v_min, v_max],
            "yaw_range": [yaw_min, yaw_max],
            "summary": {
                "avg_cl_preview": round(avg_cl, 6),
                "avg_cd_preview": round(avg_cd, 6),
                "avg_l_over_d_preview": round(avg_cl / max(avg_cd, 1e-6), 6),
            },
            "samples_preview": sample_preview,
        }
    except Exception as exc:
        logger.error(f"Batch simulation error: {exc}")
        raise HTTPException(status_code=500, detail=f"Batch simulation error: {exc}")


if __name__ == "__main__":
    import uvicorn
    
    # Run server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        log_level="info"
    )
