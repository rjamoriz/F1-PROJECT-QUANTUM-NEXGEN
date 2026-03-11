'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  Gauge,
  GitBranch,
  Layers3,
  LogOut,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import ThemeToggle from '@/components/theme-toggle';
import OverviewPanel from '@/components/panels/overview-panel';
import WindTunnelPanel from '@/components/panels/wind-tunnel-panel';
import OperationsPanel from '@/components/panels/operations-panel';
import WorkflowPanel from '@/components/panels/workflow-panel';
import ProductionTwinPanel from '@/components/panels/production-twin-panel';
import QuantumPanel from '@/components/panels/quantum-panel';
import OptimizationPanel from '@/components/panels/optimization-panel';
import AuthScreen from '@/components/auth/auth-screen';
import { useAuth } from '@/components/auth/auth-provider';

export default function DashboardShell() {
  const {
    authReady,
    isHydratingUser,
    token,
    user,
    logout,
    logoutAll,
  } = useAuth();
  const [activeSection, setActiveSection] = useState('overview');
  const sections = useMemo(() => ([
    {
      id: 'overview',
      label: 'Overview',
      subtitle: 'Health + simulation pulse',
      icon: Gauge,
      panel: OverviewPanel,
    },
    {
      id: 'wind',
      label: 'Wind Tunnel',
      subtitle: 'VLM + quantum coupled runs',
      icon: Wind,
      panel: WindTunnelPanel,
    },
    {
      id: 'workflow',
      label: 'Workflow',
      subtitle: 'Timeline + stage durations',
      icon: GitBranch,
      panel: WorkflowPanel,
    },
    {
      id: 'quantum',
      label: 'Quantum',
      subtitle: 'Node optimization + CFD coupling',
      icon: Cpu,
      panel: QuantumPanel,
    },
    {
      id: 'optimization',
      label: 'Optimization',
      subtitle: 'Quantum-hybrid aero optimization',
      icon: Zap,
      panel: OptimizationPanel,
    },
    {
      id: 'production',
      label: 'Production Twin',
      subtitle: 'Telemetry + digital twin stream',
      icon: Waves,
      panel: ProductionTwinPanel,
    },
    {
      id: 'ops',
      label: 'Operations',
      subtitle: 'SLOs + incident controls',
      icon: Activity,
      panel: OperationsPanel,
    },
  ]), []);

  const active = useMemo(
    () => sections.find((section) => section.id === activeSection) || sections[0],
    [activeSection, sections]
  );

  if (!authReady || (token && isHydratingUser)) {
    return (
      <div className="qa-loading-shell">
        <div className="qa-loading-card qa-glass">Restoring session...</div>
      </div>
    );
  }

  if (!token || !user) {
    return <AuthScreen />;
  }

  const ActivePanel = active.panel;
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  return (
    <div className="qa-app-shell">
      <div className="qa-bg-orb qa-bg-orb-a" />
      <div className="qa-bg-orb qa-bg-orb-b" />
      <div className="qa-bg-grid" />

      <header className="qa-topbar qa-glass">
        <div>
          <p className="qa-kicker">Quantum-Aero F1</p>
          <h1>Next Dashboard Dark Studio</h1>
          <p className="qa-subtitle">Authenticated control shell with workflow, production twin, and quantum analytics.</p>
        </div>
        <div className="qa-topbar-right">
          <div className="qa-user-chip">
            <p>{user?.name || user?.email}</p>
            <small>{String(user?.role || 'viewer').toUpperCase()}</small>
          </div>
          <div className="qa-status-pill">
            <Cpu size={15} />
            <span>{isAdmin ? 'Admin Runtime' : 'Hybrid Runtime'}</span>
          </div>
          <button type="button" className="qa-ghost-btn" onClick={logoutAll}>
            Revoke All
          </button>
          <button type="button" className="qa-ghost-btn" onClick={logout}>
            <LogOut size={14} />
            Logout
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="qa-main-grid">
        <aside className="qa-sidebar qa-glass">
          <p className="qa-sidebar-title">Dashboard Sections</p>
          <nav>
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={section.id === active.id ? 'qa-nav-btn qa-nav-btn-active' : 'qa-nav-btn'}
                >
                  <Icon size={16} />
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="qa-sidebar-footer">
            <Layers3 size={14} />
            <span>Single-origin Next shell is now the default migration target.</span>
          </div>
        </aside>

        <main className="qa-content qa-glass">
          <div className="qa-section-header">
            <div>
              <h2>{active.label}</h2>
              <p>{active.subtitle}</p>
            </div>
          </div>
          <ActivePanel />
        </main>
      </div>
    </div>
  );
}
