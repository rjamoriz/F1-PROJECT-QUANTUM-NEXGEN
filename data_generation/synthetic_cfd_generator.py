"""
Synthetic CFD Data Generator
Generate training data for AeroTransformer and GNN-RANS models
"""


import numpy as np
import h5py
import os
from typing import Tuple, Dict, Any
from tqdm import tqdm
import json


class SyntheticCFDGenerator:
    """
    Generate synthetic CFD data for training ML models
    
    Simulates:
    - 3D wing geometries
    - Pressure fields
    - Velocity fields
    - Turbulence quantities
    """
    
    def __init__(
        self,
        volume_size: Tuple[int, int, int] = (64, 64, 64),
        output_dir: str = 'data/cfd_dataset'
    ):
        self.volume_size = volume_size
        self.output_dir = output_dir
        
        # Create directories
        os.makedirs(os.path.join(output_dir, 'train'), exist_ok=True)
        os.makedirs(os.path.join(output_dir, 'val'), exist_ok=True)
        os.makedirs(os.path.join(output_dir, 'test'), exist_ok=True)
    
    def generate_wing_geometry(
        self,
        chord: float = 1.0,
        span: float = 2.0,
        thickness: float = 0.12,
        camber: float = 0.04,
        angle_of_attack: float = 5.0
    ) -> np.ndarray:
        """
        Generate 3D wing geometry (NACA-like airfoil)
        
        Returns:
            (3, D, H, W) - Geometry field [x, y, z coordinates]
        """
        D, H, W = self.volume_size
        geometry = np.zeros((3, D, H, W), dtype=np.float32)
        
        # Create coordinate grid
        x = np.linspace(-1, 1, D)
        y = np.linspace(-1, 1, H)
        z = np.linspace(0, span, W)
        
        X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
        
        # Store coordinates
        geometry[0] = X
        geometry[1] = Y
        geometry[2] = Z
        
        # Create wing shape (simplified NACA airfoil)
        for i in range(D):
            for j in range(H):
                for k in range(W):
                    x_pos = X[i, j, k]
                    y_pos = Y[i, j, k]
                    
                    # Airfoil profile
                    if 0 <= x_pos <= chord:
                        # Upper surface
                        y_upper = thickness * (0.2969 * np.sqrt(x_pos) - 
                                             0.1260 * x_pos - 
                                             0.3516 * x_pos**2 + 
                                             0.2843 * x_pos**3 - 
                                             0.1015 * x_pos**4)
                        
                        # Add camber
                        y_camber = camber * (2 * x_pos - x_pos**2)
                        
                        # Check if point is inside wing
                        if abs(y_pos - y_camber) < y_upper:
                            # Mark as solid (set to special value)
                            geometry[1, i, j, k] = y_camber
        
        return geometry
    
    def generate_flow_field(
        self,
        geometry: np.ndarray,
        reynolds: float = 1e6,
        mach: float = 0.3,
        angle_of_attack: float = 5.0
    ) -> np.ndarray:
        """
        Generate synthetic flow field around geometry
        
        Returns:
            (7, D, H, W) - Flow fields [p, u, v, w, k, omega, nut]
        """
        D, H, W = self.volume_size
        flow_field = np.zeros((7, D, H, W), dtype=np.float32)
        
        # Freestream conditions
        U_inf = 1.0
        rho = 1.225
        
        # Convert angle to radians
        alpha = np.radians(angle_of_attack)
        
        # Generate base flow
        for i in range(D):
            for j in range(H):
                for k in range(W):
                    x = geometry[0, i, j, k]
                    y = geometry[1, i, j, k]
                    z = geometry[2, i, j, k]
                    
                    # Distance from wing
                    dist = np.sqrt(x**2 + y**2)
                    
                    # Pressure (Bernoulli-like)
                    flow_field[0, i, j, k] = 1.0 - 0.5 * (1 - np.exp(-dist))
                    
                    # Velocity u (streamwise)
                    flow_field[1, i, j, k] = U_inf * np.cos(alpha) * (1 + 0.2 * np.sin(x * np.pi))
                    
                    # Velocity v (vertical)
                    flow_field[2, i, j, k] = U_inf * np.sin(alpha) * np.exp(-dist)
                    
                    # Velocity w (spanwise)
                    flow_field[3, i, j, k] = 0.05 * np.sin(z * np.pi / 2)
                    
                    # Turbulent kinetic energy
                    flow_field[4, i, j, k] = 0.01 * (1 + 0.5 * np.random.randn())
                    
                    # Specific dissipation rate
                    flow_field[5, i, j, k] = 0.1 * (1 + 0.5 * np.random.randn())
                    
                    # Turbulent viscosity
                    flow_field[6, i, j, k] = 0.001 * (1 + 0.5 * np.random.randn())
        
        return flow_field
    
    def generate_case(
        self,
        case_id: int,
        split: str = 'train'
    ) -> Dict[str, Any]:
        """
        Generate a single CFD case
        
        Returns:
            Dictionary with geometry and flow fields
        """
        # Random parameters
        chord = 0.8 + np.random.rand() * 0.4
        span = 1.5 + np.random.rand() * 1.0
        thickness = 0.08 + np.random.rand() * 0.08
        camber = 0.02 + np.random.rand() * 0.04
        angle_of_attack = -5 + np.random.rand() * 20
        reynolds = 5e5 + np.random.rand() * 1e6
        mach = 0.2 + np.random.rand() * 0.2
        
        # Generate geometry
        geometry = self.generate_wing_geometry(
            chord, span, thickness, camber, angle_of_attack
        )
        
        # Generate flow field
        flow_field = self.generate_flow_field(
            geometry, reynolds, mach, angle_of_attack
        )
        
        # Compute aerodynamic coefficients (simplified)
        cl = 0.1 * angle_of_attack + camber * 10 + np.random.randn() * 0.05
        cd = 0.01 + 0.001 * angle_of_attack**2 + np.random.randn() * 0.002
        cm = -0.1 * camber + np.random.randn() * 0.01
        
        return {
            'case_id': case_id,
            'geometry': geometry,
            'flow_field': flow_field,
            'parameters': {
                'chord': chord,
                'span': span,
                'thickness': thickness,
                'camber': camber,
                'angle_of_attack': angle_of_attack,
                'reynolds': reynolds,
                'mach': mach
            },
            'coefficients': {
                'cl': cl,
                'cd': cd,
                'cm': cm
            }
        }
    
    def generate_dataset(
        self,
        num_train: int = 10000,
        num_val: int = 2000,
        num_test: int = 1000
    ):
        """
        Generate complete dataset
        """
        print("=" * 60)
        print("Generating Synthetic CFD Dataset")
        print("=" * 60)
        print(f"Training samples: {num_train}")
        print(f"Validation samples: {num_val}")
        print(f"Test samples: {num_test}")
        print(f"Volume size: {self.volume_size}")
        print("=" * 60)
        
        # Generate training data
        print("\nGenerating training data...")
        for i in tqdm(range(num_train)):
            case = self.generate_case(i, 'train')
            self._save_case(case, 'train')
        
        # Generate validation data
        print("\nGenerating validation data...")
        for i in tqdm(range(num_val)):
            case = self.generate_case(i, 'val')
            self._save_case(case, 'val')
        
        # Generate test data
        print("\nGenerating test data...")
        for i in tqdm(range(num_test)):
            case = self.generate_case(i, 'test')
            self._save_case(case, 'test')
        
        # Save metadata
        metadata = {
            'num_train': num_train,
            'num_val': num_val,
            'num_test': num_test,
            'volume_size': self.volume_size,
            'fields': ['pressure', 'u', 'v', 'w', 'k', 'omega', 'nut'],
            'geometry_fields': ['x', 'y', 'z'],
            'generated': str(np.datetime64('now'))
        }
        
        with open(os.path.join(self.output_dir, 'metadata.json'), 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print("\n" + "=" * 60)
        print("Dataset generation complete!")
        print(f"Output directory: {self.output_dir}")
        print("=" * 60)
    
    def _save_case(self, case: Dict[str, Any], split: str):
        """Save case to HDF5 file"""
        filename = f"case_{case['case_id']:06d}.h5"
        filepath = os.path.join(self.output_dir, split, filename)
        
        with h5py.File(filepath, 'w') as f:
            # Save geometry
            f.create_dataset('geometry', data=case['geometry'], compression='gzip')
            
            # Save flow field
            f.create_dataset('flow_field', data=case['flow_field'], compression='gzip')
            
            # Save parameters
            params_group = f.create_group('parameters')
            for key, value in case['parameters'].items():
                params_group.attrs[key] = value
            
            # Save coefficients
            coeffs_group = f.create_group('coefficients')
            for key, value in case['coefficients'].items():
                coeffs_group.attrs[key] = value


def main():
    """Generate dataset"""
    generator = SyntheticCFDGenerator(
        volume_size=(64, 64, 64),
        output_dir='data/cfd_dataset'
    )
    
    # Generate small dataset for testing
    generator.generate_dataset(
        num_train=1000,
        num_val=200,
        num_test=100
    )


if __name__ == "__main__":
    main()
