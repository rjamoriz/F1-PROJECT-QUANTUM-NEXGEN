/**
 * VLM (Vortex Lattice Method) Visualization
 * Displays lattice nodes, local drag/lift contributions, and quantum-selected nodes.
 * Also supports direct coupled quantum+CFD runs for iteration analytics.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line as ReLine,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Grid3x3, LoaderCircle, Wind } from './lucideShim';

const API_BASE = BACKEND_API_BASE;
const DEFAULT_PANELS_X = 20;
const DEFAULT_PANELS_Y = 10;

const metricRanges = {
  lift: { min: -1, max: 1 },
  drag: { min: 0, max: 1 },
  cp: { min: -2, max: 1 },
  gamma: { min: -1, max: 1 },
};

function normalize(value, min, max) {
  if (max - min < 1e-9) {
    return 0.5;
  }
  return (value - min) / (max - min);
}

function colorFromValue(value, min, max) {
  const t = Math.max(0, Math.min(1, normalize(value, min, max)));
  return new THREE.Color().setHSL(0.62 - 0.62 * t, 0.95, 0.48);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildClientNodeAnalytics(nodes = [], selectedNodeIds = []) {
  if (!nodes.length) {
    return [];
  }

  const selectedSet = new Set(selectedNodeIds);
  const groups = new Map();

  nodes.forEach((node) => {
    const spanIndex = Number.isFinite(Number(node.span_index)) ? Number(node.span_index) : 0;
    const current = groups.get(spanIndex) || {
      span_index: spanIndex,
      nodes: 0,
      selected_nodes: 0,
      total_lift: 0,
      total_drag: 0,
    };

    current.nodes += 1;
    current.total_lift += Number(node.lift || 0);
    current.total_drag += Math.abs(Number(node.drag || 0));
    if (selectedSet.has(node.node_id)) {
      current.selected_nodes += 1;
    }

    groups.set(spanIndex, current);
  });

  return Array.from(groups.values())
    .sort((a, b) => a.span_index - b.span_index)
    .map((bucket) => ({
      span_index: bucket.span_index,
      avg_lift: bucket.nodes > 0 ? bucket.total_lift / bucket.nodes : 0,
      avg_drag: bucket.nodes > 0 ? bucket.total_drag / bucket.nodes : 0,
      selected_ratio: bucket.nodes > 0 ? bucket.selected_nodes / bucket.nodes : 0,
    }));
}

const ForceNodes = ({ nodes, metric, range, selectedNodeIds, showOnlySelected }) => {
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  return (
    <group>
      {nodes.map((node) => {
        const nodeMetric = Number(node[metric] || 0);
        const isSelected = selectedSet.has(node.node_id);

        if (showOnlySelected && !isSelected) {
          return null;
        }

        const baseColor = colorFromValue(nodeMetric, range.min, range.max);
        const radius = isSelected ? 0.03 : 0.02;

        return (
          <mesh
            key={node.node_id}
            position={node.position}
          >
            <sphereGeometry args={[radius, 16, 16]} />
            <meshStandardMaterial color={isSelected ? '#facc15' : baseColor} />
          </mesh>
        );
      })}
    </group>
  );
};

const ForceVectors = ({ nodes, scale = 0.0008 }) => (
  <group>
    {nodes.map((node) => {
      const start = new THREE.Vector3(...node.position);
      const force = node.force_vector || [0, 0, 0];
      const end = start.clone().add(new THREE.Vector3(force[0], force[1], force[2]).multiplyScalar(scale));

      return (
        <Line
          key={`vec-${node.node_id}`}
          points={[start, end]}
          color="#4ecdc4"
          lineWidth={1}
        />
      );
    })}
  </group>
);

const LatticeLinks = ({ nodes }) => {
  const nodeMap = useMemo(() => {
    const map = new Map();
    nodes.forEach((node) => {
      map.set(`${node.span_index}:${node.chord_index}`, node);
    });
    return map;
  }, [nodes]);

  const links = useMemo(() => {
    const lines = [];
    nodes.forEach((node) => {
      const right = nodeMap.get(`${node.span_index}:${node.chord_index + 1}`);
      const up = nodeMap.get(`${node.span_index + 1}:${node.chord_index}`);

      if (right) {
        lines.push([new THREE.Vector3(...node.position), new THREE.Vector3(...right.position)]);
      }
      if (up) {
        lines.push([new THREE.Vector3(...node.position), new THREE.Vector3(...up.position)]);
      }
    });
    return lines;
  }, [nodes, nodeMap]);

  return (
    <group>
      {links.map((points, idx) => (
        <Line
          key={`link-${idx}`}
          points={points}
          color="#94a3b8"
          lineWidth={1}
        />
      ))}
    </group>
  );
};

const VLMVisualization = () => {
  const [vlmData, setVlmData] = useState(null);
  const [quantumSelection, setQuantumSelection] = useState(null);
  const [coupledResult, setCoupledResult] = useState(null);
  const [coupledStatus, setCoupledStatus] = useState('idle');
  const [coupledError, setCoupledError] = useState(null);

  const [metric, setMetric] = useState('lift');
  const [showVectors, setShowVectors] = useState(false);
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  const [parameters, setParameters] = useState({
    velocity: 72,
    alpha: 4.5,
    yaw: 0.5,
    span: 1.2,
    chord: 0.28,
    sweep: 6,
    twist: -1,
  });

  const [couplingConfig, setCouplingConfig] = useState({
    iterations: 6,
    useCfdAdapter: true,
    useQuantum: true,
    useMlSurrogate: true,
    maxNodes: 24,
  });

  const loadVLMData = useCallback(async () => {
    try {
      const response = await axios.post(`${API_BASE}/api/physics/vlm/solve`, {
        geometry: {
          span: parameters.span,
          chord: parameters.chord,
          twist: parameters.twist,
          dihedral: 0,
          sweep: parameters.sweep,
          taper_ratio: 0.75,
        },
        velocity: parameters.velocity,
        alpha: parameters.alpha,
        yaw: parameters.yaw,
        rho: 1.225,
        n_panels_x: DEFAULT_PANELS_X,
        n_panels_y: DEFAULT_PANELS_Y,
      });

      setVlmData(response.data?.data || null);
      setCoupledResult(null);
      setCoupledError(null);
    } catch (error) {
      console.error('Failed to load VLM data:', error);
      setVlmData(null);
    }
  }, [parameters]);

  useEffect(() => {
    loadVLMData();
  }, [loadVLMData]);

  const displayedNodes = useMemo(
    () => coupledResult?.visualizations?.vlm_nodes || vlmData?.lattice_nodes || [],
    [coupledResult, vlmData]
  );

  const optimizeNodes = async () => {
    if (!displayedNodes.length) {
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/api/quantum/optimize-vlm-nodes`, {
        nodes: displayedNodes,
        use_quantum: true,
        weights: {
          drag: 1.0,
          lift: 1.0,
          max_nodes: couplingConfig.maxNodes,
        },
      });

      setQuantumSelection(response.data?.data || null);
    } catch (error) {
      console.error('Quantum node optimization failed:', error);
      setQuantumSelection(null);
    }
  };

  const runCoupledLoop = async () => {
    setCoupledStatus('running');
    setCoupledError(null);

    try {
      const response = await axios.post(`${API_BASE}/api/simulation/run`, {
        geometry: {
          span: parameters.span,
          chord: parameters.chord,
          twist: parameters.twist,
          dihedral: 0,
          sweep: parameters.sweep,
          taper_ratio: 0.75,
        },
        conditions: {
          velocity: parameters.velocity,
          alpha: parameters.alpha,
          yaw: parameters.yaw,
          rho: 1.225,
          n_panels_x: DEFAULT_PANELS_X,
          n_panels_y: DEFAULT_PANELS_Y,
        },
        optimization: true,
        use_quantum: couplingConfig.useQuantum,
        use_ml_surrogate: couplingConfig.useMlSurrogate,
        use_cfd_adapter: couplingConfig.useCfdAdapter,
        coupling_iterations: couplingConfig.iterations,
        optimization_weights: {
          drag: 1.0,
          lift: 1.0,
          max_nodes: couplingConfig.maxNodes,
        },
      });

      const data = response.data?.data || null;
      setCoupledResult(data);
      setCoupledStatus('completed');

      const activeNodes = data?.optimization?.quantum?.active_nodes || [];
      if (activeNodes.length) {
        setQuantumSelection((prev) => ({
          ...(prev || {}),
          selected_nodes: activeNodes,
          metrics: {
            ...(prev?.metrics || {}),
            selected_count: activeNodes.length,
            total_nodes: data?.visualizations?.vlm_nodes?.length || displayedNodes.length,
          },
        }));
      }
    } catch (error) {
      console.error('Coupled simulation failed:', error);
      setCoupledStatus('error');
      setCoupledError(error?.response?.data?.error?.message || error.message || 'Unknown coupled simulation error');
    }
  };

  const coupledSelectedNodeIds = useMemo(
    () => (coupledResult?.optimization?.quantum?.active_nodes || []).map((node) => node.node_id),
    [coupledResult]
  );

  const selectedNodeIds = useMemo(() => {
    const explicitSelection = (quantumSelection?.selected_nodes || []).map((node) => node.node_id);
    return Array.from(new Set([...explicitSelection, ...coupledSelectedNodeIds]));
  }, [quantumSelection, coupledSelectedNodeIds]);

  const nodeAnalytics = coupledResult?.visualizations?.node_analytics || null;

  const dynamicRange = useMemo(() => {
    if (!displayedNodes.length) {
      return metricRanges[metric];
    }

    const values = displayedNodes.map((node) => Number(node[metric] || 0));
    const min = Math.min(...values);
    const max = Math.max(...values);

    if (Math.abs(max - min) < 1e-9) {
      return metricRanges[metric];
    }

    return { min, max };
  }, [displayedNodes, metric]);

  const topNodes = useMemo(
    () => [...displayedNodes]
      .sort((a, b) => ((b.lift || 0) - Math.abs(b.drag || 0)) - ((a.lift || 0) - Math.abs(a.drag || 0)))
      .slice(0, 10),
    [displayedNodes]
  );

  const couplingHistory = useMemo(
    () => coupledResult?.optimization?.coupling_history || [],
    [coupledResult]
  );
  const couplingChartData = useMemo(
    () => couplingHistory.map((point) => ({
      iteration: point.iteration,
      cl: Number(point.cl || 0),
      cd: Number(point.cd || 0),
      l_over_d: Number(point.l_over_d || 0),
      residual_l2: Number.isFinite(point.residual_l2) ? Number(point.residual_l2) : null,
      selected_nodes: Number(point.selected_nodes || 0),
    })),
    [couplingHistory]
  );

  const cfdRuns = coupledResult?.cfd?.runs || [];
  const baselineProxy = coupledResult?.baseline?.cfd_proxy;
  const optimizedProxy = coupledResult?.optimization?.cfd_proxy_optimized || coupledResult?.optimization?.optimized_metrics;

  const selectedCount = selectedNodeIds.length;
  const totalNodeCount = displayedNodes.length;
  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const nodeScatterData = useMemo(
    () => displayedNodes.map((node) => ({
      node_id: node.node_id,
      lift: Number(node.lift || 0),
      drag: Math.abs(Number(node.drag || 0)),
      selected: selectedNodeSet.has(node.node_id) ? 1 : 0,
    })),
    [displayedNodes, selectedNodeSet]
  );

  const spanwiseChartData = useMemo(() => {
    if (Array.isArray(nodeAnalytics?.spanwise_distribution) && nodeAnalytics.spanwise_distribution.length > 0) {
      return nodeAnalytics.spanwise_distribution.map((bucket) => ({
        span_index: bucket.span_index,
        avg_lift: Number(bucket.avg_lift || 0),
        avg_drag: Number(bucket.avg_drag || 0),
        selected_ratio: Number(bucket.selected_ratio || 0),
      }));
    }
    return buildClientNodeAnalytics(displayedNodes, selectedNodeIds);
  }, [nodeAnalytics, displayedNodes, selectedNodeIds]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Grid3x3 className="w-6 h-6" />
        VLM Node Force + Quantum-CFD Coupling Visualization
      </h2>

      <p className="text-sm text-gray-600 mb-4">
        Vortex lattice nodes are colored by local aerodynamic metric. Selected nodes can be optimized with QUBO and
        validated through coupled CFD iterations.
      </p>

      <div className="mb-4 grid grid-cols-2 md:grid-cols-7 gap-3 text-sm">
        <div>
          <label className="block mb-1">Velocity (m/s)</label>
          <input
            type="number"
            value={parameters.velocity}
            onChange={(e) => setParameters({ ...parameters, velocity: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Alpha (deg)</label>
          <input
            type="number"
            step="0.1"
            value={parameters.alpha}
            onChange={(e) => setParameters({ ...parameters, alpha: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Yaw (deg)</label>
          <input
            type="number"
            step="0.1"
            value={parameters.yaw}
            onChange={(e) => setParameters({ ...parameters, yaw: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Span (m)</label>
          <input
            type="number"
            step="0.05"
            value={parameters.span}
            onChange={(e) => setParameters({ ...parameters, span: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Chord (m)</label>
          <input
            type="number"
            step="0.01"
            value={parameters.chord}
            onChange={(e) => setParameters({ ...parameters, chord: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Sweep (deg)</label>
          <input
            type="number"
            step="0.5"
            value={parameters.sweep}
            onChange={(e) => setParameters({ ...parameters, sweep: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
        <div>
          <label className="block mb-1">Twist (deg)</label>
          <input
            type="number"
            step="0.5"
            value={parameters.twist}
            onChange={(e) => setParameters({ ...parameters, twist: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1 border rounded"
          />
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-50 border rounded grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <div>
          <label className="block mb-1">Coupling Iterations</label>
          <input
            type="number"
            value={couplingConfig.iterations}
            onChange={(e) => setCouplingConfig({
              ...couplingConfig,
              iterations: clamp(parseInt(e.target.value, 10) || 1, 1, 20),
            })}
            min="1"
            max="20"
            className="w-full px-2 py-1 border rounded"
          />
        </div>

        <div>
          <label className="block mb-1">Max Nodes</label>
          <input
            type="number"
            value={couplingConfig.maxNodes}
            onChange={(e) => setCouplingConfig({
              ...couplingConfig,
              maxNodes: clamp(parseInt(e.target.value, 10) || 8, 8, 40),
            })}
            min="8"
            max="40"
            className="w-full px-2 py-1 border rounded"
          />
        </div>

        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={couplingConfig.useCfdAdapter}
            onChange={(e) => setCouplingConfig({ ...couplingConfig, useCfdAdapter: e.target.checked })}
          />
          Use CFD Adapter
        </label>

        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={couplingConfig.useQuantum}
            onChange={(e) => setCouplingConfig({ ...couplingConfig, useQuantum: e.target.checked })}
          />
          Use Quantum Solver
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <button
          onClick={loadVLMData}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Recompute VLM
        </button>
        <button
          onClick={optimizeNodes}
          disabled={!displayedNodes.length}
          className={`px-4 py-2 rounded ${displayedNodes.length ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
        >
          Quantum Optimize Nodes
        </button>
        <button
          onClick={runCoupledLoop}
          disabled={coupledStatus === 'running'}
          className={`px-4 py-2 rounded flex items-center gap-2 ${
            coupledStatus === 'running'
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {coupledStatus === 'running' && <LoaderCircle className="w-4 h-4 animate-spin" />}
          Run Coupled Quantum + CFD
        </button>

        <div className="flex items-center gap-2 px-3 py-2 border rounded">
          <Wind className="w-4 h-4" />
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="border-none bg-transparent"
          >
            <option value="lift">Lift</option>
            <option value="drag">Drag</option>
            <option value="cp">Pressure (Cp)</option>
            <option value="gamma">Circulation (Gamma)</option>
          </select>
        </div>

        <label className="flex items-center gap-2 px-3 py-2 border rounded">
          <input
            type="checkbox"
            checked={showVectors}
            onChange={(e) => setShowVectors(e.target.checked)}
          />
          Force vectors
        </label>

        <label className="flex items-center gap-2 px-3 py-2 border rounded">
          <input
            type="checkbox"
            checked={showOnlySelected}
            onChange={(e) => setShowOnlySelected(e.target.checked)}
          />
          Show selected only
        </label>
      </div>

      {coupledError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Coupled simulation failed: {String(coupledError)}
        </div>
      )}

      <div className="mb-4 bg-gray-900 rounded-lg" style={{ height: '520px' }}>
        <Canvas camera={{ position: [2.8, 1.8, 2.8], fov: 50 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 10, 8]} intensity={1.0} />

          <LatticeLinks nodes={displayedNodes} />
          <ForceNodes
            nodes={displayedNodes}
            metric={metric}
            range={dynamicRange}
            selectedNodeIds={selectedNodeIds}
            showOnlySelected={showOnlySelected}
          />
          {showVectors && <ForceVectors nodes={displayedNodes} />}

          <gridHelper args={[5, 20]} />
          <axesHelper args={[1.5]} />
          <OrbitControls />
        </Canvas>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="text-xs text-blue-700 uppercase">CL</div>
          <div className="text-2xl font-bold text-blue-900">
            {coupledResult?.baseline?.vlm?.cl?.toFixed?.(4) ?? vlmData?.cl?.toFixed?.(4) ?? 'n/a'}
          </div>
        </div>
        <div className="p-3 bg-green-50 border border-green-200 rounded">
          <div className="text-xs text-green-700 uppercase">CD</div>
          <div className="text-2xl font-bold text-green-900">
            {coupledResult?.baseline?.vlm?.cd?.toFixed?.(4) ?? vlmData?.cd?.toFixed?.(4) ?? 'n/a'}
          </div>
        </div>
        <div className="p-3 bg-purple-50 border border-purple-200 rounded">
          <div className="text-xs text-purple-700 uppercase">L/D</div>
          <div className="text-2xl font-bold text-purple-900">
            {coupledResult?.baseline?.vlm?.l_over_d?.toFixed?.(3) ?? vlmData?.l_over_d?.toFixed?.(3) ?? 'n/a'}
          </div>
        </div>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded">
          <div className="text-xs text-amber-700 uppercase">Quantum Selected</div>
          <div className="text-2xl font-bold text-amber-900">
            {selectedCount}/{totalNodeCount}
          </div>
        </div>

        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded">
          <div className="text-xs text-cyan-700 uppercase">Lift-Drag Corr</div>
          <div className="text-2xl font-bold text-cyan-900">
            {Number.isFinite(nodeAnalytics?.lift_drag_correlation)
              ? Number(nodeAnalytics.lift_drag_correlation).toFixed(3)
              : 'n/a'}
          </div>
        </div>
      </div>

      {(baselineProxy || optimizedProxy) && (
        <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded">
          <h3 className="font-semibold mb-2 text-indigo-800">Coupled CFD Proxy Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-white border rounded">
              <div className="text-xs uppercase text-gray-500 mb-1">Baseline</div>
              <div>CL: <strong>{baselineProxy?.cl?.toFixed?.(4) ?? 'n/a'}</strong></div>
              <div>CD: <strong>{baselineProxy?.cd?.toFixed?.(4) ?? 'n/a'}</strong></div>
              <div>L/D: <strong>{baselineProxy?.l_over_d?.toFixed?.(4) ?? 'n/a'}</strong></div>
            </div>
            <div className="p-3 bg-white border rounded">
              <div className="text-xs uppercase text-gray-500 mb-1">Optimized</div>
              <div>CL: <strong>{optimizedProxy?.cl?.toFixed?.(4) ?? 'n/a'}</strong></div>
              <div>CD: <strong>{optimizedProxy?.cd?.toFixed?.(4) ?? 'n/a'}</strong></div>
              <div>L/D: <strong>{optimizedProxy?.l_over_d?.toFixed?.(4) ?? 'n/a'}</strong></div>
            </div>
          </div>
        </div>
      )}

      {couplingChartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold mb-3">Coupled Coefficients by Iteration</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={couplingChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="iteration" />
                <YAxis />
                <Tooltip />
                <Legend />
                <ReLine type="monotone" dataKey="cl" stroke="#2563eb" strokeWidth={2} dot={false} />
                <ReLine type="monotone" dataKey="cd" stroke="#dc2626" strokeWidth={2} dot={false} />
                <ReLine type="monotone" dataKey="l_over_d" stroke="#059669" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold mb-3">CFD Residual and Node Count</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={couplingChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="iteration" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <ReLine yAxisId="left" type="monotone" dataKey="residual_l2" stroke="#7c3aed" strokeWidth={2} dot={false} />
                <ReLine yAxisId="right" type="monotone" dataKey="selected_nodes" stroke="#d97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {nodeScatterData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold mb-3">Node Drag vs Lift Map</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="drag" name="Drag" />
                <YAxis type="number" dataKey="lift" name="Lift" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="All nodes" data={nodeScatterData.filter((point) => point.selected === 0)} fill="#2563eb" />
                <Scatter name="Selected nodes" data={nodeScatterData.filter((point) => point.selected === 1)} fill="#f59e0b" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold mb-3">Spanwise Lift/Drag Distribution</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={spanwiseChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="span_index" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="avg_lift" fill="#16a34a" name="Avg lift" />
                <Bar yAxisId="left" dataKey="avg_drag" fill="#ef4444" name="Avg drag" />
                <ReLine yAxisId="right" type="monotone" dataKey="selected_ratio" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-gray-50 rounded border">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Top Node Force Contributors
          </h3>
          <div className="space-y-2 text-sm max-h-56 overflow-auto">
            {topNodes.length === 0 && <div className="text-gray-500">No node data available.</div>}
            {topNodes.map((node) => (
              <div key={node.node_id} className="p-2 bg-white rounded border flex justify-between">
                <span>Node {node.node_id} (s{node.span_index}, c{node.chord_index})</span>
                <span className="font-medium">L {node.lift?.toFixed?.(3)} | D {node.drag?.toFixed?.(3)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded border text-sm">
          <h3 className="font-semibold mb-2">Quantum-CFD Coupling Notes</h3>
          <ul className="list-disc list-inside space-y-1 text-gray-700">
            <li>VLM provides local node forces and circulation.</li>
            <li>Node drag/lift metrics are encoded into a QUBO objective.</li>
            <li>Quantum/classical optimization selects high-value node sets per iteration.</li>
            <li>CFD adapter validates each coupled update and reports residual trends.</li>
          </ul>

          {coupledResult?.cfd && (
            <div className="mt-3 p-2 bg-white border rounded space-y-1">
              <div>CFD Engine: <strong>{coupledResult.cfd.engine || 'n/a'}</strong></div>
              <div>Adapter Enabled: <strong>{coupledResult.cfd.adapter_enabled ? 'Yes' : 'No'}</strong></div>
              <div>Run Count: <strong>{Array.isArray(cfdRuns) ? cfdRuns.length : 0}</strong></div>
            </div>
          )}

          {quantumSelection?.optimization && (
            <div className="mt-3 p-2 bg-white border rounded">
              <div>Method: <strong>{quantumSelection.optimization.method}</strong></div>
              <div>Cost: <strong>{quantumSelection.optimization.cost?.toFixed?.(4)}</strong></div>
              <div>Iterations: <strong>{quantumSelection.optimization.iterations}</strong></div>
            </div>
          )}
        </div>
      </div>

      {cfdRuns.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 border rounded text-sm">
          <h3 className="font-semibold mb-2">CFD Run Diagnostics</h3>
          <div className="space-y-2 max-h-56 overflow-auto">
            {cfdRuns.map((run, idx) => (
              <div key={`${run.stage}-${run.iteration}-${idx}`} className="p-2 bg-white border rounded flex justify-between gap-3">
                <span>
                  {run.stage} {run.iteration ? `(iter ${run.iteration})` : ''}
                </span>
                <span className="font-medium">
                  {run.cfd_engine || 'n/a'} | {run.cfd_solver || 'n/a'}
                  {Number.isFinite(run.residual_l2) ? ` | res ${Number(run.residual_l2).toExponential(2)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VLMVisualization;
