/**
 * Synthetic Data Generator Component
 * Controls and monitors F1 aerodynamic data generation pipeline
 */

import React, { useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';

const SyntheticDataGenerator = () => {
  const [config, setConfig] = useState({
    n_samples: 100,
    geometry_variations: 50,
    speed_range: [100, 300],
    yaw_range: [0, 10],
    include_drs: true,
    include_transient: true
  });
  
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (message) => {
    setLogs(prev => [...prev, { time: new Date().toISOString(), message }]);
  };

  const startGeneration = async () => {
    setStatus('running');
    setProgress(0);
    addLog('Starting synthetic data generation...');

    try {
      // Step 1: Generate NACA airfoil profiles
      addLog('Generating NACA airfoil profiles...');
      await axios.post(`${BACKEND_API_BASE}/api/data/generate-airfoils`, {
        n_profiles: config.geometry_variations
      });
      setProgress(20);

      // Step 2: Build F1 geometry variations
      addLog('Building F1 geometry variations...');
      await axios.post(`${BACKEND_API_BASE}/api/data/generate-geometry`, {
        n_variations: config.geometry_variations,
        components: ['front_wing', 'rear_wing', 'floor', 'diffuser']
      });
      setProgress(40);

      // Step 3: Run VLM simulations
      addLog('Running VLM simulations...');
      await axios.post(`${BACKEND_API_BASE}/api/physics/vlm/batch-simulate`, {
        n_samples: config.n_samples,
        speed_range: config.speed_range,
        yaw_range: config.yaw_range
      });
      setProgress(60);

      // Step 4: Generate transient scenarios (if enabled)
      if (config.include_transient) {
        addLog('Generating transient scenarios...');
        await axios.post(`${BACKEND_API_BASE}/api/transient/generate-scenarios`, {
          scenarios: ['corner_exit', 'drs_cycle', 'kerb_strike']
        });
        setProgress(80);
      }

      // Step 5: Store in HDF5 dataset
      addLog('Storing dataset in HDF5 format...');
      const datasetResponse = await axios.post(`${BACKEND_API_BASE}/api/data/store-dataset`, {
        format: 'hdf5',
        metadata: {
          n_samples: config.n_samples,
          timestamp: new Date().toISOString()
        }
      });
      setProgress(100);

      setResults(datasetResponse.data);
      setStatus('completed');
      addLog('✅ Data generation complete!');

    } catch (error) {
      setStatus('error');
      addLog(`❌ Error: ${error.message}`);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Synthetic Data Generator</h2>
      
      {/* Configuration Panel */}
      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="font-semibold mb-3">Configuration</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Number of Samples</label>
            <input
              type="number"
              value={config.n_samples}
              onChange={(e) => setConfig({...config, n_samples: parseInt(e.target.value)})}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Geometry Variations</label>
            <input
              type="number"
              value={config.geometry_variations}
              onChange={(e) => setConfig({...config, geometry_variations: parseInt(e.target.value)})}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Speed Range (km/h)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={config.speed_range[0]}
                onChange={(e) => setConfig({...config, speed_range: [parseInt(e.target.value), config.speed_range[1]]})}
                className="w-1/2 px-3 py-2 border rounded"
                placeholder="Min"
              />
              <input
                type="number"
                value={config.speed_range[1]}
                onChange={(e) => setConfig({...config, speed_range: [config.speed_range[0], parseInt(e.target.value)]})}
                className="w-1/2 px-3 py-2 border rounded"
                placeholder="Max"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Yaw Range (degrees)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={config.yaw_range[0]}
                onChange={(e) => setConfig({...config, yaw_range: [parseInt(e.target.value), config.yaw_range[1]]})}
                className="w-1/2 px-3 py-2 border rounded"
                placeholder="Min"
              />
              <input
                type="number"
                value={config.yaw_range[1]}
                onChange={(e) => setConfig({...config, yaw_range: [config.yaw_range[0], parseInt(e.target.value)]})}
                className="w-1/2 px-3 py-2 border rounded"
                placeholder="Max"
              />
            </div>
          </div>
        </div>
        
        <div className="mt-4 flex gap-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.include_drs}
              onChange={(e) => setConfig({...config, include_drs: e.target.checked})}
              className="mr-2"
            />
            Include DRS States
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.include_transient}
              onChange={(e) => setConfig({...config, include_transient: e.target.checked})}
              className="mr-2"
            />
            Include Transient Scenarios
          </label>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="mb-6">
        <button
          onClick={startGeneration}
          disabled={status === 'running'}
          className={`px-6 py-3 rounded font-semibold ${
            status === 'running'
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {status === 'running' ? 'Generating...' : 'Start Generation'}
        </button>
      </div>

      {/* Progress Bar */}
      {status === 'running' && (
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm font-medium">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className="bg-blue-600 h-4 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Results Summary */}
      {results && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded">
          <h3 className="font-semibold mb-2 text-green-800">Generation Complete</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium">Total Samples:</span>
              <span className="ml-2">{results.total_samples}</span>
            </div>
            <div>
              <span className="font-medium">Dataset Size:</span>
              <span className="ml-2">{results.dataset_size_mb} MB</span>
            </div>
            <div>
              <span className="font-medium">Duration:</span>
              <span className="ml-2">{results.duration_seconds}s</span>
            </div>
          </div>
        </div>
      )}

      {/* Log Console */}
      <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm h-64 overflow-y-auto">
        {logs.map((log, idx) => (
          <div key={idx} className="mb-1">
            <span className="text-gray-500">[{new Date(log.time).toLocaleTimeString()}]</span>
            {' '}
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SyntheticDataGenerator;
