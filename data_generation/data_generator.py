"""
Synthetic CFD Data Generator
Generate training data for AeroTransformer and GNN-RANS models
"""

import os
import numpy as np
import pandas as pd

# Try to import CuPy — fallback to NumPy
try:
    import cupy as cp
    xp = cp
    GPU_ENABLED = True
    print("✅ CuPy detected — GPU acceleration enabled")
except:
    xp = np
    GPU_ENABLED = False
    print("⚠️ CuPy not found — CPU (NumPy) mode enabled")


# ============================================================
# CFD GEOMETRY GENERATOR
# ============================================================
def generate_geometry(grid_size: int = 64):
    """
    Generates simple synthetic 3D geometry.
    Returns dictionary with geometry fields.
    """

    x = xp.linspace(-1, 1, grid_size)
    y = xp.linspace(-1, 1, grid_size)
    z = xp.linspace(0, 1, grid_size)

    X, Y, Z = xp.meshgrid(x, y, z, indexing="ij")

    # Example simple wing-like function
    thickness = 0.15 * xp.exp(-((X ** 2) * 2))
    camber = 0.05 * xp.sin(xp.pi * X)

    geometry = {
        "x": X,
        "y": Y,
        "z": Z,
        "thickness": thickness,
        "camber": camber
    }
    return geometry


# ============================================================
# CFD FLOW FIELD GENERATOR
# ============================================================
def generate_flow_field(grid_size: int = 64):
    """
    Generates synthetic pressure, velocity & turbulence fields.
    """

    # Create coordinate grid
    x = xp.linspace(-1, 1, grid_size)
    y = xp.linspace(-1, 1, grid_size)
    z = xp.linspace(0, 1, grid_size)
    X, Y, Z = xp.meshgrid(x, y, z, indexing="ij")

    # Simplified synthetic aerodynamic flow
    pressure = 1 - 0.5 * xp.exp(-(X**2 + Y**2))
    u = 1 + 0.2 * xp.sin(xp.pi * X)
    v = 0.1 * xp.cos(xp.pi * Y)
    w = 0.05 * xp.sin(2 * xp.pi * Z)

    # Turbulence fields
    k = 0.01 + 0.005 * xp.random.randn(*X.shape)
    omega = 0.1 + 0.05 * xp.random.randn(*X.shape)
    nut = 0.001 + 0.0005 * xp.random.randn(*X.shape)

    return {
        "pressure": pressure,
        "u": u,
        "v": v,
        "w": w,
        "k": k,
        "omega": omega,
        "nut": nut
    }


# ============================================================
# SAFE CONVERSION (CuPy → NumPy)
# ============================================================
def to_numpy(arr):
    """Convert CuPy or NumPy array to NumPy safely."""
    if GPU_ENABLED:
        return cp.asnumpy(arr)
    return arr


# ============================================================
# SAVE PARQUET
# ============================================================
def save_parquet(sample: dict, output_path: str):
    """
    Saves the 3D CFD sample into a flattened Parquet file.
    """
    flat_data = {}

    for key, arr in sample.items():
        np_arr = to_numpy(arr)
        flat_data[key] = np_arr.reshape(-1)

    df = pd.DataFrame(flat_data)
    df.to_parquet(output_path, index=False)
    print(f"💾 Saved dataset: {output_path}")


# ============================================================
# MAIN GENERATOR
# ============================================================
def generate_sample(grid_size: int = 64):
    """Generates a full synthetic CFD sample."""
    print("🔧 Generating synthetic CFD sample...")

    geometry = generate_geometry(grid_size)
    flow = generate_flow_field(grid_size)

    return {**geometry, **flow}


# ============================================================
# EXECUTION
# ============================================================
if __name__ == "__main__":

    # NEW PATH (requested by you)
    OUTPUT_DIR = "/Users/Ruben_MACPRO/Desktop/F1 Project NexGen/data/training-datasets"
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    GRID = 64

    # Generate and save a sample
    sample = generate_sample(grid_size=GRID)

    output_file = os.path.join(
        OUTPUT_DIR,
        f"synthetic_cfd_{GRID}.parquet"
    )

    save_parquet(sample, output_file)

    print("\n✅ CFD dataset generation complete!")
    print(f"📁 Directory: {OUTPUT_DIR}")


