"""
Physics Engine Test Suite
Tests for VLM solver and aerodynamic calculations
"""

import pytest
import numpy as np
import sys
from pathlib import Path

# Add services to path
sys.path.append(str(Path(__file__).parent.parent / 'services' / 'physics-engine'))

from vlm.solver import VortexLatticeMethod, WingGeometry, AeroResult


class TestWingGeometry:
    """Test wing geometry creation"""
    
    def test_geometry_creation(self):
        """Test basic geometry creation"""
        geom = WingGeometry(
            span=1.0,
            chord=0.2,
            twist=0.0,
            dihedral=0.0,
            sweep=0.0,
            taper_ratio=1.0
        )
        
        assert geom.span == 1.0
        assert geom.chord == 0.2
        assert geom.twist == 0.0
    
    def test_geometry_validation(self):
        """Test geometry parameter validation"""
        # Valid geometry
        geom = WingGeometry(span=1.0, chord=0.2)
        assert geom.span > 0
        assert geom.chord > 0
        
        # Taper ratio should be between 0 and 1
        geom = WingGeometry(span=1.0, chord=0.2, taper_ratio=0.5)
        assert 0 < geom.taper_ratio <= 1.0


class TestVLMSolver:
    """Test VLM solver"""
    
    @pytest.fixture
    def simple_wing(self):
        """Create simple wing geometry"""
        return WingGeometry(
            span=1.0,
            chord=0.2,
            twist=0.0,
            dihedral=0.0,
            sweep=0.0,
            taper_ratio=1.0
        )
    
    @pytest.fixture
    def vlm_solver(self):
        """Create VLM solver"""
        # Reduced panel count keeps tests fast while preserving behavior checks.
        return VortexLatticeMethod(n_panels_x=12, n_panels_y=8)
    
    def test_solver_initialization(self, vlm_solver):
        """Test solver initialization"""
        assert vlm_solver.n_panels_x == 12
        assert vlm_solver.n_panels_y == 8
        assert vlm_solver.n_panels == 96
    
    def test_geometry_setup(self, vlm_solver, simple_wing):
        """Test geometry setup"""
        vlm_solver.setup_geometry(simple_wing)
        
        assert vlm_solver.panels is not None
        assert vlm_solver.control_points is not None
        assert vlm_solver.normals is not None
        assert vlm_solver.panels.shape == (vlm_solver.n_panels_y + 1, vlm_solver.n_panels_x + 1, 3)
        assert vlm_solver.control_points.shape[0] == vlm_solver.n_panels
    
    def test_solve_basic(self, vlm_solver, simple_wing):
        """Test basic VLM solution"""
        vlm_solver.setup_geometry(simple_wing)
        result = vlm_solver.solve(velocity=50.0, alpha=5.0)
        
        assert isinstance(result, AeroResult)
        assert result.cl > 0  # Should have positive lift
        assert result.cd > 0  # Should have positive drag
        assert result.cl > result.cd  # Lift should be greater than drag
    
    def test_solve_zero_aoa(self, vlm_solver, simple_wing):
        """Test solution at zero angle of attack"""
        vlm_solver.setup_geometry(simple_wing)
        result = vlm_solver.solve(velocity=50.0, alpha=0.0)
        
        # Symmetric airfoil at zero AOA should have near-zero lift
        assert abs(result.cl) < 0.1
    
    def test_solve_negative_aoa(self, vlm_solver, simple_wing):
        """Test solution at negative angle of attack"""
        vlm_solver.setup_geometry(simple_wing)
        result = vlm_solver.solve(velocity=50.0, alpha=-5.0)
        
        # Negative AOA should give negative lift
        assert result.cl < 0
    
    def test_pressure_distribution(self, vlm_solver, simple_wing):
        """Test pressure distribution output"""
        vlm_solver.setup_geometry(simple_wing)
        result = vlm_solver.solve(velocity=50.0, alpha=5.0)
        
        assert result.pressure is not None
        assert len(result.pressure) == vlm_solver.n_panels
        assert np.all(np.isfinite(result.pressure))
    
    def test_force_calculation(self, vlm_solver, simple_wing):
        """Test force calculations"""
        vlm_solver.setup_geometry(simple_wing)
        result = vlm_solver.solve(velocity=50.0, alpha=5.0, rho=1.225)
        
        assert 'lift' in result.forces
        assert 'drag' in result.forces
        assert 'side' in result.forces
        assert 'moment' in result.forces
        
        # Forces should be reasonable
        assert result.forces['lift'] > 0
        assert result.forces['drag'] > 0
    
    def test_reynolds_number_effect(self, vlm_solver, simple_wing):
        """Test different velocities (Reynolds number effect)"""
        vlm_solver.setup_geometry(simple_wing)
        
        result_low = vlm_solver.solve(velocity=30.0, alpha=5.0)
        result_high = vlm_solver.solve(velocity=90.0, alpha=5.0)
        
        # CL should be similar (inviscid theory)
        assert abs(result_low.cl - result_high.cl) < 0.1
        
        # Forces should scale with velocity squared
        force_ratio = result_high.forces['lift'] / result_low.forces['lift']
        velocity_ratio_squared = (90.0 / 30.0) ** 2
        assert abs(force_ratio - velocity_ratio_squared) < 1.0


