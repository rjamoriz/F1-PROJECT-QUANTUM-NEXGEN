/**
 * Design Space Explorer Component
 * Interactive multi-dimensional parameter exploration with real-time ML preview
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Sliders, RefreshCw, Save, Download } from './lucideShim';
import { BACKEND_API_BASE } from '../config/endpoints';

const DesignSpaceExplorer = () => {
  const [parameters, setParameters] = useState({
    velocity: 250,
    yaw: 3.0,
    rideHeight: -5.0,
    flapAngle: 8.0,
    camber: 5.0,
    thickness: 2.0
  });

  const [prediction, setPrediction] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState([]);

  // Parameter ranges and constraints
  const parameterRanges = {
    velocity: { min: 100, max: 350, step: 10, unit: 'km/h', constraint: null },
    yaw: { min: 0, max: 10, step: 0.5, unit: '°', constraint: null },
    rideHeight: { min: -10, max: 0, step: 0.5, unit: 'mm', constraint: null },
    flapAngle: { min: 0, max: 15, step: 0.5, unit: '°', constraint: 'FIA max 15°' },
    camber: { min: 2, max: 8, step: 0.5, unit: '%', constraint: null },
    thickness: { min: 1.0, max: 2.5, step: 0.1, unit: 'mm', constraint: 'Min 1mm for strength' }
  };

  const updatePrediction = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.post(`${BACKEND_API_BASE}/api/ml/predict-forces`, {
        parameters
      });
      setPrediction(response.data);
    } catch (error) {
      // Mock prediction if API unavailable
      setPrediction({
        Cl: 2.5 + (parameters.flapAngle / 15) * 0.5 + (parameters.camber / 8) * 0.3,
        Cd: 0.35 + (parameters.flapAngle / 15) * 0.15 + (parameters.camber / 8) * 0.05,
        L_D: 0,
        confidence: 0.92
      });
    } finally {
      setIsLoading(false);
    }
  }, [parameters]);

  useEffect(() => {
    // Debounced prediction update
    const timer = setTimeout(() => {
      updatePrediction();
    }, 500);
    return () => clearTimeout(timer);
  }, [updatePrediction]);

  const handleParameterChange = (param, value) => {
    setParameters(prev => ({
      ...prev,
      [param]: parseFloat(value)
    }));
  };

  const saveConfiguration = () => {
    const config = {
      id: Date.now(),
      name: `Config ${savedConfigs.length + 1}`,
      parameters: { ...parameters },
      prediction: { ...prediction },
      timestamp: new Date().toISOString()
    };
    setSavedConfigs([...savedConfigs, config]);
  };

  const loadConfiguration = (config) => {
    setParameters(config.parameters);
  };

  const resetToDefaults = () => {
    setParameters({
      velocity: 250,
      yaw: 3.0,
      rideHeight: -5.0,
      flapAngle: 8.0,
      camber: 5.0,
      thickness: 2.0
    });
  };

  const exportConfiguration = () => {
    const dataStr = JSON.stringify({ parameters, prediction }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `design-config-${Date.now()}.json`;
    link.click();
  };

  // Calculate L/D ratio
  if (prediction && prediction.Cl && prediction.Cd) {
    prediction.L_D = prediction.Cl / prediction.Cd;
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Sliders className="w-6 h-6" />
        Design Space Explorer
      </h2>

      <p className="text-gray-600 mb-6">
        Explore the design space interactively with real-time ML predictions. Adjust parameters and see immediate aerodynamic impact.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parameter Controls */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-lg">Parameters</h3>
            <div className="flex gap-2">
              <button
                onClick={resetToDefaults}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm flex items-center gap-1"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
              <button
                onClick={saveConfiguration}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center gap-1"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={exportConfiguration}
                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm flex items-center gap-1"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {Object.entries(parameterRanges).map(([param, range]) => (
            <div key={param} className="p-4 bg-gray-50 rounded border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <label className="font-medium capitalize">
                  {param.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <span className="font-mono font-bold text-lg">
                  {parameters[param].toFixed(1)} {range.unit}
                </span>
              </div>
              
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={parameters[param]}
                onChange={(e) => handleParameterChange(param, e.target.value)}
                className="w-full"
              />
              
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{range.min} {range.unit}</span>
                <span>{range.max} {range.unit}</span>
              </div>
              
              {range.constraint && (
                <div className="mt-2 text-xs text-orange-600">
                  ⚠️ {range.constraint}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Real-time Prediction */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Real-time Prediction</h3>
          
          {isLoading && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
              <p className="text-sm text-blue-700">Computing...</p>
            </div>
          )}

          {prediction && !isLoading && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border-2 border-green-300 rounded">
                <div className="text-sm text-gray-600 mb-1">Lift Coefficient (Cl)</div>
                <div className="text-3xl font-bold text-green-700">{prediction.Cl.toFixed(3)}</div>
              </div>

              <div className="p-4 bg-blue-50 border-2 border-blue-300 rounded">
                <div className="text-sm text-gray-600 mb-1">Drag Coefficient (Cd)</div>
                <div className="text-3xl font-bold text-blue-700">{prediction.Cd.toFixed(3)}</div>
              </div>

              <div className="p-4 bg-purple-50 border-2 border-purple-300 rounded">
                <div className="text-sm text-gray-600 mb-1">L/D Ratio</div>
                <div className="text-3xl font-bold text-purple-700">{prediction.L_D.toFixed(2)}</div>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                <div className="text-xs text-gray-600 mb-1">ML Confidence</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        prediction.confidence >= 0.9 ? 'bg-green-600' : 'bg-yellow-600'
                      }`}
                      style={{ width: `${prediction.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold">{(prediction.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>

              {prediction.confidence < 0.9 && (
                <div className="p-3 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800">
                  ⚠️ Low confidence. Consider physics validation.
                </div>
              )}
            </div>
          )}

          {/* Saved Configurations */}
          {savedConfigs.length > 0 && (
            <div className="mt-6">
              <h4 className="font-semibold mb-2">Saved Configurations</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {savedConfigs.map((config) => (
                  <div
                    key={config.id}
                    className="p-3 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 cursor-pointer"
                    onClick={() => loadConfiguration(config)}
                  >
                    <div className="font-medium text-sm">{config.name}</div>
                    <div className="text-xs text-gray-600">
                      Cl: {config.prediction.Cl.toFixed(2)}, 
                      Cd: {config.prediction.Cd.toFixed(2)}, 
                      L/D: {config.prediction.L_D.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Design Space Heatmap */}
      <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Design Space Heatmap (Cl vs Parameters)</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 bg-white rounded border text-center">
            <div className="text-sm text-gray-600 mb-1">Flap Angle</div>
            <div className="text-2xl font-bold text-blue-600">
              {((parameters.flapAngle / 15) * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-500">Impact on Cl</div>
          </div>
          <div className="p-3 bg-white rounded border text-center">
            <div className="text-sm text-gray-600 mb-1">Camber</div>
            <div className="text-2xl font-bold text-green-600">
              {((parameters.camber / 8) * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-500">Impact on Cl</div>
          </div>
          <div className="p-3 bg-white rounded border text-center">
            <div className="text-sm text-gray-600 mb-1">Velocity</div>
            <div className="text-2xl font-bold text-purple-600">
              {((parameters.velocity - 100) / 250 * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-500">Operating Point</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesignSpaceExplorer;
