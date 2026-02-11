/**
 * Agent Communication Graph
 * Real-time visualization of agent-to-agent communication via SLIM/NATS
 */

import React, { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Network, Activity, Zap } from './lucideShim';

const AgentCommunicationGraph = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState({
    totalMessages: 0,
    avgLatency: 0,
    activeAgents: 0
  });

  const initializeAgentGraph = useCallback(() => {
    // Define agent nodes
    const agentNodes = [
      {
        id: 'master',
        type: 'input',
        data: { 
          label: '🎯 Master Orchestrator',
          status: 'active',
          model: 'Claude Sonnet 4.5'
        },
        position: { x: 400, y: 50 },
        style: {
          background: '#8b5cf6',
          color: 'white',
          border: '2px solid #6d28d9',
          borderRadius: '10px',
          padding: '15px',
          fontSize: '14px',
          fontWeight: 'bold'
        }
      },
      {
        id: 'intent',
        data: { 
          label: '🎯 Intent Router',
          status: 'active',
          model: 'Claude Haiku'
        },
        position: { x: 400, y: 150 },
        style: {
          background: '#3b82f6',
          color: 'white',
          border: '2px solid #1d4ed8',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'aero',
        data: { 
          label: '🌊 Aerodynamics',
          status: 'active',
          model: 'Claude Sonnet 4.5'
        },
        position: { x: 100, y: 300 },
        style: {
          background: '#10b981',
          color: 'white',
          border: '2px solid #059669',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'ml',
        data: { 
          label: '🧠 ML Surrogate',
          status: 'active',
          model: 'Claude Haiku'
        },
        position: { x: 300, y: 300 },
        style: {
          background: '#06b6d4',
          color: 'white',
          border: '2px solid #0891b2',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'quantum',
        data: { 
          label: '⚛️ Quantum Optimizer',
          status: 'idle',
          model: 'Claude Sonnet 4.5'
        },
        position: { x: 500, y: 300 },
        style: {
          background: '#f59e0b',
          color: 'white',
          border: '2px solid #d97706',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'physics',
        data: { 
          label: '🔬 Physics Validator',
          status: 'active',
          model: 'Claude Haiku'
        },
        position: { x: 700, y: 300 },
        style: {
          background: '#ec4899',
          color: 'white',
          border: '2px solid #db2777',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'analysis',
        data: { 
          label: '📊 Analysis',
          status: 'active',
          model: 'Claude Sonnet 4.5'
        },
        position: { x: 200, y: 450 },
        style: {
          background: '#8b5cf6',
          color: 'white',
          border: '2px solid #6d28d9',
          borderRadius: '10px',
          padding: '12px'
        }
      },
      {
        id: 'viz',
        data: { 
          label: '🎨 Visualization',
          status: 'idle',
          model: 'Claude Haiku'
        },
        position: { x: 600, y: 450 },
        style: {
          background: '#6366f1',
          color: 'white',
          border: '2px solid #4f46e5',
          borderRadius: '10px',
          padding: '12px'
        }
      }
    ];

    // Define communication edges
    const agentEdges = [
      {
        id: 'e-master-intent',
        source: 'master',
        target: 'intent',
        animated: false,
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' }
      },
      {
        id: 'e-intent-aero',
        source: 'intent',
        target: 'aero',
        animated: false,
        style: { stroke: '#10b981', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' }
      },
      {
        id: 'e-intent-ml',
        source: 'intent',
        target: 'ml',
        animated: false,
        style: { stroke: '#06b6d4', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' }
      },
      {
        id: 'e-intent-quantum',
        source: 'intent',
        target: 'quantum',
        animated: false,
        style: { stroke: '#f59e0b', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' }
      },
      {
        id: 'e-intent-physics',
        source: 'intent',
        target: 'physics',
        animated: false,
        style: { stroke: '#ec4899', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#ec4899' }
      },
      {
        id: 'e-ml-analysis',
        source: 'ml',
        target: 'analysis',
        animated: false,
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' }
      },
      {
        id: 'e-physics-analysis',
        source: 'physics',
        target: 'analysis',
        animated: false,
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' }
      },
      {
        id: 'e-aero-viz',
        source: 'aero',
        target: 'viz',
        animated: false,
        style: { stroke: '#6366f1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' }
      }
    ];

    setNodes(agentNodes);
    setEdges(agentEdges);
  }, [setEdges, setNodes]);

  const simulateMessageFlow = useCallback(() => {
    // Simulate a message being sent
    const messageTypes = [
      { from: 'master', to: 'intent', type: 'task_decomposition', latency: 45 },
      { from: 'intent', to: 'ml', type: 'predict_request', latency: 23 },
      { from: 'ml', to: 'analysis', type: 'prediction_result', latency: 87 },
      { from: 'intent', to: 'physics', type: 'validate_request', latency: 156 },
      { from: 'physics', to: 'analysis', type: 'validation_result', latency: 234 }
    ];

    const randomMessage = messageTypes[Math.floor(Math.random() * messageTypes.length)];

    // Animate the edge
    setEdges(edges => edges.map(edge => {
      if (edge.source === randomMessage.from && edge.target === randomMessage.to) {
        return { ...edge, animated: true, style: { ...edge.style, strokeWidth: 4 } };
      }
      return { ...edge, animated: false, style: { ...edge.style, strokeWidth: 2 } };
    }));

    // Add message to log
    const newMessage = {
      id: Date.now(),
      ...randomMessage,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages(prev => [newMessage, ...prev].slice(0, 10));

    // Update stats
    setStats(prev => ({
      totalMessages: prev.totalMessages + 1,
      avgLatency: (prev.avgLatency * prev.totalMessages + randomMessage.latency) / (prev.totalMessages + 1),
      activeAgents: 6
    }));

    // Reset animation after 1 second
    setTimeout(() => {
      setEdges(edges => edges.map(edge => ({
        ...edge,
        animated: false,
        style: { ...edge.style, strokeWidth: 2 }
      })));
    }, 1000);
  }, [setEdges]);

  useEffect(() => {
    initializeAgentGraph();

    // Simulate real-time message flow
    const interval = setInterval(() => {
      simulateMessageFlow();
    }, 2000);

    return () => clearInterval(interval);
  }, [initializeAgentGraph, simulateMessageFlow]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Network className="w-6 h-6" />
        Agent Communication Graph
      </h2>

      <p className="text-gray-600 mb-4">
        Real-time visualization of agent-to-agent communication via SLIM/NATS messaging
      </p>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="p-3 bg-purple-50 border border-purple-200 rounded">
          <div className="text-sm text-purple-700">Total Messages</div>
          <div className="text-2xl font-bold text-purple-900">{stats.totalMessages}</div>
        </div>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm text-blue-700">Avg Latency</div>
          <div className="text-2xl font-bold text-blue-900">{stats.avgLatency.toFixed(0)}ms</div>
        </div>
        <div className="p-3 bg-green-50 border border-green-200 rounded">
          <div className="text-sm text-green-700">Active Agents</div>
          <div className="text-2xl font-bold text-green-900">{stats.activeAgents}/8</div>
        </div>
      </div>

      {/* Graph Visualization */}
      <div className="mb-4 border-2 border-gray-300 rounded-lg" style={{ height: '500px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      </div>

      {/* Message Log */}
      <div className="p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Recent Messages
        </h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {messages.map(msg => (
            <div key={msg.id} className="flex items-center justify-between text-sm p-2 bg-white rounded">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-600" />
                <span className="font-mono text-xs">
                  {msg.from} → {msg.to}
                </span>
                <span className="text-gray-600">|</span>
                <span className="text-gray-700">{msg.type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">{msg.latency}ms</span>
                <span className="text-gray-400">{msg.timestamp}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentCommunicationGraph;
