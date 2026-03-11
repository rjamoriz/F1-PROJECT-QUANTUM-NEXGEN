# API Contracts & Schemas

## Purpose

This directory contains **typed contracts** for inter-service communication across the Q-AERO microservices platform. All API requests/responses must validate against these JSON Schemas to prevent integration drift.

## Version

**Contract Version**: `v1.0.0`  
**Last Updated**: 2026-02-16

## Schema Files

### Core Optimization Contracts
- **AeroOptimizationRequest.schema.json**: Request payload for `/api/v1/aero/optimize`
- **AeroOptimizationResult.schema.json**: Response from optimization endpoint
- **AeroDesignSpace.schema.json**: Design space definition (variables, types, domains)
- **FlowConditions.schema.json**: Flow parameters (velocity, alpha, yaw, rho)

### Quantum Computing Contracts
- **QuboProblem.schema.json**: QUBO problem definition for quantum optimizer
- **CandidateEvaluation.schema.json**: ML/VLM evaluation results per candidate

## Usage

### Backend (Node.js) - AJV Validation

```javascript
const Ajv = require('ajv');
const ajv = new Ajv();

const requestSchema = require('../contracts/schemas/AeroOptimizationRequest.schema.json');
const validate = ajv.compile(requestSchema);

router.post('/optimize', (req, res) => {
    if (!validate(req.body)) {
        return res.status(400).json({
            error: 'Invalid request',
            details: validate.errors
        });
    }
    // Process valid request...
});
```

### Python Services - Pydantic Validation

```python
from pydantic import BaseModel, Field
from typing import List, Dict, Optional

class FlowConditions(BaseModel):
    """Matches FlowConditions.schema.json"""
    velocity: float = Field(..., gt=0, description="Freestream velocity [m/s]")
    alpha: float = Field(..., ge=-20, le=30, description="Angle of attack [degrees]")
    yaw: float = Field(0.0, ge=-15, le=15, description="Yaw angle [degrees]")
    rho: float = Field(1.225, gt=0, description="Air density [kg/m³]")
```

## Testing

All schemas are validated against **JSON Schema Draft-07** spec.

### Validate Schemas
```bash
npm install -g ajv-cli
ajv validate -s schemas/AeroOptimizationRequest.schema.json -d examples/optimization_request_example.json
```

### Test with Example Payloads
```bash
# Backend validation (Node.js)
cd services/backend
npm test -- contracts.test.js

# Python validation
pytest contracts/test_schemas.py
```

## Contract Changes

### Breaking Changes
Any change to `required` fields, type constraints, or removal of properties is **BREAKING** and requires:
1. Major version bump (v1 → v2)
2. Migration guide in `MIGRATIONS.md`
3. Support for both versions during transition period

### Non-Breaking Changes
Addition of optional fields or relaxing constraints is **NON-BREAKING**:
1. Minor version bump (v1.0 → v1.1)
2. Update changelog

## Examples

All schemas include example payloads in `/examples/` directory:
- `optimization_request_example.json`
- `qubo_problem_example.json`
- `design_space_front_wing_v1.json`

Use these for:
- Unit testing
- Integration testing
- API documentation
- curl/Postman examples

## Enforcement

**All new endpoints MUST**:
1. Define request/response contracts in this directory
2. Validate incoming requests against schemas
3. Include schema validation in unit tests
4. Document any deviations in comments

## Contact

Questions about contracts: Q-AERO Backend Team  
Schema issues: Open GitHub issue with `contracts` label
