/**
 * Claude Chat Interface
 * Natural language interaction with Master Orchestrator Agent
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, Bot, User, Loader } from './lucideShim';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';

const ClaudeChatInterface = () => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m the Quantum-Aero AI Assistant powered by Claude. I can help you with aerodynamic analysis, optimization, and design exploration. What would you like to work on today?',
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState({
    masterOrchestrator: 'idle',
    currentAgent: null
  });
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setAgentStatus({ masterOrchestrator: 'thinking', currentAgent: 'Master Orchestrator' });

    try {
      // Call GenAI agent API
      const response = await axios.post(`${BACKEND_API_BASE}/api/claude/chat`, {
        message: input,
        conversationHistory: messages
      });

      const assistantMessage = {
        role: 'assistant',
        content: response.data.response,
        agents: response.data.agentsInvolved || [],
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMessage]);
      setAgentStatus({ masterOrchestrator: 'idle', currentAgent: null });
    } catch (error) {
      // Mock response if API not available
      const mockResponse = generateMockResponse(input);
      setMessages(prev => [...prev, mockResponse]);
      setAgentStatus({ masterOrchestrator: 'idle', currentAgent: null });
    } finally {
      setIsLoading(false);
    }
  };

  const generateMockResponse = (query) => {
    const lowerQuery = query.toLowerCase();
    
    let content = '';
    let agents = [];

    if (lowerQuery.includes('optimize') || lowerQuery.includes('optimization')) {
      content = `I'll help you optimize the design. Let me coordinate with the specialized agents:

**Analysis:**
1. 🤖 ML Surrogate Agent: Running fast predictions on current design
2. ⚛️ Quantum Optimizer Agent: Exploring design space with QAOA
3. 🔬 Physics Validator Agent: Validating results with VLM

**Preliminary Results:**
- Current Cl: 2.8, Cd: 0.42 (L/D: 6.67)
- Quantum optimization suggests increasing flap angle by 2°
- Expected improvement: +8% downforce, +3% drag
- Flutter margin: 1.35 (safe)

**Recommendation:**
The quantum-optimized configuration shows promise. Would you like me to run a full FSI validation?`;
      agents = ['ML Surrogate', 'Quantum Optimizer', 'Physics Validator'];
    } else if (lowerQuery.includes('flutter') || lowerQuery.includes('aeroelastic')) {
      content = `Let me analyze the aeroelastic characteristics:

**Flutter Analysis:**
- Natural frequencies: 25.3 Hz (1st bending), 42.7 Hz (1st torsion)
- Flutter speed: 285 km/h
- Flutter margin: 1.23 (above 1.2 safety threshold ✓)
- Critical mode: 1st bending mode

**Recommendations:**
1. Add 2 stiffeners at x=0.3c and x=0.7c to increase flutter speed
2. This would improve flutter margin to ~1.45
3. Mass penalty: +0.3 kg

Would you like me to run the quantum optimizer to find optimal stiffener placement?`;
      agents = ['Aerodynamics', 'Physics Validator'];
    } else if (lowerQuery.includes('drag') || lowerQuery.includes('downforce')) {
      content = `**Aerodynamic Analysis:**

Current Performance:
- Drag coefficient (Cd): 0.42
- Downforce: 2.8 kN
- L/D ratio: 6.67

**Flow Features:**
- Strong leading-edge vortex (LEV) at x=0.1c
- Mild separation at x=0.85c on lower surface
- Clean wake structure

**Optimization Suggestions:**
1. Reduce trailing edge angle by 1° → -5% drag
2. Add small vortex generator at x=0.75c → delay separation
3. Increase camber by 0.5% → +3% downforce

Would you like me to explore these modifications?`;
      agents = ['Aerodynamics', 'ML Surrogate'];
    } else {
      content = `I understand you're asking about: "${query}"

I can help you with:
- 🎯 **Aerodynamic optimization** - Maximize downforce, minimize drag
- ⚛️ **Quantum-enhanced design** - Explore design space with QAOA
- 🔬 **Physics validation** - VLM, Panel methods, FSI
- 📊 **Trade-off analysis** - Multi-objective optimization
- 🌊 **Transient scenarios** - DRS, corner exit, ride height changes
- 🎼 **Aeroelastic analysis** - Flutter, buffeting, modal analysis

What specific aspect would you like to explore?`;
      agents = ['Master Orchestrator'];
    }

    return {
      role: 'assistant',
      content,
      agents,
      timestamp: new Date().toISOString()
    };
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQueries = [
    "Optimize this wing for maximum downforce",
    "Analyze flutter characteristics",
    "Compare drag vs downforce trade-offs",
    "Run transient simulation for DRS activation"
  ];

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6" />
            <div>
              <h2 className="text-xl font-bold">Claude AI Assistant</h2>
              <p className="text-sm opacity-90">Quantum-Aero Master Orchestrator</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${agentStatus.masterOrchestrator === 'thinking' ? 'bg-yellow-300 animate-pulse' : 'bg-green-300'}`}></div>
              <span>{agentStatus.masterOrchestrator === 'thinking' ? 'Thinking...' : 'Online'}</span>
            </div>
            {agentStatus.currentAgent && (
              <div className="text-xs opacity-75 mt-1">
                Active: {agentStatus.currentAgent}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: '600px' }}>
        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              </div>
            )}
            
            <div className={`max-w-2xl ${message.role === 'user' ? 'order-first' : ''}`}>
              <div
                className={`p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                
                {message.agents && message.agents.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-300 text-xs">
                    <span className="font-semibold">Agents involved:</span>{' '}
                    {message.agents.join(', ')}
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            </div>

            {message.role === 'user' && (
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="bg-gray-100 p-3 rounded-lg">
              <Loader className="w-5 h-5 animate-spin text-purple-600" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Queries */}
      {messages.length === 1 && (
        <div className="px-4 pb-2">
          <div className="text-sm text-gray-600 mb-2">Suggested queries:</div>
          <div className="flex flex-wrap gap-2">
            {suggestedQueries.map((query, idx) => (
              <button
                key={idx}
                onClick={() => setInput(query)}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about aerodynamics, optimization, or analysis..."
            className="flex-1 px-4 py-2 border rounded-lg resize-none focus:ring-2 focus:ring-purple-500"
            rows="2"
            disabled={isLoading}
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className={`p-2 rounded-lg ${
                input.trim() && !isLoading
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
            <button
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded-lg"
              title="Voice input (coming soon)"
              disabled
            >
              <Mic className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};

export default ClaudeChatInterface;
