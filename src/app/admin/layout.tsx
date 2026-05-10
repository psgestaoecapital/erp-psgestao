'use client';

import { AuthProvider, useAuth } from '@/lib/AuthProvider';
import Sidebar from '@/components/admin/Sidebar';
import { COR } from '@/components/admin/colors';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminShell>{children}</AdminShell>
    </AuthProvider>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: COR.cream,
        color: COR.espresso,
      }}
    >
      <Sidebar userEmail={user?.email ?? null} />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: '20px clamp(16px, 4vw, 32px) 40px',
        }}
      >
        {children}
      </main>
    </div>
  );
}
