/**
 * Aero Optimization Utilities
 * 
 * Helper functions for quantum-ready aero optimization loop:
 * - Candidate generation from design spaces
 * - Quadratic surrogate fitting (QUBO construction)
 * - Solution decoding and ranking
 */

const logger = require('./logger');

/**
 * Generate candidate designs from design space specification
 * @param {Object} designSpace - Design space definition (discrete or continuous)
 * @param {number} numCandidates - Number of candidates to generate
 * @param {string} method - Generation method ('grid', 'lhs', 'random')
 * @returns {Array<Object>} Array of candidate designs with {id, parameters}
 */
function generateCandidates(designSpace, numCandidates, method = 'lhs') {
  const { type, parameters } = designSpace;
  const candidates = [];

  if (type === 'discrete') {
    // Discrete design space: enumerate or sample combinations
    const paramNames = Object.keys(parameters);
    const paramValues = paramNames.map(name => parameters[name].values || []);
    
    if (method === 'grid') {
      // Full grid enumeration (combinatorial)
      const totalCombos = paramValues.reduce((acc, vals) => acc * vals.length, 1);
      const actualCount = Math.min(numCandidates, totalCombos);
      
      logger.info(`Generating ${actualCount} candidates via grid enumeration (${totalCombos} total)`);
      
      // Generate all combinations (up to limit)
      const combinations = [];
      const indices = Array(paramNames.length).fill(0);
      
      for (let i = 0; i < actualCount; i++) {
        const candidate = { id: `candidate_${i}`, parameters: {} };
        paramNames.forEach((name, j) => {
          candidate.parameters[name] = paramValues[j][indices[j]];
        });
        combinations.push(candidate);
        
        // Increment indices (lexicographic order)
        for (let j = paramNames.length - 1; j >= 0; j--) {
          indices[j]++;
          if (indices[j] < paramValues[j].length) break;
          indices[j] = 0;
        }
      }
      
      return combinations;
    } else {
      // Random sampling from discrete space
      logger.info(`Generating ${numCandidates} candidates via random sampling`);
      
      for (let i = 0; i < numCandidates; i++) {
        const candidate = { id: `candidate_${i}`, parameters: {} };
        paramNames.forEach(name => {
          const values = parameters[name].values || [];
          const idx = Math.floor(Math.random() * values.length);
          candidate.parameters[name] = values[idx];
        });
        candidates.push(candidate);
      }
      
      return candidates;
    }
  } else if (type === 'continuous') {
    // Continuous design space: LHS or random sampling
    const paramNames = Object.keys(parameters);
    
    if (method === 'lhs') {
      logger.info(`Generating ${numCandidates} candidates via Latin Hypercube Sampling`);
      
      // Simple LHS implementation
      const dimensions = paramNames.length;
      const intervals = Array.from({ length: numCandidates }, (_, i) => i);
      
      // Shuffle intervals for each dimension
      const sampledIndices = paramNames.map(() => {
        const shuffled = [...intervals];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      });
      
      for (let i = 0; i < numCandidates; i++) {
        const candidate = { id: `candidate_${i}`, parameters: {} };
        
        paramNames.forEach((name, dim) => {
          const { min, max } = parameters[name];
          const interval = sampledIndices[dim][i];
          const u = (interval + Math.random()) / numCandidates; // Uniform within interval
          candidate.parameters[name] = min + u * (max - min);
        });
        
        candidates.push(candidate);
      }
      
      return candidates;
    } else {
      // Random uniform sampling
      logger.info(`Generating ${numCandidates} candidates via random sampling`);
      
      for (let i = 0; i < numCandidates; i++) {
        const candidate = { id: `candidate_${i}`, parameters: {} };
        
        paramNames.forEach(name => {
          const { min, max } = parameters[name];
          candidate.parameters[name] = min + Math.random() * (max - min);
        });
        
        candidates.push(candidate);
      }
      
      return candidates;
    }
  } else {
    throw new Error(`Unknown design space type: ${type}`);
  }
}

/**
 * Fit quadratic surrogate and build QUBO matrix
 * @param {Array<Object>} mlScores - ML predictions with {id, cl, cd, balance_proxy, stall_risk}
 * @param {Object} objectives - Optimization objectives {downforce_weight, drag_weight, balance_weight, stall_weight}
 * @param {number} penaltyWeight - Penalty weight for constraint violation
 * @returns {Object} QUBO definition {n_variables, Q_matrix (flattened), id_to_index, index_to_id}
 */
