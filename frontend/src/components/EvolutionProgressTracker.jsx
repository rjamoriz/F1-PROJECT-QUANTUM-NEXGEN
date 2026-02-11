/**
 * Evolution Progress Tracker
 * Track 2026-2027 roadmap implementation progress
 */

import React, { useState } from 'react';
import { TrendingUp, CheckCircle, Clock, AlertCircle, Target, Zap } from './lucideShim';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const EvolutionProgressTracker = () => {
  const [selectedPhase, setSelectedPhase] = useState('phase1');

  // Progress data
  const phases = {
    phase1: {
      name: 'Phase 1: Advanced AI Surrogates',
      timeline: 'Q2 2026',
      status: 'in_progress',
      progress: 60,
      components: [
        { name: 'AeroTransformer', status: 'complete', progress: 100, lines: 2500 },
        { name: 'GNN-RANS', status: 'complete', progress: 100, lines: 1600 },
        { name: 'VQE Quantum', status: 'complete', progress: 100, lines: 800 },
        { name: 'AeroGAN', status: 'planned', progress: 0, lines: 0 },
        { name: 'Diffusion Models', status: 'planned', progress: 0, lines: 0 }
      ]
    },
    phase2: {
      name: 'Phase 2: Quantum Scale-Up',
      timeline: 'Q3 2026',
      status: 'planned',
      progress: 10,
      components: [
        { name: 'VQE Integration', status: 'in_progress', progress: 50, lines: 800 },
        { name: 'D-Wave Annealing', status: 'planned', progress: 0, lines: 0 },
        { name: 'Error Mitigation', status: 'planned', progress: 0, lines: 0 },
        { name: 'Hybrid Solver', status: 'planned', progress: 0, lines: 0 }
      ]
    },
    phase3: {
      name: 'Phase 3: Generative Design',
      timeline: 'Q4 2026',
      status: 'research',
      progress: 0,
      components: [
        { name: 'Diffusion Models', status: 'research', progress: 0, lines: 0 },
        { name: 'RL Active Control', status: 'research', progress: 0, lines: 0 },
        { name: 'Generative Studio', status: 'research', progress: 0, lines: 0 }
      ]
    },
    phase4: {
      name: 'Phase 4: Production Integration',
      timeline: 'Q1 2027',
      status: 'planning',
      progress: 0,
      components: [
        { name: 'Digital Twin', status: 'planning', progress: 0, lines: 0 },
        { name: 'Telemetry Loop', status: 'planning', progress: 0, lines: 0 },
        { name: 'F1 Deployment', status: 'planning', progress: 0, lines: 0 }
      ]
    }
  };

  // Overall metrics
  const overallMetrics = {
    totalComponents: 22,
    completedComponents: 6,
    inProgressComponents: 1,
    totalLines: 6900,
    hoursSpent: 45,
    estimatedRemaining: 455
  };

  // Performance targets
  const performanceTargets = [
    { metric: 'CFD Inference', current: 45, target: 50, unit: 'ms', status: 'achieved' },
    { metric: 'GNN-RANS Speedup', current: 1250, target: 1000, unit: 'x', status: 'achieved' },
    { metric: 'Quantum Qubits', current: 20, target: 100, unit: '', status: 'in_progress' },
    { metric: 'Design Candidates', current: 100, target: 1000, unit: '/day', status: 'in_progress' }
  ];

  // Timeline data
  const timelineData = [
    { month: 'Nov 2025', phase1: 25, phase2: 0, phase3: 0, phase4: 0 },
    { month: 'Dec 2025', phase1: 60, phase2: 10, phase3: 0, phase4: 0 },
    { month: 'Jan 2026', phase1: 90, phase2: 30, phase3: 0, phase4: 0 },
    { month: 'Feb 2026', phase1: 100, phase2: 50, phase3: 10, phase4: 0 },
    { month: 'Mar 2026', phase1: 100, phase2: 80, phase3: 20, phase4: 0 },
    { month: 'Apr 2026', phase1: 100, phase2: 100, phase3: 40, phase4: 10 }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete': return 'bg-green-100 border-green-300 text-green-800';
      case 'in_progress': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'planned': return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 'research': return 'bg-orange-100 border-orange-300 text-orange-800';
      case 'planning': return 'bg-gray-100 border-gray-300 text-gray-600';
      default: return 'bg-gray-100 border-gray-300 text-gray-600';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'complete': return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-blue-600 animate-pulse" />;
      case 'planned': return <Target className="w-5 h-5 text-yellow-600" />;
      default: return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <TrendingUp className="w-6 h-6 text-blue-600" />
        Evolution Progress Tracker
      </h2>

      <p className="text-gray-600 mb-6">
        Real-time tracking of 2026-2027 evolution roadmap implementation.
      </p>

      {/* Overall Progress */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-blue-600" />
            <span className="text-sm text-blue-700">Components Complete</span>
          </div>
          <div className="text-3xl font-bold text-blue-900">
            {overallMetrics.completedComponents}/{overallMetrics.totalComponents}
          </div>
          <div className="text-xs text-blue-600">
            {((overallMetrics.completedComponents / overallMetrics.totalComponents) * 100).toFixed(0)}% complete
          </div>
        </div>

        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-700">Lines of Code</span>
          </div>
          <div className="text-3xl font-bold text-green-900">
            {overallMetrics.totalLines.toLocaleString()}
          </div>
          <div className="text-xs text-green-600">Production ready</div>
        </div>

        <div className="p-4 bg-purple-50 border border-purple-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-purple-600" />
            <span className="text-sm text-purple-700">Hours Invested</span>
          </div>
          <div className="text-3xl font-bold text-purple-900">
            {overallMetrics.hoursSpent}
          </div>
          <div className="text-xs text-purple-600">
            {overallMetrics.estimatedRemaining} remaining
          </div>
        </div>

        <div className="p-4 bg-orange-50 border border-orange-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-5 h-5 text-orange-600" />
            <span className="text-sm text-orange-700">Overall Progress</span>
          </div>
          <div className="text-3xl font-bold text-orange-900">
            {((overallMetrics.completedComponents / overallMetrics.totalComponents) * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-orange-600">On track</div>
        </div>
      </div>

      {/* Phase Selection */}
      <div className="mb-6 flex gap-2">
        {Object.keys(phases).map((phaseKey) => (
          <button
            key={phaseKey}
            onClick={() => setSelectedPhase(phaseKey)}
            className={`flex-1 px-4 py-2 rounded font-semibold ${
              selectedPhase === phaseKey
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {phases[phaseKey].name.split(':')[0]}
          </button>
        ))}
      </div>

      {/* Selected Phase Details */}
      {selectedPhase && (
        <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-semibold text-lg">{phases[selectedPhase].name}</h3>
              <p className="text-sm text-gray-600">{phases[selectedPhase].timeline}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-blue-600">{phases[selectedPhase].progress}%</div>
              <div className={`text-sm px-3 py-1 rounded ${getStatusColor(phases[selectedPhase].status)}`}>
                {phases[selectedPhase].status.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                style={{ width: `${phases[selectedPhase].progress}%` }}
              />
            </div>
          </div>

          {/* Components */}
          <div className="space-y-2">
            {phases[selectedPhase].components.map((component, idx) => (
              <div key={idx} className={`p-3 rounded border-2 ${getStatusColor(component.status)}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(component.status)}
                    <div>
                      <div className="font-semibold">{component.name}</div>
                      <div className="text-xs opacity-75">
                        {component.lines > 0 ? `${component.lines} lines` : 'Not started'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{component.progress}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Targets */}
      <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Performance Targets</h3>
        <div className="space-y-3">
          {performanceTargets.map((target, idx) => (
            <div key={idx} className="p-3 bg-white rounded border">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{target.metric}</span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  target.status === 'achieved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {target.status === 'achieved' ? '✓ Achieved' : '⏳ In Progress'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Current: {target.current}{target.unit}</span>
                    <span>Target: {target.target}{target.unit}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        target.current >= target.target ? 'bg-green-600' : 'bg-blue-600'
                      }`}
                      style={{ width: `${Math.min((target.current / target.target) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Chart */}
      <div className="p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-3">Implementation Timeline</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timelineData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis label={{ value: 'Progress (%)', angle: -90, position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="phase1" stroke="#3b82f6" strokeWidth={2} name="Phase 1" />
            <Line type="monotone" dataKey="phase2" stroke="#8b5cf6" strokeWidth={2} name="Phase 2" />
            <Line type="monotone" dataKey="phase3" stroke="#f59e0b" strokeWidth={2} name="Phase 3" />
            <Line type="monotone" dataKey="phase4" stroke="#10b981" strokeWidth={2} name="Phase 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default EvolutionProgressTracker;
