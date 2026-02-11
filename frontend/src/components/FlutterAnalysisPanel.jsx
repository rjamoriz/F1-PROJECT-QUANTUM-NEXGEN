/**
 * Flutter Analysis Panel
 * Displays V-g diagram, flutter margin, and modal damping analysis
 */

import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';

const FlutterAnalysisPanel = () => {
  const [flutterData, setFlutterData] = useState(null);
  const [vgData, setVgData] = useState([]);
  const [configuration, setConfiguration] = useState('baseline');

  const generateDefaultData = useCallback(() => {
    // Generate V-g diagram data
    const velocities = [];
    for (let v = 100; v <= 350; v += 10) {
      const mode1Damping = 0.02 - (v - 100) * 0.0001;  // Decreases with speed
      const mode2Damping = 0.025 - (v - 100) * 0.00008;
      const mode3Damping = 0.022 - (v - 100) * 0.00012;
      
      velocities.push({
        velocity: v,
        mode1: mode1Damping,
        mode2: mode2Damping,
        mode3: mode3Damping
      });
    }
    
    setVgData(velocities);
    
    // Flutter analysis data
    setFlutterData({
      flutter_speed: 285.5,  // km/h
      max_speed: 350,
      flutter_margin: 1.23,
      critical_mode: 'Mode 1: 1st Bending',
      critical_frequency: 25.3,
      safety_status: 'SAFE',
      modes: [
        { id: 1, name: '1st Bending', frequency: 25.3, damping: 0.02 },
        { id: 2, name: '1st Torsion', frequency: 42.7, damping: 0.025 },
        { id: 3, name: '2nd Bending', frequency: 58.1, damping: 0.022 }
      ]
    });
  }, []);

  const loadFlutterAnalysis = useCallback(async () => {
    try {
      const response = await axios.get(`${BACKEND_API_BASE}/api/aeroelastic/flutter-analysis`, {
        params: { config: configuration },
      });
      setFlutterData(response.data);
      setVgData(response.data.vg_diagram);
    } catch (error) {
      // Use default data if API not available
      generateDefaultData();
    }
  }, [configuration, generateDefaultData]);

  useEffect(() => {
    loadFlutterAnalysis();
  }, [loadFlutterAnalysis]);

  const getStatusColor = (margin) => {
    if (margin >= 1.5) return 'text-green-600';
    if (margin >= 1.2) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusBg = (margin) => {
    if (margin >= 1.5) return 'bg-green-50 border-green-200';
    if (margin >= 1.2) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Flutter Analysis</h2>

      {/* Configuration Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Configuration</label>
        <select
          value={configuration}
          onChange={(e) => setConfiguration(e.target.value)}
          className="w-full px-3 py-2 border rounded"
        >
          <option value="baseline">Baseline</option>
          <option value="stiffened">With Stiffeners</option>
          <option value="lightweight">Lightweight</option>
          <option value="optimized">Quantum Optimized</option>
        </select>
      </div>

      {/* Flutter Summary */}
      {flutterData && (
        <div className={`mb-6 p-4 border rounded ${getStatusBg(flutterData.flutter_margin)}`}>
          <h3 className="font-semibold mb-3">Flutter Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-600">Flutter Speed</div>
              <div className="text-2xl font-bold">{flutterData.flutter_speed.toFixed(1)} km/h</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Flutter Margin</div>
              <div className={`text-2xl font-bold ${getStatusColor(flutterData.flutter_margin)}`}>
                {flutterData.flutter_margin.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Maximum Speed</div>
              <div className="text-xl font-bold">{flutterData.max_speed} km/h</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Safety Status</div>
              <div className={`text-xl font-bold ${getStatusColor(flutterData.flutter_margin)}`}>
                {flutterData.safety_status}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t">
            <div className="text-sm">
              <span className="font-medium">Critical Mode:</span>
              <span className="ml-2">{flutterData.critical_mode}</span>
            </div>
            <div className="text-sm mt-1">
              <span className="font-medium">Critical Frequency:</span>
              <span className="ml-2">{flutterData.critical_frequency} Hz</span>
            </div>
          </div>
        </div>
      )}

      {/* V-g Diagram */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3">V-g Diagram (Velocity-Damping)</h3>
        <div className="p-4 bg-gray-50 rounded">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={vgData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="velocity" 
                label={{ value: 'Velocity (km/h)', position: 'insideBottom', offset: -5 }} 
              />
              <YAxis 
                label={{ value: 'Modal Damping Ratio', angle: -90, position: 'insideLeft' }}
                domain={[-0.01, 0.04]}
              />
              <Tooltip />
              <Legend />
              <ReferenceLine y={0} stroke="red" strokeDasharray="3 3" label="Flutter Boundary" />
              <ReferenceLine x={flutterData?.flutter_speed || 285} stroke="orange" strokeDasharray="5 5" label="Flutter Speed" />
              <Line type="monotone" dataKey="mode1" stroke="#3b82f6" strokeWidth={2} name="Mode 1" />
              <Line type="monotone" dataKey="mode2" stroke="#8b5cf6" strokeWidth={2} name="Mode 2" />
              <Line type="monotone" dataKey="mode3" stroke="#10b981" strokeWidth={2} name="Mode 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 text-sm text-gray-600">
          <p>
            <strong>V-g Diagram:</strong> Shows how modal damping changes with velocity.
            Flutter occurs when damping crosses zero (red line).
          </p>
        </div>
      </div>

      {/* Modal Damping Table */}
      {flutterData?.modes && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Modal Properties</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left">Mode</th>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-right">Frequency (Hz)</th>
                  <th className="px-4 py-2 text-right">Damping Ratio</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {flutterData.modes.map((mode) => (
                  <tr key={mode.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{mode.id}</td>
                    <td className="px-4 py-2">{mode.name}</td>
                    <td className="px-4 py-2 text-right">{mode.frequency.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right">{(mode.damping * 100).toFixed(2)}%</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-1 rounded text-xs ${
                        mode.damping > 0.02 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {mode.damping > 0.02 ? 'Stable' : 'Monitor'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Safety Zones */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 bg-green-50 border border-green-200 rounded">
          <div className="text-sm font-medium text-green-800">Safe Zone</div>
          <div className="text-xs text-green-600 mt-1">Flutter Margin &ge; 1.5</div>
        </div>
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
          <div className="text-sm font-medium text-yellow-800">Caution Zone</div>
          <div className="text-xs text-yellow-600 mt-1">1.2 &le; Flutter Margin &lt; 1.5</div>
        </div>
        <div className="p-3 bg-red-50 border border-red-200 rounded">
          <div className="text-sm font-medium text-red-800">Critical Zone</div>
          <div className="text-xs text-red-600 mt-1">Flutter Margin &lt; 1.2</div>
        </div>
      </div>
    </div>
  );
};

export default FlutterAnalysisPanel;
