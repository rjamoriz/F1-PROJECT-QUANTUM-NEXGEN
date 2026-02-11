/**
 * Microservices Configuration
 * URLs and endpoints for all backend services
 */

module.exports = {
  // Physics Engine Service (VLM/Panel methods)
  physics: {
    baseUrl: process.env.PHYSICS_SERVICE_URL || 'http://localhost:8001',
    endpoints: {
      vlmSolve: '/vlm/solve',
      vlmSweep: '/vlm/sweep',
      vlmValidate: '/vlm/validate',
      flowField: '/api/v1/flow-field',
      panelSolve: '/api/v1/panel-solve',
      vlmBatchSimulate: '/api/vlm/batch-simulate',
      health: '/health'
    },
    timeout: 30000 // 30 seconds
  },

  // ML Surrogate Service (GPU inference)
  ml: {
    baseUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
    endpoints: {
      predict: '/predict',
      predictBatch: '/predict/batch',
      predictForces: '/api/v1/predict-forces',
      gnnMeshGraph: '/api/ml/gnn-rans/mesh-graph',
      gnnSolve: '/api/ml/gnn-rans/solve',
      gnnCompareOpenfoam: '/api/ml/gnn-rans/compare-openfoam',
      gnnBenchmark: '/api/ml/gnn-rans/benchmark',
      models: '/models',
      stats: '/stats',
      clearCache: '/cache/clear',
      health: '/health'
    },
    timeout: 10000 // 10 seconds
  },

  // Quantum Optimizer Service (QAOA/QUBO)
  quantum: {
    baseUrl: process.env.QUANTUM_SERVICE_URL || 'http://localhost:8002',
    endpoints: {
      optimize: '/optimize',
      qubo: '/qubo',
      qaoa: '/qaoa',
      classical: '/classical',
      health: '/health'
    },
    timeout: 60000 // 60 seconds (quantum can be slow)
  },

  // GenAI Agents Service (Claude via NATS)
  genai: {
    natsUrl: process.env.NATS_URL || 'nats://localhost:4222',
    subjects: {
      masterOrchestrator: 'agent.master',
      mlSurrogate: 'agent.ml',
      quantumOptimizer: 'agent.quantum',
      physicsValidator: 'agent.physics',
      analysis: 'agent.analysis'
    }
  },

  // Service health check intervals
  healthCheck: {
    interval: 30000, // 30 seconds
    timeout: 5000    // 5 seconds
  }
};
