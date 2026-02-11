/**
 * Trade-off Analysis Dashboard
 * Multi-objective optimization with Pareto frontier visualization.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';
import { TrendingUp, Target, AlertTriangle } from './lucideShim';

const API_BASE = BACKEND_API_BASE;

const DEFAULT_SUMMARY = {
  total_designs: 0,
  pareto_optimal: 0,
  feasible_designs: 0,
  infeasible_designs: 0,
};

const TradeoffAnalysisDashboard = () => {
  const [designs, setDesigns] = useState([]);
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [selectedDesign, setSelectedDesign] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [objectives, setObjectives] = useState({
    x: 'drag',
    y: 'downforce',
    z: 'flutter_margin',
  });

  const loadDesigns = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/simulation/pareto`, {
        params: {
          limit_runs: 40,
          max_points: 180,
        },
      });
      const payload = response?.data?.data || {};
      const incomingDesigns = Array.isArray(payload.designs) ? payload.designs : [];
      setDesigns(incomingDesigns);
      setSummary({
        ...DEFAULT_SUMMARY,
        ...(payload.summary || {}),
      });
      setSelectedDesign((previous) => (
        incomingDesigns.some((design) => design.id === previous?.id)
          ? previous
          : (incomingDesigns[0] || null)
      ));
      setError(null);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load Pareto dataset');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDesigns();
  }, [loadDesigns]);

  const scatterData = useMemo(() => (
    designs.map((design) => ({
      x: Number(design?.[objectives.x] ?? 0),
      y: Number(design?.[objectives.y] ?? 0),
      z: Number(design?.[objectives.z] ?? 0),
      name: design.name,
      isParetoOptimal: Boolean(design.isParetoOptimal),
      feasible: Boolean(design.feasible),
      design,
    }))
  ), [designs, objectives]);

  const paretoDesigns = designs.filter((design) => design.isParetoOptimal && design.feasible);
  const feasibleDesigns = designs.filter((design) => design.feasible);
  const infeasibleDesigns = designs.filter((design) => !design.feasible);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border-2 border-gray-300 rounded shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm">Drag: {data.x.toFixed(3)}</p>
          <p className="text-sm">Downforce: {data.y.toFixed(2)}</p>
          <p className="text-sm">Objective Z: {data.z.toFixed(2)}</p>
          <p className={`text-sm font-bold ${data.isParetoOptimal ? 'text-green-600' : 'text-gray-600'}`}>
            {data.isParetoOptimal ? 'Pareto Optimal' : 'Non-optimal'}
          </p>
          <p className={`text-sm ${data.feasible ? 'text-green-600' : 'text-red-600'}`}>
            {data.feasible ? 'Feasible' : 'Infeasible'}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <TrendingUp className="w-6 h-6" />
        Trade-off Analysis Dashboard
      </h2>

      <p className="text-gray-600 mb-6">
        Pareto frontier built from recent simulation outputs, including feasibility and optimization provenance.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={loadDesigns}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh Pareto Data'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm text-blue-700">Total Designs</div>
          <div className="text-2xl font-bold text-blue-900">{summary.total_designs || designs.length}</div>
        </div>
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="text-sm text-green-700">Pareto Optimal</div>
          <div className="text-2xl font-bold text-green-900">{summary.pareto_optimal || paretoDesigns.length}</div>
        </div>
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
          <div className="text-sm text-yellow-700">Feasible</div>
          <div className="text-2xl font-bold text-yellow-900">{summary.feasible_designs || feasibleDesigns.length}</div>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <div className="text-sm text-red-700">Infeasible</div>
          <div className="text-2xl font-bold text-red-900">{summary.infeasible_designs || infeasibleDesigns.length}</div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Select Objectives</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">X-Axis</label>
            <select
              value={objectives.x}
              onChange={(e) => setObjectives({ ...objectives, x: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="drag">Drag (Cd)</option>
              <option value="downforce">Downforce (Cl proxy)</option>
              <option value="mass">Mass (kg)</option>
              <option value="L_D">L/D Ratio</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Y-Axis</label>
            <select
              value={objectives.y}
              onChange={(e) => setObjectives({ ...objectives, y: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="downforce">Downforce (Cl proxy)</option>
              <option value="drag">Drag (Cd)</option>
              <option value="mass">Mass (kg)</option>
              <option value="L_D">L/D Ratio</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Color (Z)</label>
            <select
              value={objectives.z}
              onChange={(e) => setObjectives({ ...objectives, z: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="flutter_margin">Flutter Margin</option>
              <option value="mass">Mass (kg)</option>
              <option value="L_D">L/D Ratio</option>
              <option value="selected_ratio">Selected Node Ratio</option>
            </select>
          </div>
        </div>
      </div>

      {designs.length > 0 ? (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
          <h3 className="font-semibold mb-3">Pareto Frontier</h3>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name={objectives.x}
                label={{ value: objectives.x.replace('_', ' ').toUpperCase(), position: 'insideBottom', offset: -10 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={objectives.y}
                label={{ value: objectives.y.replace('_', ' ').toUpperCase(), angle: -90, position: 'insideLeft' }}
              />
              <ZAxis type="number" dataKey="z" range={[50, 400]} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />

              <Scatter
                name="Infeasible"
                data={scatterData.filter((d) => !d.feasible)}
                fill="#ef4444"
                opacity={0.35}
              />

              <Scatter
                name="Feasible"
                data={scatterData.filter((d) => d.feasible && !d.isParetoOptimal)}
                fill="#3b82f6"
                opacity={0.55}
              />

              <Scatter
                name="Pareto Optimal"
                data={scatterData.filter((d) => d.isParetoOptimal && d.feasible)}
                fill="#10b981"
                shape="star"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200 text-sm text-gray-600">
          No simulation-derived design points yet. Run at least one coupled simulation to populate this view.
        </div>
      )}

      <div className="mb-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Target className="w-5 h-5 text-green-600" />
          Pareto Optimal Designs
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-green-50 border-b-2 border-green-200">
              <tr>
                <th className="px-4 py-2 text-left">Design</th>
                <th className="px-4 py-2 text-right">Drag (Cd)</th>
                <th className="px-4 py-2 text-right">Downforce</th>
                <th className="px-4 py-2 text-right">L/D</th>
                <th className="px-4 py-2 text-right">Flutter Margin</th>
                <th className="px-4 py-2 text-right">Mass (kg)</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {paretoDesigns.slice(0, 12).map((design) => (
                <tr
                  key={design.id}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedDesign(design)}
                >
                  <td className="px-4 py-2 font-medium">{design.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(design.drag || 0).toFixed(3)}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(design.downforce || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(design.L_D || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    <span className={Number(design.flutter_margin || 0) >= 1.5 ? 'text-green-600 font-bold' : 'text-yellow-600'}>
                      {Number(design.flutter_margin || 0).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{Number(design.mass || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                      Optimal
                    </span>
                  </td>
                </tr>
              ))}
              {paretoDesigns.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-600" colSpan={7}>
                    No feasible Pareto points available for the selected dataset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDesign && (
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded text-sm">
          <h3 className="font-semibold mb-2">Selected Design</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><strong>ID:</strong> {selectedDesign.id}</div>
            <div><strong>Source:</strong> {selectedDesign.source}</div>
            <div><strong>Simulation:</strong> {selectedDesign.simulation_id}</div>
            <div><strong>Status:</strong> {selectedDesign.status}</div>
          </div>
        </div>
      )}

      <div className="p-4 bg-purple-50 border border-purple-200 rounded">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-purple-600" />
          Recommendations
        </h3>
        <div className="space-y-2 text-sm">
          <p><strong>Monaco/high-downforce setup:</strong> prioritize top downforce with flutter margin at or above 1.2.</p>
          <p><strong>Monza/low-drag setup:</strong> prioritize drag minimization while preserving acceptable downforce balance.</p>
          <p><strong>Validation gate:</strong> treat low flutter margin and high mass points as candidates requiring extra CFD and structural checks.</p>
        </div>
      </div>
    </div>
  );
};

export default TradeoffAnalysisDashboard;
