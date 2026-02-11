/**
 * Panel Method Visualization
 * Displays surface panels with source/doublet strength distribution
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import axios from 'axios';
import { Layers } from './lucideShim';
import { BACKEND_API_BASE } from '../config/endpoints';

// Panel Mesh Component
const PanelMesh = ({ panels, sourceStrength, showStreamlines }) => {
  const getSourceColor = (strength) => {
    const normalized = (strength + 1) / 2;
    return new THREE.Color().setHSL(0.6 - normalized * 0.6, 1, 0.5);
  };

  return (
    <group>
      {panels.map((panel, idx) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(panel.vertices.flat());
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(panel.indices);
        geometry.computeVertexNormals();

        const color = getSourceColor(sourceStrength[idx] || 0);

        return (
          <mesh key={idx} geometry={geometry}>
            <meshStandardMaterial
              color={color}
              side={THREE.DoubleSide}
              flatShading={false}
            />
          </mesh>
        );
      })}
    </group>
  );
};

// Streamlines Component
const Streamlines = ({ streamlineData }) => {
  return (
    <group>
      {streamlineData.map((stream, idx) => {
        const points = stream.points.map(p => new THREE.Vector3(...p));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        return (
          <line key={idx} geometry={geometry}>
            <lineBasicMaterial color="#00ffff" linewidth={2} />
          </line>
        );
      })}
    </group>
  );
};

const PanelMethodVisualization = () => {
  const [panelData, setPanelData] = useState(null);
  const [showStreamlines, setShowStreamlines] = useState(true);
  const [showPanels, setShowPanels] = useState(true);
  const [parameters, setParameters] = useState({
    velocity: 250,
    alpha: 5.0
  });

  const generateMockPanelData = useCallback(() => {
    const panels = [];
    const sourceStrength = [];
    const streamlines = [];

    // Generate triangular panels
    const nSpan = 20;
    const nChord = 15;

    for (let i = 0; i < nSpan; i++) {
      for (let j = 0; j < nChord; j++) {
        const y = (i - nSpan/2) * 0.1;
        const x1 = j * 0.05;
        const x2 = (j + 1) * 0.05;

        // Create two triangular panels per quad
        panels.push({
          vertices: [
            [y, 0, x1],
            [y + 0.1, 0, x1],
            [y + 0.1, 0, x2]
          ],
          indices: [0, 1, 2]
        });

        panels.push({
          vertices: [
            [y, 0, x1],
            [y + 0.1, 0, x2],
            [y, 0, x2]
          ],
          indices: [0, 1, 2]
        });

        // Source strength (higher near leading edge)
        const strength = Math.exp(-j / 5) * 0.5;
        sourceStrength.push(strength);
        sourceStrength.push(strength);
      }
    }

    // Generate streamlines
    for (let i = 0; i < 15; i++) {
      const y = (i - 7.5) * 0.15;
      const points = [];
      for (let x = -0.2; x < 1.0; x += 0.05) {
        const z = 0.1 + Math.sin(x * 5) * 0.02;
        points.push([y, z, x]);
      }
      streamlines.push({ points });
    }

    return {
      panels,
      sourceStrength,
      streamlines,
      coefficients: {
        Cl: 2.75,
        Cd: 0.39,
        Cm: -0.15
      },
      pressureCoefficients: sourceStrength.map(s => -2 * s)
    };
  }, []);

  const loadPanelData = useCallback(async () => {
    try {
      const response = await axios.post(`${BACKEND_API_BASE}/api/physics/v1/panel-solve`, {
        mesh_id: 'wing_v3.2',
        velocity: parameters.velocity / 3.6,
        alpha: parameters.alpha
      });
      setPanelData(response.data);
    } catch (error) {
      setPanelData(generateMockPanelData());
    }
  }, [generateMockPanelData, parameters.alpha, parameters.velocity]);

  useEffect(() => {
    loadPanelData();
  }, [loadPanelData]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Layers className="w-6 h-6" />
        Panel Method Visualization
      </h2>

      {/* Controls */}
      <div className="mb-4 grid grid-cols-2 gap-4">
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
      </div>

      {/* Display Options */}
      <div className="mb-4 flex gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showPanels}
            onChange={(e) => setShowPanels(e.target.checked)}
          />
          <span className="text-sm">Surface Panels</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showStreamlines}
            onChange={(e) => setShowStreamlines(e.target.checked)}
          />
          <span className="text-sm">Streamlines</span>
        </label>
      </div>

      {/* 3D Visualization */}
      <div className="mb-4 bg-gray-900 rounded-lg" style={{ height: '500px' }}>
        <Canvas camera={{ position: [3, 2, 3], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <pointLight position={[10, 10, 10]} intensity={0.8} />
          <pointLight position={[-10, -10, -10]} intensity={0.3} />

          {panelData && (
            <>
              {showPanels && (
                <PanelMesh
                  panels={panelData.panels}
                  sourceStrength={panelData.sourceStrength}
                  showStreamlines={showStreamlines}
                />
              )}
              
              {showStreamlines && (
                <Streamlines streamlineData={panelData.streamlines} />
              )}
            </>
          )}

          <gridHelper args={[5, 20]} />
          <axesHelper args={[2]} />
          <OrbitControls />
        </Canvas>
      </div>

      {/* Results */}
      {panelData && (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm text-blue-700">Lift Coefficient</div>
            <div className="text-3xl font-bold text-blue-900">{panelData.coefficients.Cl.toFixed(3)}</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded">
            <div className="text-sm text-green-700">Drag Coefficient</div>
            <div className="text-3xl font-bold text-green-900">{panelData.coefficients.Cd.toFixed(3)}</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded">
            <div className="text-sm text-purple-700">Moment Coefficient</div>
            <div className="text-3xl font-bold text-purple-900">{panelData.coefficients.Cm.toFixed(3)}</div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
        <strong>Legend:</strong>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-red-500 rounded"></div>
            <span>Source Strength (Blue: Low, Red: High)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-cyan-500 rounded"></div>
            <span>Streamlines</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PanelMethodVisualization;
