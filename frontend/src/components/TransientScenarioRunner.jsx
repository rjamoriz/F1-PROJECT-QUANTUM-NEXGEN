/**
 * Transient Scenario Runner
 * Executes and visualizes transient aerodynamic scenarios
 */

import React, { useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { BACKEND_API_BASE } from '../config/endpoints';

const TransientScenarioRunner = () => {
  const [scenario, setScenario] = useState('corner_exit_low');
  const [customConfig, setCustomConfig] = useState({
    initial_speed: 150,
    final_speed: 220,
    duration: 2.5,
    yaw_angle: 3.0,
    ride_height_delta: -5.0
  });
  
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState(null);
  const [chartData, setChartData] = useState([]);

  const scenarios = [
    { value: 'corner_exit_low', label: 'Corner Exit - Low Severity' },
    { value: 'corner_exit_high', label: 'Corner Exit - High Severity' },
    { value: 'drs_cycle', label: 'DRS Activation Cycle' },
    { value: 'kerb_strike', label: 'Kerb Strike Event' },
    { value: 'yaw_sweep', label: 'Yaw Sweep' },
    { value: 'custom', label: 'Custom Scenario' }
  ];

  const runScenario = async () => {
    setStatus('running');
    
    try {
      const payload = scenario === 'custom' ? {
        scenario_type: 'custom',
        config: customConfig
      } : {
        scenario_type: scenario
      };

      const response = await axios.post(`${BACKEND_API_BASE}/api/transient/run-scenario`, payload);
      
      setResults(response.data);
      
      // Format data for charts
      const formatted = response.data.time.map((t, idx) => ({
        time: t,
        downforce: response.data.downforce[idx],
        drag: response.data.drag[idx],
        displacement: response.data.displacement[idx] * 1000, // Convert to mm
        modal_energy: response.data.modal_energy[idx]
      }));
      
      setChartData(formatted);
      setStatus('completed');

    } catch (error) {
      setStatus('error');
      console.error('Scenario error:', error);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Transient Scenario Runner</h2>

      {/* Scenario Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Scenario</label>
        <select
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          className="w-full px-3 py-2 border rounded"
        >
          {scenarios.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Custom Configuration */}
      {scenario === 'custom' && (
        <div className="mb-6 p-4 bg-gray-50 rounded">
          <h3 className="font-semibold mb-3">Custom Configuration</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Initial Speed (km/h)</label>
              <input
                type="number"
                value={customConfig.initial_speed}
                onChange={(e) => setCustomConfig({...customConfig, initial_speed: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Final Speed (km/h)</label>
              <input
                type="number"
                value={customConfig.final_speed}
                onChange={(e) => setCustomConfig({...customConfig, final_speed: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Duration (s)</label>
              <input
                type="number"
                step="0.1"
                value={customConfig.duration}
                onChange={(e) => setCustomConfig({...customConfig, duration: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Yaw Angle (°)</label>
              <input
                type="number"
                step="0.1"
                value={customConfig.yaw_angle}
                onChange={(e) => setCustomConfig({...customConfig, yaw_angle: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Ride Height Delta (mm)</label>
              <input
                type="number"
                step="0.1"
                value={customConfig.ride_height_delta}
                onChange={(e) => setCustomConfig({...customConfig, ride_height_delta: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Run Button */}
      <button
        onClick={runScenario}
        disabled={status === 'running'}
        className={`w-full px-6 py-3 rounded font-semibold mb-6 ${
          status === 'running'
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {status === 'running' ? 'Running Simulation...' : 'Run Scenario'}
      </button>

      {/* Results */}
      {results && (
        <div className="space-y-6">
          {/* Summary Metrics */}
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Peak Downforce Reduction</div>
              <div className="text-2xl font-bold text-blue-600">
                {(results.peak_downforce_reduction * 100).toFixed(1)}%
              </div>
            </div>
            
            <div className="p-4 bg-green-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Flutter Margin</div>
              <div className={`text-2xl font-bold ${results.flutter_margin > 1.2 ? 'text-green-600' : 'text-red-600'}`}>
                {results.flutter_margin.toFixed(2)}
              </div>
            </div>
            
            <div className="p-4 bg-purple-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Max Displacement</div>
              <div className="text-2xl font-bold text-purple-600">
                {(Math.max(...results.displacement) * 1000).toFixed(2)} mm
              </div>
            </div>
            
            <div className="p-4 bg-orange-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Modal Energy Growth</div>
              <div className="text-2xl font-bold text-orange-600">
                {((Math.max(...results.modal_energy) - Math.min(...results.modal_energy))).toFixed(3)} J
              </div>
            </div>
          </div>

          {/* Downforce Chart */}
          <div className="p-4 bg-gray-50 rounded">
            <h3 className="font-semibold mb-3">Downforce vs Time</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Downforce (N)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="downforce" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Displacement Chart */}
          <div className="p-4 bg-gray-50 rounded">
            <h3 className="font-semibold mb-3">Structural Displacement vs Time</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Displacement (mm)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="displacement" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Modal Energy Chart */}
          <div className="p-4 bg-gray-50 rounded">
            <h3 className="font-semibold mb-3">Modal Energy vs Time</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Energy (J)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="modal_energy" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransientScenarioRunner;
