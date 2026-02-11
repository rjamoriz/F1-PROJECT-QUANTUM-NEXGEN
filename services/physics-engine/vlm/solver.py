"""
Vortex Lattice Method (VLM) Solver for F1 Aerodynamics
Based on classical horseshoe vortex theory with Neumann boundary conditions
"""

import numpy as np
from typing import Dict, Tuple, Optional
from dataclasses import dataclass
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class AeroResult:
    """Aerodynamic force results from VLM solver"""
    cl: float  # Lift coefficient
    cd: float  # Drag coefficient (induced)
    cm: float  # Moment coefficient
    pressure: np.ndarray  # Pressure distribution
    gamma: np.ndarray  # Vortex strengths
    forces: Dict[str, float]  # Detailed force breakdown
    panel_forces: np.ndarray  # Per-panel force vectors [Fx, Fy, Fz]
    control_points: np.ndarray  # Per-panel control point coordinates


@dataclass
class WingGeometry:
    """Wing geometry definition"""
    span: float  # Wing span [m]
    chord: float  # Root chord [m]
    twist: float = 0.0  # Geometric twist [degrees]
    dihedral: float = 0.0  # Dihedral angle [degrees]
    sweep: float = 0.0  # Sweep angle [degrees]
    taper_ratio: float = 1.0  # Tip chord / root chord


