/**
 * Flow Field Visualization
 * Advanced 3D flow visualization with velocity vectors, streamlines, and vorticity
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import axios from 'axios';
import { Wind } from './lucideShim';
import { BACKEND_API_BASE } from '../config/endpoints';

// Velocity Vector Field
const VelocityVectors = ({ vectors, scale }) => {
  return (
    <group>
      {vectors.map((vec, idx) => {
        const start = new THREE.Vector3(...vec.position);
        const velocity = new THREE.Vector3(...vec.velocity);
        const end = start.clone().add(velocity.multiplyScalar(scale));
        
        const magnitude = velocity.length();
        const color = new THREE.Color().setHSL(0.6 - magnitude * 0.3, 1, 0.5);

        return (
          <group key={idx}>
            <Line
              points={[start, end]}
              color={color}
              lineWidth={2}
            />
            {/* Arrow head */}
            <mesh position={end.toArray()}>
              <coneGeometry args={[0.02, 0.05, 8]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};

// Animated Streamlines
const AnimatedStreamlines = ({ streamlines }) => {
  const groupRef = useRef();
  const [time, setTime] = useState(0);

  useFrame((state, delta) => {
    setTime(t => t + delta * 0.5);
  });

  return (
    <group ref={groupRef}>
      {streamlines.map((stream, idx) => {
        const points = stream.points.map(p => new THREE.Vector3(...p));
        
        // Animate particles along streamline
        const particlePos = points[Math.floor((time * 10 + idx) % points.length)];

        return (
          <group key={idx}>
            <Line
              points={points}
              color="#00ffff"
              lineWidth={1.5}
              transparent
              opacity={0.6}
            />
            {particlePos && (
              <mesh position={particlePos.toArray()}>
                <sphereGeometry args={[0.02, 8, 8]} />
                <meshBasicMaterial color="#00ffff" />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};

// Vorticity Isosurfaces
const VorticityIsosurfaces = ({ vortexCores }) => {
  return (
    <group>
      {vortexCores.map((vortex, idx) => (
        <mesh key={idx} position={vortex.position}>
          <torusGeometry args={[vortex.radius, vortex.radius * 0.3, 16, 32]} />
          <meshStandardMaterial
            color="#ff6b6b"
            transparent
            opacity={0.6}
            emissive="#ff6b6b"
            emissiveIntensity={0.3}
          />
        </mesh>
      ))}
    </group>
  );
};

// Pressure Field (Volume Rendering)
const PressureField = ({ pressureData, showField }) => {
  if (!showField) return null;

  return (
    <group>
      {pressureData.map((point, idx) => {
        const pressure = point.value;
        const normalized = (pressure + 1) / 2;
        const color = new THREE.Color().setHSL(0.6 - normalized * 0.6, 1, 0.5);
        const size = 0.03;

        return (
          <mesh key={idx} position={point.position}>
            <sphereGeometry args={[size, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.4} />
          </mesh>
        );
      })}
    </group>
  );
};

const FlowFieldVisualization = () => {
  const [flowData, setFlowData] = useState(null);
  const [showVectors, setShowVectors] = useState(true);
  const [showStreamlines, setShowStreamlines] = useState(true);
  const [showVorticity, setShowVorticity] = useState(true);
  const [showPressure, setShowPressure] = useState(false);
  const [vectorScale, setVectorScale] = useState(0.1);
  const [parameters, setParameters] = useState({
    velocity: 250,
    alpha: 5.0
  });

  const generateMockFlowData = useCallback(() => {
    const vectors = [];
    const streamlines = [];
    const vortexCores = [];
    const pressureData = [];

    // Generate velocity vector field
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        for (let k = 0; k < 5; k++) {
          const x = (i - 5) * 0.2;
          const y = k * 0.1;
          const z = j * 0.1;

          // Simulate flow around wing
          const distFromWing = Math.sqrt(x*x + y*y);
          const vx = 1.0 + Math.sin(distFromWing) * 0.2;
          const vy = Math.cos(distFromWing) * 0.1;
          const vz = 0.05;

          vectors.push({
            position: [x, y, z],
            velocity: [vx, vy, vz]
          });

          // Pressure field
          const pressure = -0.5 * (vx*vx + vy*vy + vz*vz);
          pressureData.push({
            position: [x, y, z],
            value: pressure
          });
        }
      }
    }

    // Generate streamlines
    for (let i = 0; i < 8; i++) {
      const y = (i - 4) * 0.15;
      const points = [];
      for (let x = -1.0; x < 1.5; x += 0.05) {
        const z = 0.1 + Math.sin(x * 3) * 0.05;
        points.push([y, z, x]);
      }
      streamlines.push({ points });
    }

    // Generate vortex cores (leading edge vortex)
    vortexCores.push({
      position: [0, 0.05, 0.1],
      radius: 0.08,
      strength: 1.5
    });

    vortexCores.push({
      position: [0, 0.03, 0.7],
      radius: 0.05,
      strength: 0.8
    });

    return {
      vectors,
      streamlines,
      vortexCores,
      pressureData,
      statistics: {
        maxVelocity: 1.2,
        minPressure: -0.8,
        maxVorticity: 2.5,
        turbulenceIntensity: 0.15
      }
    };
  }, []);

  const loadFlowData = useCallback(async () => {
    try {
      const response = await axios.post(`${BACKEND_API_BASE}/api/physics/v1/flow-field`, {
        mesh_id: 'wing_v3.2',
        velocity: parameters.velocity / 3.6,
        alpha: parameters.alpha
      });
      setFlowData(response.data);
    } catch (error) {
      setFlowData(generateMockFlowData());
    }
  }, [generateMockFlowData, parameters.alpha, parameters.velocity]);

  useEffect(() => {
    loadFlowData();
  }, [loadFlowData]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Wind className="w-6 h-6" />
        Flow Field Visualization
      </h2>

      {/* Controls */}
      <div className="mb-4 grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Velocity (km/h)</label>
          <input
            type="number"
            value={parameters.velocity}
            onChange={(e) => setParameters({...parameters, velocity: parseFloat(e.target.value)})}
            className="w-full px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Angle of Attack (°)</label>
          <input
            type="number"
            step="0.5"
            value={parameters.alpha}
            onChange={(e) => setParameters({...parameters, alpha: parseFloat(e.target.value)})}
            className="w-full px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Vector Scale</label>
          <input
            type="range"
            min="0.05"
            max="0.3"
            step="0.01"
            value={vectorScale}
            onChange={(e) => setVectorScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Display Options */}
      <div className="mb-4 flex gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showVectors}
            onChange={(e) => setShowVectors(e.target.checked)}
          />
          <span className="text-sm">Velocity Vectors</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showStreamlines}
            onChange={(e) => setShowStreamlines(e.target.checked)}
          />
          <span className="text-sm">Streamlines</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showVorticity}
            onChange={(e) => setShowVorticity(e.target.checked)}
          />
          <span className="text-sm">Vortex Cores</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showPressure}
            onChange={(e) => setShowPressure(e.target.checked)}
          />
          <span className="text-sm">Pressure Field</span>
        </label>
      </div>

      {/* 3D Visualization */}
      <div className="mb-4 bg-gray-900 rounded-lg" style={{ height: '500px' }}>
        <Canvas camera={{ position: [3, 2, 3], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <pointLight position={[-10, -10, -10]} intensity={0.3} />

          {flowData && (
            <>
              {showVectors && (
                <VelocityVectors
                  vectors={flowData.vectors}
                  scale={vectorScale}
                />
              )}
              
              {showStreamlines && (
                <AnimatedStreamlines streamlines={flowData.streamlines} />
              )}
              
              {showVorticity && (
                <VorticityIsosurfaces vortexCores={flowData.vortexCores} />
              )}
              
              {showPressure && (
                <PressureField
                  pressureData={flowData.pressureData}
                  showField={showPressure}
                />
              )}
            </>
          )}

          <gridHelper args={[5, 20]} />
          <axesHelper args={[2]} />
          <OrbitControls />
        </Canvas>
      </div>

      {/* Statistics */}
      {flowData && (
        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm text-blue-700">Max Velocity</div>
            <div className="text-2xl font-bold text-blue-900">{flowData.statistics.maxVelocity.toFixed(2)} m/s</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded">
            <div className="text-sm text-red-700">Min Pressure</div>
            <div className="text-2xl font-bold text-red-900">{flowData.statistics.minPressure.toFixed(2)} Pa</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded">
            <div className="text-sm text-purple-700">Max Vorticity</div>
            <div className="text-2xl font-bold text-purple-900">{flowData.statistics.maxVorticity.toFixed(2)} 1/s</div>
          </div>
          <div className="p-4 bg-orange-50 border border-orange-200 rounded">
            <div className="text-sm text-orange-700">Turbulence</div>
            <div className="text-2xl font-bold text-orange-900">{(flowData.statistics.turbulenceIntensity * 100).toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
        <strong>Legend:</strong>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-red-500 rounded"></div>
            <span>Velocity Magnitude (Blue: Low, Red: High)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-cyan-500 rounded"></div>
            <span>Streamlines (Animated)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span>Vortex Cores</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500 rounded"></div>
            <span>Pressure Field</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowFieldVisualization;
