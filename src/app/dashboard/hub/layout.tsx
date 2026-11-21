'use client'

// Guarda de rota do Hub para /dashboard/hub/* (Onda M0 · CEO 21/11). Ver src/components/layout/HubRotaGuard.tsx.
import HubRotaGuard from '@/components/layout/HubRotaGuard'

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return <HubRotaGuard>{children}</HubRotaGuard>
}
