import { redirect } from 'next/navigation'

// A tela inicial do módulo Agro é o Dashboard da fazenda (DASHBOARD-AGRO Sprint 1).
export default function AgroRootPage() {
  redirect('/dashboard/agro/dashboard')
}
