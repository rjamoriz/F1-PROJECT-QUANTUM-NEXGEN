/**
 * Real-Time Quantum Simulation Dashboard
 * WebSocket-based live quantum computations
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Zap, Cpu, TrendingUp, Play, Square } from './lucideShim';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { realtimeWsUrl } from '../config/endpoints';

const RealTimeSimulation = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [vqeData, setVqeData] = useState([]);
  const [currentStatus, setCurrentStatus] = useState('');
  const [pipelineStages, setPipelineStages] = useState([]);
  const [metrics, setMetrics] = useState({
    vqe_iterations: 0,
    dwave_progress: 0,
    ml_inferences: 0,
    total_time: 0
  });
  
  const ws = useRef(null);
  const maxLogs = 50;

  const addLog = useCallback((message, level = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => {
      const newLogs = [{ timestamp, message, level }, ...prev];
      return newLogs.slice(0, maxLogs);
    });
  }, [maxLogs]);

  const handleMessage = useCallback((data) => {
    const { type } = data;
    
    switch (type) {
      case 'vqe_started':
        addLog('🚀 VQE optimization started', 'info');
        setCurrentStatus('Running VQE...');
        setIsRunning(true);
        break;
      
      case 'vqe_iteration':
        setVqeData(prev => [...prev, {
          iteration: data.iteration,
          energy: data.energy,
          convergence: data.convergence * 100
        }]);
        setMetrics(prev => ({ ...prev, vqe_iterations: data.iteration + 1 }));
        break;
      
      case 'vqe_complete':
        addLog(`✓ VQE complete: Energy=${data.final_energy.toFixed(2)}`, 'success');
        addLog(`  Optimized Cl=${data.optimized_params.cl.toFixed(3)}, Cd=${data.optimized_params.cd.toFixed(3)}`, 'success');
        setCurrentStatus('VQE Complete');
        setIsRunning(false);
        break;
      
      case 'dwave_started':
        addLog('🌀 D-Wave annealing started', 'info');
        setCurrentStatus('Running D-Wave...');
        setIsRunning(true);
        break;
      
      case 'dwave_annealing':
        setMetrics(prev => ({ ...prev, dwave_progress: data.progress * 100 }));
        if (data.step % 5 === 0) {
          addLog(`  Annealing step ${data.step}/20 (T=${data.temperature.toFixed(0)}K)`, 'info');
        }
        break;
      
      case 'dwave_complete':
        addLog(`✓ D-Wave complete: Energy=${data.energy.toFixed(2)}`, 'success');
        addLog(`  Generated ${data.total_elements} wing elements`, 'success');
        setCurrentStatus('D-Wave Complete');
        setIsRunning(false);
        break;
      
      case 'ml_started':
        addLog('🤖 ML inference started', 'info');
        setCurrentStatus('Running ML Models...');
        setIsRunning(true);
        break;
      
      case 'ml_inference':
        addLog(`  ${data.model}: ${data.inference_time_ms.toFixed(1)}ms`, 'info');
        setMetrics(prev => ({ ...prev, ml_inferences: prev.ml_inferences + 1 }));
        break;
      
      case 'ml_complete':
        addLog(`✓ ML complete: Avg ${data.avg_inference_time_ms.toFixed(1)}ms`, 'success');
        setCurrentStatus('ML Complete');
        setIsRunning(false);
        break;
      
      case 'pipeline_started':
        addLog('🔄 Full pipeline started', 'info');
        setCurrentStatus('Running Pipeline...');
        setIsRunning(true);
        setPipelineStages(data.stages.map((name, i) => ({
          id: i + 1,
          name,
          status: 'pending'
        })));
        break;
      
      case 'pipeline_stage':
        addLog(`  Stage ${data.stage}: ${data.name} - ${data.status}`, 'info');
        setPipelineStages(prev => prev.map(stage => 
          stage.id === data.stage 
            ? { ...stage, status: data.status, result: data.result }
            : stage
        ));
        break;
      
      case 'pipeline_quantum_progress':
        // Update progress silently
        break;
      
      case 'pipeline_complete':
        addLog(`✓ Pipeline complete in ${data.total_time_s.toFixed(1)}s`, 'success');
        addLog(`  Improvement: ${data.improvement_pct.toFixed(1)}%`, 'success');
        setCurrentStatus('Pipeline Complete');
        setIsRunning(false);
        break;
      
      default:
        console.log('Unknown message type:', type, data);
    }
  }, [addLog]);

  const connectWebSocket = useCallback(() => {
    try {
      ws.current = new WebSocket(realtimeWsUrl('/ws/quantum'));
      
      ws.current.onopen = () => {
        setIsConnected(true);
        addLog('✓ Connected to real-time server', 'success');
      };
      
      ws.current.onclose = () => {
        setIsConnected(false);
        addLog('✗ Disconnected from server', 'error');
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
      
      ws.current.onerror = (error) => {
        addLog('✗ WebSocket error', 'error');
      };
      
      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
      };
      
    } catch (error) {
      addLog('✗ Failed to connect to server', 'error');
    }
  }, [addLog, handleMessage]);

  useEffect(() => {
    // Connect to WebSocket
    connectWebSocket();
    
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connectWebSocket]);

  const sendCommand = (command, params = {}) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ command, params }));
    } else {
      addLog('✗ Not connected to server', 'error');
    }
  };

  const startVQE = () => {
    setVqeData([]);
    sendCommand('start_vqe', {
      num_qubits: 20,
      target_cl: 2.8,
      target_cd: 0.4
    });
  };

  const startDWave = () => {
    sendCommand('start_dwave', {
      num_elements: 50,
      target_cl: 2.8
    });
  };

  const startML = () => {
    sendCommand('start_ml', {});
  };

  const startFullPipeline = () => {
    setVqeData([]);
    setPipelineStages([]);
    sendCommand('start_full_pipeline', {});
  };

  const stopSimulation = () => {
    setIsRunning(false);
    setCurrentStatus('Stopped');
    addLog('⏹ Simulation stopped', 'warning');
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Activity className="w-6 h-6 text-blue-600" />
        Real-Time Quantum Simulation
      </h2>

      <p className="text-gray-600 mb-6">
        Live quantum computations with IBM Qiskit and D-Wave Ocean SDK
      </p>

      {/* Connection Status */}
      <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="font-medium">
              {isConnected ? 'Connected to Real-Time Server' : 'Disconnected'}
            </span>
          </div>
          
          <div className="text-sm text-gray-600">
            {currentStatus && (
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded">
                {currentStatus}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="mb-6 grid grid-cols-5 gap-4">
        <button
          onClick={startVQE}
          disabled={!isConnected || isRunning}
          className={`px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isConnected && !isRunning
              ? 'bg-purple-600 hover:bg-purple-700 text-white'
              : 'bg-gray-300 cursor-not-allowed text-gray-500'
          }`}
        >
          <Zap className="w-4 h-4" />
          VQE
        </button>

        <button
          onClick={startDWave}
          disabled={!isConnected || isRunning}
          className={`px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isConnected && !isRunning
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
              : 'bg-gray-300 cursor-not-allowed text-gray-500'
          }`}
        >
          <Cpu className="w-4 h-4" />
          D-Wave
        </button>

        <button
          onClick={startML}
          disabled={!isConnected || isRunning}
          className={`px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isConnected && !isRunning
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-300 cursor-not-allowed text-gray-500'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          ML
        </button>

        <button
          onClick={startFullPipeline}
          disabled={!isConnected || isRunning}
          className={`px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isConnected && !isRunning
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-300 cursor-not-allowed text-gray-500'
          }`}
        >
          <Play className="w-4 h-4" />
          Full Pipeline
        </button>

        <button
          onClick={stopSimulation}
          disabled={!isRunning}
          className={`px-4 py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isRunning
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-300 cursor-not-allowed text-gray-500'
          }`}
        >
          <Square className="w-4 h-4" />
          Stop
        </button>
      </div>

      {/* Metrics */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="text-sm text-purple-700">VQE Iterations</div>
          <div className="text-2xl font-bold text-purple-900">{metrics.vqe_iterations}</div>
        </div>
        
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded">
          <div className="text-sm text-indigo-700">D-Wave Progress</div>
          <div className="text-2xl font-bold text-indigo-900">{metrics.dwave_progress.toFixed(0)}%</div>
        </div>
        
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm text-blue-700">ML Inferences</div>
          <div className="text-2xl font-bold text-blue-900">{metrics.ml_inferences}</div>
        </div>
        
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="text-sm text-green-700">Total Time</div>
          <div className="text-2xl font-bold text-green-900">{metrics.total_time.toFixed(1)}s</div>
        </div>
      </div>

      {/* VQE Convergence Chart */}
      {vqeData.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
          <h3 className="font-semibold mb-3">VQE Energy Convergence</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={vqeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="iteration" />
              <YAxis yAxisId="left" label={{ value: 'Energy', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: 'Convergence %', angle: 90, position: 'insideRight' }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="energy" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="convergence" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pipeline Stages */}
      {pipelineStages.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
          <h3 className="font-semibold mb-3">Pipeline Stages</h3>
          <div className="space-y-2">
            {pipelineStages.map(stage => (
              <div key={stage.id} className="flex items-center gap-3 p-3 bg-white rounded border">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                  stage.status === 'complete' ? 'bg-green-100 text-green-700' :
                  stage.status === 'running' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {stage.id}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{stage.name}</div>
                  {stage.result && (
                    <div className="text-xs text-gray-600">
                      {JSON.stringify(stage.result)}
                    </div>
                  )}
                </div>
                <div className={`px-3 py-1 rounded text-sm font-medium ${
                  stage.status === 'complete' ? 'bg-green-100 text-green-700' :
                  stage.status === 'running' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {stage.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Logs */}
      <div className="p-4 bg-gray-900 rounded border border-gray-700">
        <h3 className="font-semibold mb-3 text-white">Live Logs</h3>
        <div className="space-y-1 font-mono text-sm max-h-64 overflow-y-auto">
          {logs.map((log, idx) => (
            <div key={idx} className={`${
              log.level === 'success' ? 'text-green-400' :
              log.level === 'error' ? 'text-red-400' :
              log.level === 'warning' ? 'text-yellow-400' :
              'text-gray-300'
            }`}>
              <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-gray-500">Waiting for simulation...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RealTimeSimulation;
