/**
 * 3D Aerodynamic Visualization Component
 * Displays F1 car with pressure distribution using Three.js
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Pressure colormap generator
 */
const getPressureColor = (cp, minCp = -3.0, maxCp = 1.0) => {
  // Normalize pressure coefficient to [0, 1]
  const normalized = (cp - minCp) / (maxCp - minCp);
  const clamped = Math.max(0, Math.min(1, normalized));
  
  // Jet colormap: blue (low) -> cyan -> green -> yellow -> red (high)
  let r, g, b;
  
  if (clamped < 0.25) {
    // Blue to cyan
    const t = clamped / 0.25;
    r = 0;
    g = t;
    b = 1;
  } else if (clamped < 0.5) {
    // Cyan to green
    const t = (clamped - 0.25) / 0.25;
    r = 0;
    g = 1;
    b = 1 - t;
  } else if (clamped < 0.75) {
    // Green to yellow
    const t = (clamped - 0.5) / 0.25;
    r = t;
    g = 1;
    b = 0;
  } else {
    // Yellow to red
    const t = (clamped - 0.75) / 0.25;
    r = 1;
    g = 1 - t;
    b = 0;
  }
  
  return new THREE.Color(r, g, b);
};

/**
 * Wing component with pressure visualization
 */
const Wing = ({ geometry, pressureData, showPressure = true }) => {
  const meshRef = useRef();
  const [colors, setColors] = useState(null);
  
  useEffect(() => {
    if (showPressure && pressureData && meshRef.current) {
      // Create color array for vertices
      const colorArray = new Float32Array(pressureData.length * 3);
      
      pressureData.forEach((cp, i) => {
        const color = getPressureColor(cp);
        colorArray[i * 3] = color.r;
        colorArray[i * 3 + 1] = color.g;
        colorArray[i * 3 + 2] = color.b;
      });
      
      setColors(colorArray);
    }
  }, [pressureData, showPressure]);
  
  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        vertexColors={showPressure && colors}
        side={THREE.DoubleSide}
        metalness={0.3}
        roughness={0.7}
      />
    </mesh>
  );
};

/**
 * Simple F1 wing geometry (placeholder)
 */
const createWingGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  
  // Simple wing shape
  const vertices = new Float32Array([
    // Main plane
    -0.9, 0, 0,
    0.9, 0, 0,
    0.9, 0, 0.2,
    -0.9, 0, 0.2,
  ]);
  
  const indices = [0, 1, 2, 0, 2, 3];
  
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
};

/**
 * Force vector arrows
 */
const ForceArrows = ({ forces }) => {
  if (!forces) return null;
  
  return (
    <group>
      {/* Downforce arrow */}
      <arrowHelper
        args={[
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, 0.5, 0),
          forces.downforce / 1000,
          0x0000ff
        ]}
      />
      
      {/* Drag arrow */}
      <arrowHelper
        args={[
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 0.5, 0),
          forces.drag / 1000,
          0xff6600
        ]}
      />
    </group>
  );
};

/**
 * Main 3D scene
 */
const Scene = ({ wingData, pressureData, forces, showPressure }) => {
  const wingGeometry = createWingGeometry();
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <pointLight position={[-10, -10, -5]} intensity={0.5} />
      
      {/* Wing */}
      <Wing
        geometry={wingGeometry}
        pressureData={pressureData}
        showPressure={showPressure}
      />
      
      {/* Force vectors */}
      <ForceArrows forces={forces} />
      
      {/* Ground plane */}
      <Grid
        args={[10, 10]}
        position={[0, -0.5, 0]}
        cellColor="#6f6f6f"
        sectionColor="#9d4b4b"
      />
    </>
  );
};

/**
 * Main visualization component
 */
const AeroVisualization = ({ data }) => {
  const [showPressure, setShowPressure] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  
  return (
    <div className="w-full h-full relative">
      {/* 3D Canvas */}
      <Canvas>
        <PerspectiveCamera makeDefault position={[3, 2, 3]} />
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          autoRotate={autoRotate}
          autoRotateSpeed={1}
        />
        
        <Scene
          wingData={data?.geometry}
          pressureData={data?.pressure}
          forces={data?.forces}
          showPressure={showPressure}
        />
      </Canvas>
      
      {/* Controls overlay */}
      <div className="absolute top-4 right-4 bg-white bg-opacity-90 p-4 rounded-lg shadow-lg">
        <h3 className="font-bold mb-2">Visualization Controls</h3>
        
        <label className="flex items-center mb-2">
          <input
            type="checkbox"
            checked={showPressure}
            onChange={(e) => setShowPressure(e.target.checked)}
            className="mr-2"
          />
          Show Pressure Distribution
        </label>
        
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
            className="mr-2"
          />
          Auto Rotate
        </label>
      </div>
      
      {/* Colorbar legend */}
      {showPressure && (
        <div className="absolute bottom-4 right-4 bg-white bg-opacity-90 p-4 rounded-lg shadow-lg">
          <h4 className="font-bold mb-2">Pressure Coefficient (Cp)</h4>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-32 bg-gradient-to-t from-blue-600 via-green-500 via-yellow-400 to-red-600" />
            <div className="flex flex-col justify-between h-32 text-xs">
              <span>1.0 (High)</span>
              <span>0.0</span>
              <span>-3.0 (Low)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AeroVisualization;
