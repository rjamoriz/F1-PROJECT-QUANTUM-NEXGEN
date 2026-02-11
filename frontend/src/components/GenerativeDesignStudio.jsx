/**
 * Generative Design Studio
 * Backend-driven aerodynamic candidate generation.
 */

import React, { useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { Sparkles, Zap, Download, Settings, Grid, Layers } from './lucideShim';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis } from 'recharts';

const API_BASE = BACKEND_API_BASE;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function withUiIds(candidates) {
  const stamp = Date.now();
  return candidates.map((candidate, idx) => ({
    ...candidate,
    id: `${candidate.id || `candidate-${idx + 1}`}-${stamp}-${idx}`,
  }));
}

const GenerativeDesignStudio = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [generationStats, setGenerationStats] = useState(null);
  const [error, setError] = useState(null);

  const [config, setConfig] = useState({
    target_cl: 2.8,
    target_cd: 0.4,
    target_cm: -0.1,
    volume: 0.5,
    thickness: 0.12,
    camber: 0.04,
    span: 2.0,
    chord: 1.0,
    num_inference_steps: 50,
    guidance_scale: 7.5,
  });

  const [optimizeConfig, setOptimizeConfig] = useState({
    target_cl: 2.8,
    target_cd: 0.4,
    target_cm: -0.1,
    num_candidates: 100,
  });

  const requestCandidates = async ({ numCandidates, targetCl, targetCd, targetCm }) => {
    const response = await axios.post(`${API_BASE}/api/simulation/candidates/generate`, {
      num_candidates: numCandidates,
      target_cl: targetCl,
      target_cd: targetCd,
      target_cm: targetCm,
      seed_limit: 30,
    });

    const payload = response?.data?.data || {};
    return {
      candidates: withUiIds(Array.isArray(payload.candidates) ? payload.candidates : []),
      stats: {
        num_generated: toFiniteNumber(payload.num_generated, 0),
        seed_count: toFiniteNumber(payload.seed_count, 0),
        target_cl: toFiniteNumber(payload.target_cl, targetCl),
        target_cd: toFiniteNumber(payload.target_cd, targetCd),
        target_cm: toFiniteNumber(payload.target_cm, targetCm),
      },
    };
  };

  const generateSingleDesign = async () => {
    setIsGenerating(true);
    try {
      const { candidates: generatedCandidates, stats } = await requestCandidates({
        numCandidates: 1,
        targetCl: config.target_cl,
        targetCd: config.target_cd,
        targetCm: config.target_cm,
      });
      if (generatedCandidates.length > 0) {
        const latest = generatedCandidates[0];
        setCandidates((prev) => [latest, ...prev].slice(0, 200));
        setSelectedCandidate(latest);
      }
      setGenerationStats(stats);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to generate design');
    } finally {
      setIsGenerating(false);
    }
  };

  const optimizeDesigns = async () => {
    setIsGenerating(true);
    try {
      const { candidates: generatedCandidates, stats } = await requestCandidates({
        numCandidates: toFiniteNumber(optimizeConfig.num_candidates, 100),
        targetCl: optimizeConfig.target_cl,
        targetCd: optimizeConfig.target_cd,
        targetCm: optimizeConfig.target_cm,
      });
      setCandidates(generatedCandidates);
      setSelectedCandidate(generatedCandidates[0] || null);
      setGenerationStats(stats);
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to optimize candidates');
    } finally {
      setIsGenerating(false);
    }
  };

  const exportToCAD = (candidate, format) => {
    // Export integration remains a UI contract until CAD kernel is wired.
    alert(`Export ${candidate.id} to ${format.toUpperCase()} requested.`);
  };

  const scatterData = candidates.map((candidate) => ({
    cl: toFiniteNumber(candidate.parameters?.cl, 0),
    cd: toFiniteNumber(candidate.parameters?.cd, 0),
    quality: toFiniteNumber(candidate.quality_score, 0),
    id: candidate.id,
  }));

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-purple-600" />
        Generative Design Studio
      </h2>

      <p className="text-gray-600 mb-6">
        Candidate generation is driven by existing simulation geometry and optimization outputs.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 p-4 bg-purple-50 rounded border border-purple-200">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Single Design Targets
        </h3>

        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">Target Cl</label>
            <input
              type="number"
              step="0.1"
              value={config.target_cl}
              onChange={(e) => setConfig({ ...config, target_cl: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border rounded"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Target Cd</label>
            <input
              type="number"
              step="0.01"
              value={config.target_cd}
              onChange={(e) => setConfig({ ...config, target_cd: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border rounded"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Target Cm</label>
            <input
              type="number"
              step="0.01"
              value={config.target_cm}
              onChange={(e) => setConfig({ ...config, target_cm: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border rounded"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Batch Candidates</label>
            <input
              type="number"
              value={optimizeConfig.num_candidates}
              onChange={(e) => setOptimizeConfig({ ...optimizeConfig, num_candidates: parseInt(e.target.value, 10) })}
              className="w-full px-3 py-2 border rounded"
              min="1"
              max="1000"
              disabled={isGenerating}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={generateSingleDesign}
            disabled={isGenerating}
            className={`px-6 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            {isGenerating ? 'Generating...' : 'Generate Single Design'}
          </button>

          <button
            onClick={optimizeDesigns}
            disabled={isGenerating}
            className={`px-6 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            <Zap className="w-5 h-5" />
            {isGenerating ? 'Optimizing...' : `Optimize ${optimizeConfig.num_candidates} Candidates`}
          </button>
        </div>
      </div>

      {generationStats && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded">
          <h3 className="font-semibold mb-2">Generation Results</h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><strong>Candidates:</strong> {generationStats.num_generated}</div>
            <div><strong>Seeds Used:</strong> {generationStats.seed_count}</div>
            <div><strong>Target Cl:</strong> {generationStats.target_cl.toFixed(2)}</div>
            <div><strong>Target Cd:</strong> {generationStats.target_cd.toFixed(3)}</div>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Grid className="w-5 h-5" />
            Design Space Exploration
          </h3>

          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="cl"
                name="Lift Coefficient"
                label={{ value: 'Cl', position: 'insideBottom', offset: -5 }}
              />
              <YAxis
                dataKey="cd"
                name="Drag Coefficient"
                label={{ value: 'Cd', angle: -90, position: 'insideLeft' }}
              />
              <ZAxis dataKey="quality" range={[50, 400]} name="Quality" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Legend />
              <Scatter
                name="Candidates"
                data={scatterData}
                fill="#8b5cf6"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Generated Candidates ({candidates.length})
          </h3>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Quality</th>
                  <th className="px-3 py-2 text-left">Cl</th>
                  <th className="px-3 py-2 text-left">Cd</th>
                  <th className="px-3 py-2 text-left">L/D</th>
                  <th className="px-3 py-2 text-left">Time (s)</th>
                  <th className="px-3 py-2 text-left">Seed Run</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 20).map((candidate, idx) => {
                  const cl = toFiniteNumber(candidate.parameters?.cl, 0);
                  const cd = toFiniteNumber(candidate.parameters?.cd, 0);
                  const ld = cd > 0 ? cl / cd : 0;

                  return (
                    <tr
                      key={candidate.id}
                      className={`border-t cursor-pointer hover:bg-purple-50 ${
                        selectedCandidate?.id === candidate.id ? 'bg-purple-100' : ''
                      }`}
                      onClick={() => setSelectedCandidate(candidate)}
                    >
                      <td className="px-3 py-2 font-semibold">#{candidate.rank || idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-purple-600 h-2 rounded-full"
                              style={{ width: `${toFiniteNumber(candidate.quality_score, 0) * 100}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs">
                            {(toFiniteNumber(candidate.quality_score, 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono">{cl.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{cd.toFixed(3)}</td>
                      <td className="px-3 py-2 font-mono">{ld.toFixed(1)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          toFiniteNumber(candidate.generation_time_s, 0) < 5
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {toFiniteNumber(candidate.generation_time_s, 0).toFixed(1)}s
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{candidate.seed_simulation_id || 'n/a'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); exportToCAD(candidate, 'stl'); }}
                            className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                            title="Export to STL"
                          >
                            STL
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); exportToCAD(candidate, 'step'); }}
                            className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200"
                            title="Export to STEP"
                          >
                            STEP
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedCandidate && (
        <div className="p-4 bg-indigo-50 rounded border border-indigo-200">
          <h3 className="font-semibold mb-3">Selected Candidate Details</h3>

          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="p-3 bg-white rounded border">
              <div className="text-xs text-gray-600">Quality Score</div>
              <div className="text-2xl font-bold text-purple-600">
                {(toFiniteNumber(selectedCandidate.quality_score, 0) * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-3 bg-white rounded border">
              <div className="text-xs text-gray-600">Generation Time</div>
              <div className="text-2xl font-bold text-blue-600">
                {toFiniteNumber(selectedCandidate.generation_time_s, 0).toFixed(1)}s
              </div>
            </div>
            <div className="p-3 bg-white rounded border">
              <div className="text-xs text-gray-600">Target Met</div>
              <div className={`text-2xl font-bold ${
                selectedCandidate.target_met ? 'text-green-600' : 'text-red-600'
              }`}>
                {selectedCandidate.target_met ? 'Yes' : 'No'}
              </div>
            </div>
            <div className="p-3 bg-white rounded border">
              <div className="text-xs text-gray-600">Resolution</div>
              <div className="text-lg font-bold text-gray-700">
                {selectedCandidate.shape?.join('x') || 'N/A'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Aerodynamic Parameters</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Lift Coefficient (Cl):</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.cl, 0).toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Drag Coefficient (Cd):</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.cd, 0).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Moment Coefficient (Cm):</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.cm, 0).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>L/D Ratio:</span>
                  <span className="font-mono">
                    {(toFiniteNumber(selectedCandidate.parameters?.l_over_d, 0)).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Geometric Parameters</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Camber:</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.camber, 0).toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Thickness:</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.thickness, 0).toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Span (m):</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.span, 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Chord (m):</span>
                  <span className="font-mono">{toFiniteNumber(selectedCandidate.parameters?.chord, 0).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => exportToCAD(selectedCandidate, 'stl')}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export STL
            </button>
            <button
              onClick={() => exportToCAD(selectedCandidate, 'step')}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export STEP
            </button>
            <button
              onClick={() => exportToCAD(selectedCandidate, 'iges')}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export IGES
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded border border-blue-200">
        <h3 className="font-semibold mb-2">Generation Targets</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <strong>Source:</strong> Recent simulation outputs
          </div>
          <div>
            <strong>Pipeline:</strong> Geometry + optimization informed proposals
          </div>
          <div>
            <strong>Export Formats:</strong> STL, STEP, IGES
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerativeDesignStudio;
