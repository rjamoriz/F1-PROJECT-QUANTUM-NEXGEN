/**
 * Mode Shape Viewer Component
 * Visualizes structural mode shapes with animated deformation
 */

import React, { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';

const AnimatedWing = ({ modeShape, amplitude, frequency, isAnimating }) => {
  const meshRef = useRef();
  const [time, setTime] = useState(0);

  useFrame((state, delta) => {
    if (isAnimating && meshRef.current) {
      setTime(t => t + delta);
      
      // Animate deformation: displacement = amplitude * sin(2π * frequency * time)
      const displacement = amplitude * Math.sin(2 * Math.PI * frequency * time);
      
      // Apply modal deformation (simplified)
      const geometry = meshRef.current.geometry;
      const positions = geometry.attributes.position.array;
      
      // Deform based on mode shape
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        
        // Apply mode shape deformation (example: bending mode)
        if (modeShape === 'bending') {
          positions[i + 2] = z + displacement * (x / 2);  // Bending in z
        } else if (modeShape === 'torsion') {
          positions[i + 1] = y + displacement * (x / 2);  // Torsion
        }
      }
      
      geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={[4, 0.1, 1]} />
      <meshStandardMaterial color="#3b82f6" wireframe={false} />
    </mesh>
  );
};

const ModeShapeViewer = () => {
  const [modes, setModes] = useState([]);
  const [selectedMode, setSelectedMode] = useState(0);
  const [amplitude, setAmplitude] = useState(0.1);
  const [isAnimating, setIsAnimating] = useState(false);
  const [modeData, setModeData] = useState(null);

  useEffect(() => {
    loadModes();
  }, []);

  const loadModes = async () => {
    try {
      const response = await axios.get(`${BACKEND_API_BASE}/api/aeroelastic/modes`);
      setModes(response.data.modes);
      if (response.data.modes.length > 0) {
        setModeData(response.data.modes[0]);
      }
    } catch (error) {
      // Use default modes if API not available
      const defaultModes = [
        { id: 0, type: 'bending', frequency: 25.3, damping: 0.02, description: '1st Bending Mode' },
        { id: 1, type: 'torsion', frequency: 42.7, damping: 0.025, description: '1st Torsion Mode' },
        { id: 2, type: 'bending', frequency: 58.1, damping: 0.022, description: '2nd Bending Mode' },
        { id: 3, type: 'coupled', frequency: 73.5, damping: 0.028, description: 'Bending-Torsion Coupled' },
        { id: 4, type: 'local', frequency: 95.2, damping: 0.03, description: 'Endplate Local Mode' }
      ];
      setModes(defaultModes);
      setModeData(defaultModes[0]);
    }
  };

  const handleModeChange = (modeIndex) => {
    setSelectedMode(modeIndex);
    setModeData(modes[modeIndex]);
    setIsAnimating(false);
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Structural Mode Shape Viewer</h2>

      {/* Mode Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Select Mode</label>
        <select
          value={selectedMode}
          onChange={(e) => handleModeChange(parseInt(e.target.value))}
          className="w-full px-3 py-2 border rounded"
        >
          {modes.map((mode, idx) => (
            <option key={idx} value={idx}>
              Mode {idx + 1}: {mode.description} ({mode.frequency.toFixed(1)} Hz)
            </option>
          ))}
        </select>
      </div>

      {/* 3D Visualization */}
      <div className="mb-4 bg-gray-900 rounded-lg" style={{ height: '400px' }}>
        <Canvas camera={{ position: [5, 2, 5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <AnimatedWing
            modeShape={modeData?.type || 'bending'}
            amplitude={amplitude}
            frequency={modeData?.frequency || 25}
            isAnimating={isAnimating}
          />
          <OrbitControls />
          <gridHelper args={[10, 10]} />
        </Canvas>
      </div>

      {/* Mode Information */}
      {modeData && (
        <div className="mb-4 p-4 bg-blue-50 rounded">
          <h3 className="font-semibold mb-2">Mode Properties</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium">Type:</span>
              <span className="ml-2 capitalize">{modeData.type}</span>
            </div>
            <div>
              <span className="font-medium">Frequency:</span>
              <span className="ml-2">{modeData.frequency.toFixed(2)} Hz</span>
            </div>
            <div>
              <span className="font-medium">Damping Ratio:</span>
              <span className="ml-2">{(modeData.damping * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Amplitude (Exaggeration): {amplitude.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={amplitude}
            onChange={(e) => setAmplitude(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setIsAnimating(!isAnimating)}
            className={`flex-1 px-6 py-3 rounded font-semibold ${
              isAnimating
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {isAnimating ? 'Stop Animation' : 'Start Animation'}
          </button>

          <button
            onClick={() => {
              setIsAnimating(false);
              setAmplitude(0.1);
            }}
            className="flex-1 px-6 py-3 rounded font-semibold bg-gray-600 hover:bg-gray-700 text-white"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Mode Description */}
      <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
        <p className="text-gray-700">
          <strong>Description:</strong> {modeData?.description || 'Select a mode to view details'}
        </p>
        <p className="text-gray-600 mt-2">
          Natural frequency represents the speed at which this mode oscillates freely.
          Damping ratio indicates how quickly oscillations decay.
        </p>
      </div>
    </div>
  );
};

export default ModeShapeViewer;