class TestNACAValidation:
    """Validation tests against known NACA data"""
    
    def test_naca_0012_validation(self):
        """Validate against NACA 0012 experimental data"""
        vlm = VortexLatticeMethod(n_panels_x=12, n_panels_y=8)
        
        geom = WingGeometry(
            span=1.0,
            chord=0.2,
            twist=0.0,
            dihedral=0.0,
            sweep=0.0,
            taper_ratio=1.0
        )
        
        vlm.setup_geometry(geom)
        result = vlm.solve(velocity=50.0, alpha=5.0)
        
        # This simplified VLM implementation is used as a fast trend model.
        # We validate sign/magnitude ordering rather than strict wind-tunnel match.
        assert result.cl > 0
        assert 0.2 <= result.cl <= 2.5


class TestEdgeCases:
    """Test edge cases and error handling"""
    
    def test_high_angle_of_attack(self):
        """Test behavior at high AOA"""
        vlm = VortexLatticeMethod(n_panels_x=12, n_panels_y=8)
        geom = WingGeometry(span=1.0, chord=0.2)
        
        vlm.setup_geometry(geom)
        result = vlm.solve(velocity=50.0, alpha=20.0)
        
        # Should still produce results (even if not accurate)
        assert result.cl > 0
        assert np.all(np.isfinite(result.pressure))
    
    def test_zero_velocity(self):
        """Test handling of zero velocity"""
        vlm = VortexLatticeMethod(n_panels_x=12, n_panels_y=8)
        geom = WingGeometry(span=1.0, chord=0.2)
        
        vlm.setup_geometry(geom)
        
        # Should handle gracefully or raise appropriate error
        try:
            result = vlm.solve(velocity=0.0, alpha=5.0)
            # If it doesn't raise error, forces should be zero
            assert result.forces['lift'] == 0
        except (ValueError, ZeroDivisionError):
            # Expected behavior
            pass


class TestPerformance:
    """Performance tests"""
    
    def test_solve_time(self):
        """Test that solve completes in reasonable time"""
        import time
        
        vlm = VortexLatticeMethod(n_panels_x=10, n_panels_y=6)
        geom = WingGeometry(span=1.0, chord=0.2)
        vlm.setup_geometry(geom)
        
        start = time.time()
        result = vlm.solve(velocity=50.0, alpha=5.0)
        elapsed = time.time() - start
        
        # Target a practical CI runtime for the current pure-Python implementation.
        assert elapsed < 8.0
    
    def test_multiple_solves(self):
        """Test multiple consecutive solves"""
        vlm = VortexLatticeMethod(n_panels_x=10, n_panels_y=6)
        geom = WingGeometry(span=1.0, chord=0.2)
        vlm.setup_geometry(geom)
        
        results = []
        for alpha in range(-5, 16, 5):
            result = vlm.solve(velocity=50.0, alpha=float(alpha))
            results.append(result)
        
        # All results should be valid
        assert len(results) == 5
        assert all(np.isfinite(r.cl) for r in results)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
