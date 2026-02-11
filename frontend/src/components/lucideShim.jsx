import React from 'react';

const BaseIcon = ({ className = '', size = 16, strokeWidth = 2, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    aria-hidden="true"
    {...props}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
);

export const Activity = BaseIcon;
export const AlertCircle = BaseIcon;
export const AlertTriangle = BaseIcon;
export const ArrowRight = BaseIcon;
export const Atom = BaseIcon;
export const BarChart3 = BaseIcon;
export const Bot = BaseIcon;
export const Brain = BaseIcon;
export const CheckCircle = BaseIcon;
export const Circle = BaseIcon;
export const Clock = BaseIcon;
export const Cpu = BaseIcon;
export const Database = BaseIcon;
export const Download = BaseIcon;
export const Droplets = BaseIcon;
export const GitBranch = BaseIcon;
export const Grid = BaseIcon;
export const Grid3x3 = BaseIcon;
export const HardDrive = BaseIcon;
export const Layers = BaseIcon;
export const Loader = BaseIcon;
export const LoaderCircle = BaseIcon;
export const Lock = BaseIcon;
export const LogIn = BaseIcon;
export const LogOut = BaseIcon;
export const Mail = BaseIcon;
export const Mic = BaseIcon;
export const Network = BaseIcon;
export const Pause = BaseIcon;
export const Play = BaseIcon;
export const RefreshCw = BaseIcon;
export const RotateCcw = BaseIcon;
export const Save = BaseIcon;
export const Send = BaseIcon;
export const Server = BaseIcon;
export const Settings = BaseIcon;
export const Shield = BaseIcon;
export const Sliders = BaseIcon;
export const Sparkles = BaseIcon;
export const Square = BaseIcon;
export const Target = BaseIcon;
export const Tornado = BaseIcon;
export const TrendingDown = BaseIcon;
export const TrendingUp = BaseIcon;
export const User = BaseIcon;
export const UserPlus = BaseIcon;
export const Waves = BaseIcon;
export const Wind = BaseIcon;
export const X = BaseIcon;
export const XCircle = BaseIcon;
export const Zap = BaseIcon;
