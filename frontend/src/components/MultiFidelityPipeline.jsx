/**
 * Multi-Fidelity Pipeline Component
 * Visualizes automatic escalation: Surrogate -> VLM -> coupled high-fidelity run
 */

import React, { useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { ArrowRight, Zap, Cpu, Server, AlertTriangle } from './lucideShim';

const API_BASE = BACKEND_API_BASE;

const MultiFidelityPipeline = () => {
  const [evaluation, setEvaluation] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  const [config, setConfig] = useState({
    meshId: 'wing_v3.2',
    velocity: 250,
    yaw: 3.0,
    confidenceThreshold: 0.9,
    autoEscalate: true,
  });

  const runEvaluation = async () => {
    setIsRunning(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE}/api/multi-fidelity/evaluate`, config);
      const payload = response?.data?.data || response?.data;
      setEvaluation(payload);
    } catch (requestError) {
      setError(requestError?.response?.data?.error?.message || requestError?.message || 'Multi-fidelity evaluation failed');
      setEvaluation(null);
    } finally {
      setIsRunning(false);
    }
  };

  const getStageIcon = (name) => {
    if (name.includes('Low-Fidelity')) return <Zap className="w-6 h-6" />;
    if (name.includes('Medium-Fidelity')) return <Cpu className="w-6 h-6" />;
    if (name.includes('High-Fidelity')) return <Server className="w-6 h-6" />;
    return null;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'running':
        return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'skipped':
        return 'bg-gray-100 border-gray-300 text-gray-600';
      case 'failed':
        return 'bg-red-100 border-red-300 text-red-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-600';
    }
  };

  const getDecisionBadge = (decision) => {
    switch (decision) {
      case 'ACCEPT':
        return <span className="px-3 py-1 bg-green-600 text-white rounded-full text-sm font-semibold">ACCEPT</span>;
      case 'ESCALATE':
        return <span className="px-3 py-1 bg-yellow-600 text-white rounded-full text-sm font-semibold">ESCALATE</span>;
      case 'SKIPPED':
        return <span className="px-3 py-1 bg-gray-400 text-white rounded-full text-sm font-semibold">SKIPPED</span>;
      case 'REJECT':
        return <span className="px-3 py-1 bg-red-600 text-white rounded-full text-sm font-semibold">REJECT</span>;
      default:
        return null;
    }
  };

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '-';
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    return `${(seconds / 60).toFixed(2)}m`;
  };

  const stages = Array.isArray(evaluation?.stages) ? evaluation.stages : [];
  const finalResult = evaluation?.finalResult || null;

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Multi-Fidelity Pipeline</h2>

      <p className="text-gray-600 mb-6">
        Automatic escalation from fast ML surrogate to VLM and coupled high-fidelity simulation using confidence gates.
      </p>

      <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Configuration</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Mesh ID</label>
            <input
              type="text"
              value={config.meshId}
              onChange={(e) => setConfig({ ...config, meshId: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Velocity (km/h)</label>
            <input
              type="number"
              value={config.velocity}
              onChange={(e) => setConfig({ ...config, velocity: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Yaw Angle (deg)</label>
            <input
              type="number"
              step="0.1"
              value={config.yaw}
              onChange={(e) => setConfig({ ...config, yaw: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confidence Threshold</label>
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="0.99"
              value={config.confidenceThreshold}
              onChange={(e) => setConfig({ ...config, confidenceThreshold: parseFloat(e.target.value) || 0.9 })}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.autoEscalate}
              onChange={(e) => setConfig({ ...config, autoEscalate: e.target.checked })}
              className="mr-2"
            />
            <span className="text-sm">Auto-escalate on low confidence</span>
          </label>
        </div>
      </div>

      <button
        onClick={runEvaluation}
        disabled={isRunning}
        className={`w-full px-6 py-3 rounded font-semibold mb-6 ${
          isRunning
            ? 'bg-gray-400 cursor-not-allowed text-white'
            : 'bg-purple-600 hover:bg-purple-700 text-white'
        }`}
      >
        {isRunning ? 'Running Evaluation...' : 'Run Multi-Fidelity Evaluation'}
      </button>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {String(error)}
        </div>
      )}

      {evaluation && (
        <div className="space-y-4">
          <div className="relative">
            {stages.map((stage, idx) => (
              <div key={idx}>
                <div className={`p-4 rounded-lg border-2 ${getStatusColor(stage.status)} mb-4`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {getStageIcon(stage.name)}
                      <div>
                        <h4 className="font-semibold text-lg">{stage.name}</h4>
                        <p className="text-sm opacity-75">{stage.reason}</p>
                      </div>
                    </div>
                    {getDecisionBadge(stage.decision)}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Status:</span>
                      <span className="ml-2 capitalize">{stage.status}</span>
                    </div>
                    {stage.confidence !== null && (
                      <div>
                        <span className="font-medium">Confidence:</span>
                        <span className={`ml-2 font-bold ${
                          stage.confidence >= config.confidenceThreshold ? 'text-green-600' : 'text-yellow-700'
                        }`}>
                          {(stage.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {stage.time !== null && (
                      <div>
                        <span className="font-medium">Time:</span>
                        <span className="ml-2">{formatTime(stage.time)}</span>
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Cost:</span>
                      <span className="ml-2">${Number(stage.cost || 0).toFixed(3)}</span>
                    </div>
                  </div>

                  {stage.results && (
                    <div className="mt-3 p-3 bg-white rounded border">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="font-medium">Cl:</span>
                          <span className="ml-2 font-mono">{Number(stage.results.Cl || 0).toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="font-medium">Cd:</span>
                          <span className="ml-2 font-mono">{Number(stage.results.Cd || 0).toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="font-medium">L/D:</span>
                          <span className="ml-2 font-mono">{Number(stage.results.L_D || 0).toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {idx < stages.length - 1 && (
                  <div className="flex justify-center mb-4">
                    <ArrowRight className="w-6 h-6 text-gray-400" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {finalResult && (
            <div className="p-4 bg-purple-50 border-2 border-purple-300 rounded-lg">
              <h3 className="font-semibold text-lg mb-3 text-purple-900">Final Result</h3>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="p-3 bg-white rounded">
                  <div className="text-sm text-gray-600">Fidelity Level</div>
                  <div className="text-xl font-bold capitalize">{finalResult.fidelityLevel}</div>
                </div>
                <div className="p-3 bg-white rounded">
                  <div className="text-sm text-gray-600">Total Time</div>
                  <div className="text-xl font-bold">{formatTime(Number(finalResult.totalTime || 0))}</div>
                </div>
                <div className="p-3 bg-white rounded">
                  <div className="text-sm text-gray-600">Total Cost</div>
                  <div className="text-xl font-bold">${Number(finalResult.totalCost || 0).toFixed(3)}</div>
                </div>
                <div className="p-3 bg-white rounded">
                  <div className="text-sm text-gray-600">Validated</div>
                  <div className="text-xl font-bold">
                    {finalResult.validated ? (
                      <span className="text-green-600">Yes</span>
                    ) : (
                      <span className="text-red-600">No</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-white rounded">
                <div className="text-sm font-medium text-gray-700 mb-2">Aerodynamic Coefficients</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <span className="text-gray-600">Cl:</span>
                    <span className="ml-2 font-mono font-bold">{Number(finalResult.Cl || 0).toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Cd:</span>
                    <span className="ml-2 font-mono font-bold">{Number(finalResult.Cd || 0).toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">L/D:</span>
                    <span className="ml-2 font-mono font-bold">{Number(finalResult.L_D || 0).toFixed(4)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 p-3 bg-purple-100 rounded text-sm">
                <strong>Recommendation:</strong> {evaluation.recommendation}
              </div>
            </div>
          )}

          <div className="p-4 bg-gray-50 rounded border border-gray-200">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Pipeline Economics
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Low-Fidelity (ML Surrogate):</span>
                <span className="font-mono">~0.001 USD</span>
              </div>
              <div className="flex justify-between">
                <span>Medium-Fidelity (VLM):</span>
                <span className="font-mono">~0.100 USD</span>
              </div>
              <div className="flex justify-between">
                <span>High-Fidelity (Coupled Simulation):</span>
                <span className="font-mono">~10.000 USD</span>
              </div>
              <div className="pt-2 border-t border-gray-300 flex justify-between font-bold">
                <span>Actual This Run:</span>
                <span className="font-mono text-green-700">
                  {finalResult ? `${formatTime(Number(finalResult.totalTime || 0))}, $${Number(finalResult.totalCost || 0).toFixed(3)}` : 'n/a'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiFidelityPipeline;