function buildQubo(mlScores, objectives, penaltyWeight = 10.0) {
  const n = mlScores.length;
  
  // Map candidate IDs to indices
  const idToIndex = {};
  const indexToId = {};
  mlScores.forEach((score, idx) => {
    idToIndex[score.id] = idx;
    indexToId[idx] = score.id;
  });
  
  // Extract objective values
  const clValues = mlScores.map(s => s.cl);
  const cdValues = mlScores.map(s => s.cd);
  const balanceValues = mlScores.map(s => s.balance_proxy || 0.0);
  const stallValues = mlScores.map(s => s.stall_risk || 0.0);
  
  // Normalize to [0, 1] for numerical stability
  const normalize = (arr) => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const range = max - min || 1.0;
    return arr.map(v => (v - min) / range);
  };
  
  const clNorm = normalize(clValues);
  const cdNorm = normalize(cdValues);
  const balanceNorm = balanceValues; // Already [0,1]
  const stallNorm = stallValues; // Already [0,1]
  
  // Composite objective (maximize cl, minimize cd, balance, stall)
  const wCl = objectives.downforce_weight || 1.0;
  const wCd = objectives.drag_weight || 0.5;
  const wBal = objectives.balance_weight || 0.3;
  const wStall = objectives.stall_weight || 0.3;
  
  const objectiveValues = mlScores.map((_, i) => {
    return (
      wCl * clNorm[i] -          // Maximize downforce
      wCd * cdNorm[i] -          // Minimize drag  
      wBal * balanceNorm[i] -    // Minimize imbalance
      wStall * stallNorm[i]      // Minimize stall risk
    );
  });
  
  // Build QUBO Q matrix (n x n symmetric)
  // For top-k selection, we use quadratic penalties for selecting >k items
  // Simplified: assign objective as diagonal, add pairwise repulsion
  const Q = Array(n).fill(0).map(() => Array(n).fill(0));
  
  // Diagonal: negative objective (QUBO minimizes, so negate for maximization)
  objectiveValues.forEach((obj, i) => {
    Q[i][i] = -obj;
  });
  
  // Off-diagonal: small repulsion to encourage diversity (optional)
  const diversityPenalty = 0.1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      Q[i][j] = diversityPenalty;
      Q[j][i] = diversityPenalty; // Symmetric
    }
  }
  
  // Return Q matrix as 2D array (quantum service expects List[List[float]])
  logger.info(`Built QUBO: ${n} variables, objective range [${Math.min(...objectiveValues).toFixed(3)}, ${Math.max(...objectiveValues).toFixed(3)}]`);
  
  return {
    n_variables: n,
    Q_matrix: Q,  // 2D array, not flattened
    penalty_weight: penaltyWeight,
    id_to_index: idToIndex,
    index_to_id: indexToId,
  };
}

/**
 * Decode quantum solution to top-k candidate IDs
 * @param {Array<number>} solution - Binary solution vector from quantum solver
 * @param {Object} quboMeta - QUBO metadata with index_to_id mapping
 * @param {Array<Object>} mlScores - Original ML scores for ranking
 * @param {number} topK - Number of top candidates to return
 * @returns {Array<string>} Top-k candidate IDs ranked by composite score
 */
function decodeSolutionToTopK(solution, quboMeta, mlScores, topK = 3) {
  const { index_to_id } = quboMeta;
  
  // Extract selected indices (where solution[i] === 1)
  const selectedIndices = solution
    .map((bit, idx) => (bit === 1 ? idx : -1))
    .filter(idx => idx >= 0);
  
  logger.info(`Quantum solution selected ${selectedIndices.length} candidates`);
  
  // Map indices to IDs and scores
  const allCandidates = mlScores.map((score, idx) => ({
    idx,
    id: index_to_id[idx],
    score,
    selected: selectedIndices.includes(idx)
  }));
  
  // Rank by composite objective (cl high, cd low, balance low, stall low)
  allCandidates.sort((a, b) => {
    // Prefer quantum-selected candidates, then rank by objective
    if (a.selected && !b.selected) return -1;
    if (!a.selected && b.selected) return 1;
    
    const scoreA = a.score.cl - 0.5 * a.score.cd - 0.3 * (a.score.balance_proxy || 0) - 0.3 * (a.score.stall_risk || 0);
    const scoreB = b.score.cl - 0.5 * b.score.cd - 0.3 * (b.score.balance_proxy || 0) - 0.3 * (b.score.stall_risk || 0);
    return scoreB - scoreA;
  });
  
  const topKIds = allCandidates.slice(0, topK).map(c => c.id);
  logger.info(`Decoded top-${topK} candidates: ${topKIds.join(', ')}`);
  
  return topKIds;
}

/**
 * Rank candidates by composite score
 * @param {Array<Object>} candidates - Candidates with ML scores
 * @param {Object} weights - Objective weights {downforce, drag, balance, stall}
 * @returns {Array<Object>} Sorted candidates with composite_score field
 */
function rankCandidates(candidates, weights = {}) {
  const wCl = weights.downforce_weight || 1.0;
  const wCd = weights.drag_weight || 0.5;
  const wBal = weights.balance_weight || 0.3;
  const wStall = weights.stall_weight || 0.3;
  
  const withScores = candidates.map(c => {
    const score = (
      wCl * c.cl -
      wCd * c.cd -
      wBal * (c.balance_proxy || 0) -
      wStall * (c.stall_risk || 0)
    );
    return { ...c, composite_score: score };
  });
  
  withScores.sort((a, b) => b.composite_score - a.composite_score);
  return withScores;
}

module.exports = {
  generateCandidates,
  buildQubo,
  decodeSolutionToTopK,
  rankCandidates,
};
