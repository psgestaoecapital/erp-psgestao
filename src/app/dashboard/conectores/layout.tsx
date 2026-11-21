'use client'

// Guarda de rota do Hub para /dashboard/conectores (Conectores ERP) (Onda M0 · CEO 21/11). Ver HubRotaGuard.
import HubRotaGuard from '@/components/layout/HubRotaGuard'

export default function ConectoresLayout({ children }: { children: React.ReactNode }) {
  return <HubRotaGuard>{children}</HubRotaGuard>
}
