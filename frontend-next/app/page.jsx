import DashboardShell from '@/components/dashboard-shell';
import { AuthProvider } from '@/components/auth/auth-provider';

export default function HomePage() {
  return (
    <AuthProvider>
      <DashboardShell />
    </AuthProvider>
  );
}
