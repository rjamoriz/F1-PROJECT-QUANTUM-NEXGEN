const mongoose = require('mongoose');

/**
 * OptimizationRun Model
 * 
 * Stores complete audit trail for quantum-ready aero optimization runs.
 * Each run captures: request, candidates, ML scores, QUBO formulation,
 * quantum solution, VLM validation, and final result.
 */

const optimizationRunSchema = new mongoose.Schema({
    // Unique run identifier
    runId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        description: 'UUID for this optimization run'
    },
    
    // Original request payload
    request: {
        type: Object,
        required: true,
        description: 'Full AeroOptimizationRequest payload'
    },
    
    // Candidate generation metadata
    candidates: {
        count: {
            type: Number,
            required: true,
            description: 'Number of candidates generated from design space'
        },
        method: {
            type: String,
            enum: ['random', 'lhs', 'sobol', 'grid'],
            default: 'lhs',
            description: 'Sampling method used'
        },
        data: {
            type: Array,
            default: [],
            description: 'Candidate design variable values (optional, can be large)'
        }
    },
    
    // ML surrogate predictions
    mlScores: {
        type: Array,
        required: true,
        description: 'ML predictions for all candidates: [{cl, cd, cm, confidence, ...}]'
    },
    
    // QUBO formulation
    qubo: {
        n_variables: {
            type: Number,
            required: true
        },
        Q_matrix: {
            type: Array,
            description: 'QUBO matrix (can be omitted if large, store only metadata)'
        },
        surrogate_type: {
            type: String,
            enum: ['quadratic', 'linear', 'custom'],
            default: 'quadratic'
        },
        penalty_weight: {
            type: Number,
            default: 10.0,
            description: 'Constraint penalty weight'
        }
    },
    
    // Quantum solution
    quantumSolution: {
        method: {
            type: String,
            description: 'Method used (e.g., QAOA, Simulated Annealing, Genetic Algorithm)'
        },
        solution: {
            type: Array,
            required: true,
            description: 'Binary solution vector'
        },
        cost: {
            type: Number,
            description: 'QUBO cost/energy of solution'
        },
        energy: {
            type: Number,
            description: 'QUBO energy (deprecated, use cost)'
        },
        iterations: {
            type: Number,
            description: 'Classical optimizer iterations'
        },
        shots: {
            type: Number,
            description: 'Quantum circuit shots (QAOA only)'
        },
        p_layers: {
            type: Number,
            description: 'QAOA circuit depth (QAOA only)'
        },
        success: {
            type: Boolean,
            default: true,
            description: 'Whether optimization succeeded'
        }
    },
    
    // VLM validation results
    vlmValidation: {
        type: Array,
        default: [],
        description: 'Top-k VLM validation results: [{cl, cd, cm, ...}, ...]'
    },
    
    // Final selected result
    result: {
        design: {
            type: Object,
            required: true,
            description: 'Optimal design variable values'
        },
        performance: {
            cl: { type: Number },
            cd: { type: Number },
            cm: { type: Number, default: 0 },
            cl_ml: { type: Number },
            cd_ml: { type: Number },
            cm_ml: { type: Number },
            balance_proxy: { type: Number },
            stall_risk: { type: Number },
            composite_score: { type: Number },
            ld_ratio: { type: Number },
            balance: { type: Number }
        },
        validation: {
            ml_prediction: { type: Object },
            vlm_truth: { type: Object },
            error_pct: { type: Object },
            status: {
                type: String,
                enum: ['pass', 'fail', 'skipped'],
                default: 'pass'
            }
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            description: 'Overall confidence score [0-1]'
        }
    },
    
    // Performance metadata
    computeTimeMs: {
        type: Number,
        required: true,
        description: 'Total computation time in milliseconds'
    },
    
    timingBreakdown: {
        candidate_generation_ms: { type: Number, default: 0 },
        ml_prediction_ms: { type: Number, default: 0 },
        qubo_formulation_ms: { type: Number, default: 0 },
        quantum_solve_ms: { type: Number, default: 0 },
        vlm_validation_ms: { type: Number, default: 0 }
    },
    
    // Status tracking
    status: {
        type: String,
        enum: ['running', 'completed', 'failed', 'cancelled'],
        default: 'completed',
        index: true
    },
    
    // Error tracking
    error: {
        code: { type: String },
        message: { type: String },
        details: { type: Object }
    },
    
    warnings: {
        type: Array,
        default: [],
        description: 'Non-fatal warnings during optimization'
    },
    
    // User/session tracking
    userId: {
        type: String,
        index: true,
        description: 'User or session identifier'
    },
    
    tags: {
        type: [String],
        default: [],
        index: true,
        description: 'User-provided tags for filtering/search'
    },
    
    // Timestamps
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
        description: 'Run start timestamp'
    }
}, {
    collection: 'optimization_runs',
    timestamps: true  // Adds createdAt and updatedAt
});

// Indexes for common queries
optimizationRunSchema.index({ timestamp: -1 });
optimizationRunSchema.index({ userId: 1, timestamp: -1 });
optimizationRunSchema.index({ tags: 1, timestamp: -1 });
optimizationRunSchema.index({ status: 1, timestamp: -1 });
optimizationRunSchema.index({ 'result.performance.ld_ratio': -1 });

// Virtual for L/D ratio if not stored
optimizationRunSchema.virtual('result.performance.ld_ratio_computed').get(function() {
    if (this.result && this.result.performance) {
        const { cl, cd } = this.result.performance;
        if (cd > 1e-6) {
            return cl / cd;
        }
    }
    return null;
});

// Method to get summary (exclude large arrays)
optimizationRunSchema.methods.getSummary = function() {
    return {
        runId: this.runId,
        status: this.status,
        timestamp: this.timestamp,
        userId: this.userId,
        tags: this.tags,
        request: this.request,  // Include original request for auditing
        n_candidates: this.candidates.count,
        quantum_method: this.quantumSolution.method,
        result: {
            design: this.result.design,
            performance: this.result.performance,
            confidence: this.result.confidence
        },
        computeTimeMs: this.computeTimeMs,
        timingBreakdown: this.timingBreakdown
    };
};

// Static method to find recent runs
optimizationRunSchema.statics.findRecent = function(limit = 10, userId = null) {
    const query = userId ? { userId, status: 'completed' } : { status: 'completed' };
    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .select('runId timestamp userId tags result.performance computeTimeMs quantumSolution.method')
        .lean();
};

// Static method to find top performers
optimizationRunSchema.statics.findTopPerformers = function(limit = 10, metric = 'ld_ratio') {
    const sortField = `result.performance.${metric}`;
    return this.find({ status: 'completed' })
        .sort({ [sortField]: -1 })
        .limit(limit)
        .select('runId timestamp result.design result.performance tags')
        .lean();
};

module.exports = mongoose.model('OptimizationRun', optimizationRunSchema);
