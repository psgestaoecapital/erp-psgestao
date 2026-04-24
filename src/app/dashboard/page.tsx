'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/home');
  }, [router]);

  return (
    <div style={{
      padding: 40,
      background: '#FAF7F2',
      minHeight: '100vh',
      color: '#3D2314',
      fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      Carregando Dashboard...
    </div>
  );
}