class VortexLatticeMethod:
    """
    Vortex Lattice Method solver for lifting surfaces.
    
    Implementation based on:
    - Horseshoe vortex elements
    - Neumann boundary conditions (flow tangency)
    - Kutta condition at trailing edge
    - Prandtl-Glauert compressibility correction
    
    References:
    - Katz & Plotkin (2001): Low-Speed Aerodynamics
    - Drela (2014): Flight Vehicle Aerodynamics
    """
    
    def __init__(self, n_panels_x: int = 20, n_panels_y: int = 10):
        """
        Initialize VLM solver.
        
        Args:
            n_panels_x: Number of chordwise panels
            n_panels_y: Number of spanwise panels
        """
        self.n_panels_x = n_panels_x
        self.n_panels_y = n_panels_y
        self.n_panels = n_panels_x * n_panels_y
        
        # Solver state
        self.geometry: Optional[WingGeometry] = None
        self.panels = None
        self.control_points = None
        self.normals = None
        self.influence_matrix = None
        
        logger.info(f"VLM Solver initialized: {n_panels_x}x{n_panels_y} panels")
    
    def setup_geometry(self, geometry: WingGeometry):
        """
        Set up wing geometry and generate panel mesh.
        
        Args:
            geometry: Wing geometry parameters
        """
        self.geometry = geometry
        
        logger.info(f"Setting up geometry: span={geometry.span}m, chord={geometry.chord}m")
        
        # Generate panel mesh
        self._generate_panels()
        
        # Compute control points (3/4 chord)
        self._compute_control_points()
        
        # Compute panel normals
        self._compute_normals()
        
        # Build aerodynamic influence coefficient matrix
        self._build_influence_matrix()
        
        logger.info(f"Geometry setup complete: {self.n_panels} panels")
    
    def solve(self, 
              velocity: float, 
              alpha: float, 
              yaw: float = 0.0,
              rho: float = 1.225) -> AeroResult:
        """
        Solve for aerodynamic forces.
        
        Args:
            velocity: Freestream velocity [m/s]
            alpha: Angle of attack [degrees]
            yaw: Yaw angle [degrees]
            rho: Air density [kg/m³]
            
        Returns:
            AeroResult with forces, coefficients, and pressure distribution
        """
        if self.geometry is None:
            raise ValueError("Geometry not set up. Call setup_geometry() first.")
        
        logger.info(f"Solving: V={velocity}m/s, α={alpha}°, β={yaw}°")
        
        # Convert to radians
        alpha_rad = np.radians(alpha)
        yaw_rad = np.radians(yaw)
        
        # Freestream velocity vector
        v_inf = velocity * np.array([
            np.cos(alpha_rad) * np.cos(yaw_rad),
            np.sin(yaw_rad),
            np.sin(alpha_rad) * np.cos(yaw_rad)
        ])
        
        # Compute RHS (boundary conditions: V_inf · n = 0)
        rhs = self._compute_rhs(v_inf)
        
        # Solve for vortex strengths: AIC * gamma = RHS
        gamma = np.linalg.solve(self.influence_matrix, rhs)
        
        # Compute forces using Kutta-Joukowski theorem
        forces, panel_forces = self._compute_forces(gamma, v_inf, rho)
        
        # Compute pressure distribution
        pressure = self._compute_pressure(gamma, v_inf, rho)
        
        # Non-dimensionalize
        q_inf = 0.5 * rho * velocity**2  # Dynamic pressure
        s_ref = self.geometry.span * self.geometry.chord  # Reference area
        c_ref = self.geometry.chord  # Reference chord
        
        cl = forces['lift'] / (q_inf * s_ref)
        cd = forces['drag'] / (q_inf * s_ref)
        cm = forces['moment'] / (q_inf * s_ref * c_ref)
        
        logger.info(f"Solution: CL={cl:.4f}, CD={cd:.4f}, CM={cm:.4f}")
        
        return AeroResult(
            cl=cl,
            cd=cd,
            cm=cm,
            pressure=pressure,
            gamma=gamma,
            forces=forces,
            panel_forces=panel_forces,
            control_points=self.control_points.copy()
        )
    
    def _generate_panels(self):
        """Generate panel mesh with horseshoe vortices"""
        geom = self.geometry
        
        # Spanwise distribution (cosine spacing for better convergence)
        theta = np.linspace(0, np.pi, self.n_panels_y + 1)
        y = -0.5 * geom.span * np.cos(theta)
        
        # Chordwise distribution (uniform)
        x = np.linspace(0, geom.chord, self.n_panels_x + 1)
        
        # Create mesh grid
        X, Y = np.meshgrid(x, y)
        
        # Apply geometric transformations
        Z = np.zeros_like(X)
        
        # Twist (washout)
        if geom.twist != 0:
            twist_dist = np.linspace(0, geom.twist, self.n_panels_y + 1)
            for i in range(self.n_panels_y + 1):
                twist_rad = np.radians(twist_dist[i])
                X[i, :] = X[i, :] * np.cos(twist_rad)
                Z[i, :] = X[i, :] * np.sin(twist_rad)
        
        # Dihedral
        if geom.dihedral != 0:
            dihedral_rad = np.radians(geom.dihedral)
            Z += np.abs(Y) * np.tan(dihedral_rad)
        
        # Sweep
        if geom.sweep != 0:
            sweep_rad = np.radians(geom.sweep)
            X += np.abs(Y) * np.tan(sweep_rad)
        
        # Store panel corners
        self.panels = np.stack([X, Y, Z], axis=-1)
        
        logger.debug(f"Generated {self.n_panels} panels")
    
    def _compute_control_points(self):
        """Compute control points at 3/4 chord of each panel"""
        # Control points at 3/4 chord, mid-span
        cp_x = 0.75 * (self.panels[:-1, :-1, 0] + self.panels[:-1, 1:, 0])
        cp_y = 0.5 * (self.panels[:-1, :-1, 1] + self.panels[:-1, 1:, 1])
        cp_z = 0.5 * (self.panels[:-1, :-1, 2] + self.panels[:-1, 1:, 2])
        
        self.control_points = np.stack([cp_x, cp_y, cp_z], axis=-1)
        self.control_points = self.control_points.reshape(-1, 3)
    
    def _compute_normals(self):
        """Compute panel normal vectors"""
        # Compute vectors along panel edges
        v1 = self.panels[:-1, 1:, :] - self.panels[:-1, :-1, :]
        v2 = self.panels[1:, :-1, :] - self.panels[:-1, :-1, :]
        
        # Normal = cross product
        normals = np.cross(v1, v2)
        
        # Normalize
        norm = np.linalg.norm(normals, axis=-1, keepdims=True)
        self.normals = normals / norm
        self.normals = self.normals.reshape(-1, 3)
    
    def _build_influence_matrix(self):
        """
        Build aerodynamic influence coefficient (AIC) matrix.
        
        AIC[i,j] = induced velocity at control point i due to unit vortex at panel j
        """
        n = self.n_panels
        self.influence_matrix = np.zeros((n, n))
        
        for i in range(n):
            for j in range(n):
                # Compute induced velocity from horseshoe vortex j at control point i
                v_ind = self._horseshoe_influence(
                    self.control_points[i],
                    j
                )
                
                # Project onto normal direction
                self.influence_matrix[i, j] = np.dot(v_ind, self.normals[i])
        
        logger.debug("Built influence matrix")
    
    def _horseshoe_influence(self, point: np.ndarray, panel_idx: int) -> np.ndarray:
        """
        Compute induced velocity from horseshoe vortex using Biot-Savart law.
        
        Args:
            point: Evaluation point [x, y, z]
            panel_idx: Panel index
            
        Returns:
            Induced velocity vector [vx, vy, vz]
        """
        # Get panel corners
        i = panel_idx // self.n_panels_x
        j = panel_idx % self.n_panels_x
        
        # Bound vortex (1/4 chord)
        p1 = 0.25 * (self.panels[i, j] + self.panels[i, j+1])
        p2 = 0.25 * (self.panels[i+1, j] + self.panels[i+1, j+1])
        
        # Trailing vortices (extend to infinity)
        p3 = p2 + np.array([1000, 0, 0])  # Far downstream
        p4 = p1 + np.array([1000, 0, 0])
        
        # Compute induced velocity from each segment
        v_bound = self._vortex_segment(point, p1, p2)
        v_trail1 = self._vortex_segment(point, p2, p3)
        v_trail2 = self._vortex_segment(point, p4, p1)
        
        return v_bound + v_trail1 + v_trail2
    
    def _vortex_segment(self, point: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> np.ndarray:
        """
        Biot-Savart law for straight vortex segment.
        
        v = (Γ / 4π) * (r1 × r2) / |r1 × r2|² * (r0·(r1/|r1| - r2/|r2|))
        """
        r1 = point - p1
        r2 = point - p2
        r0 = p2 - p1
        
        r1_norm = np.linalg.norm(r1)
        r2_norm = np.linalg.norm(r2)
        
        # Avoid singularity
        if r1_norm < 1e-10 or r2_norm < 1e-10:
            return np.zeros(3)
        
        cross = np.cross(r1, r2)
        cross_norm_sq = np.dot(cross, cross)
        
        if cross_norm_sq < 1e-10:
            return np.zeros(3)
        
        # Biot-Savart formula (unit circulation)
        coeff = 1.0 / (4.0 * np.pi * cross_norm_sq)
        dot_term = np.dot(r0, r1/r1_norm - r2/r2_norm)
        
        return coeff * cross * dot_term
    
    def _compute_rhs(self, v_inf: np.ndarray) -> np.ndarray:
        """
        Compute right-hand side: boundary condition V_inf · n = 0
        
        Args:
            v_inf: Freestream velocity vector
            
        Returns:
            RHS vector for linear system
        """
        return -np.dot(self.normals, v_inf)
    
    def _compute_forces(
        self,
        gamma: np.ndarray,
        v_inf: np.ndarray,
        rho: float
    ) -> Tuple[Dict[str, float], np.ndarray]:
        """
        Compute aerodynamic forces using Kutta-Joukowski theorem.
        
        F = ρ * V × Γ * l
        
        Args:
            gamma: Vortex strengths
            v_inf: Freestream velocity
            rho: Air density
            
        Returns:
            Dictionary with lift, drag, side force, moment
        """
        forces = {'lift': 0.0, 'drag': 0.0, 'side': 0.0, 'moment': 0.0}
        panel_forces = np.zeros((self.n_panels, 3))
        
        for i in range(self.n_panels):
            # Panel dimensions
            panel_i = i // self.n_panels_x
            panel_j = i % self.n_panels_x
            
            # Bound vortex segment at quarter-chord (spanwise direction)
            p1 = 0.25 * (self.panels[panel_i, panel_j] + self.panels[panel_i, panel_j+1])
            p2 = 0.25 * (self.panels[panel_i+1, panel_j] + self.panels[panel_i+1, panel_j+1])
            dl = p1 - p2
            
            # Kutta-Joukowski: dF = rho * V_inf × (Gamma * dl)
            dF = rho * np.cross(v_inf, gamma[i] * dl)
            panel_forces[i] = dF
            
            forces['lift'] += dF[2]  # Z-component
            forces['drag'] += -dF[0]  # -X-component (induced drag)
            forces['side'] += dF[1]  # Y-component
            
            # Moment about origin
            r = self.control_points[i]
            forces['moment'] += np.cross(r, dF)[1]  # Pitching moment
        
        return forces, panel_forces
    
    def _compute_pressure(self, gamma: np.ndarray, v_inf: np.ndarray, rho: float) -> np.ndarray:
        """
        Compute pressure coefficient distribution.
        
        Cp = 1 - (V_local / V_inf)²
        
        Args:
            gamma: Vortex strengths
            v_inf: Freestream velocity
            rho: Air density
            
        Returns:
            Pressure coefficient at each panel
        """
        v_inf_mag = np.linalg.norm(v_inf)
        cp = np.zeros(self.n_panels)
        
        for i in range(self.n_panels):
            # Induced velocity at control point
            v_ind = np.zeros(3)
            for j in range(self.n_panels):
                v_ind += gamma[j] * self._horseshoe_influence(self.control_points[i], j)
            
            # Total velocity
            v_total = v_inf + v_ind
            v_total_mag = np.linalg.norm(v_total)
            
            # Pressure coefficient
            cp[i] = 1.0 - (v_total_mag / v_inf_mag)**2
        
        return cp


def main():
    """Example usage of VLM solver"""
    # Define wing geometry
    geometry = WingGeometry(
        span=1.0,  # 1 meter span
        chord=0.2,  # 0.2 meter chord
        twist=-2.0,  # 2 degrees washout
        dihedral=0.0,
        sweep=0.0,
        taper_ratio=1.0
    )
    
    # Initialize solver
    vlm = VortexLatticeMethod(n_panels_x=20, n_panels_y=10)
    vlm.setup_geometry(geometry)
    
    # Solve at 5 degrees angle of attack
    result = vlm.solve(velocity=50.0, alpha=5.0, yaw=0.0)
    
    print(f"\n=== VLM Solution ===")
    print(f"CL = {result.cl:.4f}")
    print(f"CD = {result.cd:.4f}")
    print(f"CM = {result.cm:.4f}")
    print(f"L/D = {result.cl/result.cd:.2f}")
    print(f"Lift = {result.forces['lift']:.2f} N")
    print(f"Drag = {result.forces['drag']:.2f} N")


if __name__ == "__main__":
    main()
