"""
QAOA (Quantum Approximate Optimization Algorithm) Solver
For aerodynamic optimization problems formulated as QUBO
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
import logging
from dataclasses import dataclass

# Qiskit imports
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter
from qiskit_aer import AerSimulator
from qiskit.primitives import Sampler
from qiskit_algorithms import QAOA
from qiskit_algorithms.optimizers import COBYLA, SPSA
from qiskit.quantum_info import SparsePauliOp

logger = logging.getLogger(__name__)


@dataclass
class QAOAResult:
    """QAOA optimization result"""
    solution: np.ndarray  # Binary solution vector
    cost: float  # Objective function value
    eigenvalue: float  # Minimum eigenvalue
    optimal_parameters: np.ndarray  # Optimized circuit parameters
    n_iterations: int  # Number of optimizer iterations
    success: bool  # Whether optimization succeeded
    method: str = "QAOA"  # Optimization method used


class QAOASolver:
    """
    QAOA solver for QUBO optimization problems.
    
    Solves discrete aerodynamic optimization:
    - Stiffener placement
    - Thickness distribution
    - Flap angle selection
    - Material selection
    
    Uses Qiskit Aer simulator for quantum circuit simulation.
    """
    
    def __init__(
        self,
        n_layers: int = 3,
        optimizer: str = 'COBYLA',
        max_iterations: int = 100,
        use_simulator: bool = True
    ):
        """
        Initialize QAOA solver.
        
        Args:
            n_layers: Number of QAOA layers (p parameter)
            optimizer: Classical optimizer ('COBYLA' or 'SPSA')
            max_iterations: Maximum optimizer iterations
            use_simulator: Use Aer simulator (vs. real quantum hardware)
        """
        self.n_layers = n_layers
        self.max_iterations = max_iterations
        
        # Set up backend
        if use_simulator:
            self.backend = AerSimulator()
            logger.info("Using Qiskit Aer simulator")
        else:
            # For future: connect to IBM Quantum
            logger.warning("Real quantum hardware not yet configured, using simulator")
            self.backend = AerSimulator()
        
        # Set up classical optimizer
        if optimizer == 'COBYLA':
            self.optimizer = COBYLA(maxiter=max_iterations)
        elif optimizer == 'SPSA':
            self.optimizer = SPSA(maxiter=max_iterations)
        else:
            raise ValueError(f"Unknown optimizer: {optimizer}")
        
        logger.info(f"QAOA Solver initialized: {n_layers} layers, {optimizer} optimizer")
    
    def optimize(
        self,
        qubo_matrix: np.ndarray,
        constraints: Optional[Dict] = None
    ) -> QAOAResult:
        """
        Solve QUBO optimization problem using QAOA.
        
        QUBO formulation:
        minimize: x^T Q x
        where x ∈ {0,1}^n
        
        Args:
            qubo_matrix: Q matrix (n x n, symmetric)
            constraints: Optional constraints (one-hot, etc.)
            
        Returns:
            QAOAResult with optimal solution
        """
        n_qubits = qubo_matrix.shape[0]
        
        logger.info(f"Solving QUBO problem: {n_qubits} variables")
        
        # Convert QUBO to Ising Hamiltonian
        hamiltonian = self._qubo_to_ising(qubo_matrix)
        
        # Create QAOA instance
        qaoa = QAOA(
            sampler=Sampler(),
            optimizer=self.optimizer,
            reps=self.n_layers
        )
        
        try:
            # Run QAOA
            result = qaoa.compute_minimum_eigenvalue(hamiltonian)
            
            # Decode solution
            solution_bitstring = self._decode_solution(result, n_qubits)
            solution_vector = np.array([int(b) for b in solution_bitstring])
            
            # Compute cost
            cost = float(solution_vector @ qubo_matrix @ solution_vector)
            
            # Check constraints
            feasible = self._check_constraints(solution_vector, constraints)
            
            if not feasible:
                logger.warning("Solution violates constraints")
            
            qaoa_result = QAOAResult(
                solution=solution_vector,
                cost=cost,
                eigenvalue=result.eigenvalue.real,
                optimal_parameters=result.optimal_parameters,
                n_iterations=result.optimizer_evals,
                success=feasible,
                method="QAOA"
            )
            
            logger.info(f"QAOA completed: cost={cost:.4f}, feasible={feasible}")
            
            return qaoa_result
            
        except Exception as e:
            logger.error(f"QAOA failed: {str(e)}")
            raise
    
    def optimize_hybrid(
        self,
        qubo_matrix: np.ndarray,
        ml_surrogate: Optional[callable] = None,
        n_candidates: int = 10
    ) -> List[QAOAResult]:
        """
        Hybrid quantum-classical optimization.
        
        Workflow:
        1. QAOA proposes candidate solutions
        2. ML surrogate evaluates aerodynamics (if provided)
        3. Select top candidates
        4. Refine with classical optimization
        
        Args:
            qubo_matrix: Q matrix
            ml_surrogate: Function to evaluate aerodynamics
            n_candidates: Number of candidates to evaluate
            
        Returns:
            List of top solutions
        """
        candidates = []
        
        logger.info(f"Hybrid optimization: generating {n_candidates} candidates")
        
        for i in range(n_candidates):
            # Add noise to explore solution space
            perturbed_matrix = qubo_matrix + np.random.randn(*qubo_matrix.shape) * 0.1
            perturbed_matrix = (perturbed_matrix + perturbed_matrix.T) / 2  # Keep symmetric
            
            # Solve with QAOA
            result = self.optimize(perturbed_matrix)
            
            if result.success:
                # Evaluate with ML surrogate if provided
                if ml_surrogate is not None:
                    aero_metrics = ml_surrogate(result.solution)
                    result.aero_metrics = aero_metrics
                
                candidates.append(result)
        
        # Sort by cost (or multi-objective fitness)
        candidates.sort(key=lambda x: x.cost)
        
        logger.info(f"Generated {len(candidates)} feasible candidates")
        
        return candidates[:n_candidates]
    
    def _qubo_to_ising(self, qubo_matrix: np.ndarray) -> SparsePauliOp:
        """
        Convert QUBO to Ising Hamiltonian.
        
        QUBO: x_i ∈ {0,1}
        Ising: s_i ∈ {-1,1}
        Transformation: x_i = (1 + s_i) / 2
        
        Args:
            qubo_matrix: Q matrix
            
        Returns:
            Ising Hamiltonian as SparsePauliOp
        """
        n = qubo_matrix.shape[0]
        
        # Convert QUBO to Ising coefficients
        # H_ising = sum_i h_i * Z_i + sum_{i<j} J_{ij} * Z_i * Z_j
        
        h = np.zeros(n)
        J = np.zeros((n, n))
        
        for i in range(n):
            h[i] = qubo_matrix[i, i] / 4
            for j in range(i+1, n):
                J[i, j] = qubo_matrix[i, j] / 4
                h[i] += qubo_matrix[i, j] / 4
                h[j] += qubo_matrix[i, j] / 4
        
        # Build Pauli operator list
        pauli_list = []
        
        # Single-qubit terms
        for i in range(n):
            if abs(h[i]) > 1e-10:
                pauli_str = ['I'] * n
                pauli_str[i] = 'Z'
                pauli_list.append((''.join(pauli_str), h[i]))
        
        # Two-qubit terms
        for i in range(n):
            for j in range(i+1, n):
                if abs(J[i, j]) > 1e-10:
                    pauli_str = ['I'] * n
                    pauli_str[i] = 'Z'
                    pauli_str[j] = 'Z'
                    pauli_list.append((''.join(pauli_str), J[i, j]))
        
        # Create SparsePauliOp
        hamiltonian = SparsePauliOp.from_list(pauli_list)
        
        return hamiltonian
    
    def _decode_solution(self, result, n_qubits: int) -> str:
        """
        Decode QAOA result to bitstring.
        
        Args:
            result: QAOA result object
            n_qubits: Number of qubits
            
        Returns:
            Bitstring solution
        """
        # Get the most probable bitstring from the result
        if hasattr(result, 'best_measurement'):
            return result.best_measurement['bitstring']
        
        # Fallback: sample from the optimal state
        optimal_circuit = result.optimal_circuit
        if optimal_circuit is not None:
            # Measure the circuit
            sampler = Sampler()
            job = sampler.run(optimal_circuit)
            counts = job.result().quasi_dists[0]
            
            # Get most probable outcome
            max_prob = 0
            best_bitstring = '0' * n_qubits
            
            for bitstring, prob in counts.items():
                if prob > max_prob:
                    max_prob = prob
                    best_bitstring = format(bitstring, f'0{n_qubits}b')
            
            return best_bitstring
        
        # Last resort: random solution
        logger.warning("Could not decode solution, returning random")
        return ''.join(np.random.choice(['0', '1'], n_qubits))
    
    def _check_constraints(
        self,
        solution: np.ndarray,
        constraints: Optional[Dict]
    ) -> bool:
        """
        Check if solution satisfies constraints.
        
        Args:
            solution: Binary solution vector
            constraints: Constraint dictionary
            
        Returns:
            True if feasible
        """
        if constraints is None:
            return True
        
        # Check one-hot constraints (for discrete variables)
        if 'one_hot_groups' in constraints:
            for group in constraints['one_hot_groups']:
                if solution[group].sum() != 1:
                    return False
        
        # Check linear constraints
        if 'linear' in constraints:
            for constraint in constraints['linear']:
                coeff = constraint['coefficients']
                bound = constraint['bound']
                constraint_type = constraint['type']
                
                value = np.dot(coeff, solution)
                
                if constraint_type == 'eq' and abs(value - bound) > 1e-6:
                    return False
                elif constraint_type == 'leq' and value > bound + 1e-6:
                    return False
                elif constraint_type == 'geq' and value < bound - 1e-6:
                    return False
        
        return True


def create_qubo_from_problem(
    objective: Dict,
    constraints: Optional[Dict] = None
) -> np.ndarray:
    """
    Create QUBO matrix from optimization problem.
    
    Args:
        objective: Objective function specification
        constraints: Constraint specification
        
    Returns:
        QUBO matrix Q
    """
    n_vars = objective['n_variables']
    Q = np.zeros((n_vars, n_vars))
    
    # Linear terms (diagonal)
    if 'linear' in objective:
        for i, coeff in enumerate(objective['linear']):
            Q[i, i] = coeff
    
    # Quadratic terms (off-diagonal)
    if 'quadratic' in objective:
        for key, coeff in objective['quadratic'].items():
            if isinstance(key, (list, tuple)) and len(key) == 2:
                i, j = int(key[0]), int(key[1])
            elif isinstance(key, str):
                normalized_key = key.strip().replace('(', '').replace(')', '')
                parts = [part.strip() for part in normalized_key.split(',')]
                if len(parts) != 2:
                    raise ValueError(
                        f"Invalid quadratic key format '{key}'. "
                        "Expected '(i,j)' or 'i,j'."
                    )
                i, j = int(parts[0]), int(parts[1])
            else:
                raise ValueError(
                    f"Unsupported quadratic key type: {type(key)}. "
                    "Use tuple/list or string key formats."
                )

            Q[i, j] = coeff
            Q[j, i] = coeff  # Ensure symmetry
    
    # Add penalty terms for constraints
    if constraints is not None and 'penalty' in constraints:
        penalty_weight = constraints.get('penalty_weight', 10.0)
        
        # One-hot constraints
        if 'one_hot_groups' in constraints:
            for group in constraints['one_hot_groups']:
                # Penalty: (sum_i x_i - 1)^2
                for i in group:
                    Q[i, i] += penalty_weight * (-2)
                    for j in group:
                        if i != j:
                            Q[i, j] += penalty_weight * 2
    
    return Q


if __name__ == "__main__":
    # Test QAOA solver
    logging.basicConfig(level=logging.INFO)
    
    # Simple test problem: 3 variables
    Q = np.array([
        [1, -2, 0],
        [-2, 2, -1],
        [0, -1, 1]
    ])
    
    print("QAOA Solver Test")
    print("=" * 50)
    print(f"QUBO matrix:\n{Q}")
    
    # Create solver
    solver = QAOASolver(n_layers=2, optimizer='COBYLA')
    
    # Solve
    result = solver.optimize(Q)
    
    print(f"\nSolution: {result.solution}")
    print(f"Cost: {result.cost:.4f}")
    print(f"Feasible: {result.success}")
    print(f"Iterations: {result.n_iterations}")
