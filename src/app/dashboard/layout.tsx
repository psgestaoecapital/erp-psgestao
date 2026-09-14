import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopNav from '@/components/layout/TopNav'
import AreaRedirectGuard from '@/components/layout/AreaRedirectGuard'
import RecoveryGuard from '@/components/layout/RecoveryGuard'
import ConsentGuard from '@/components/layout/ConsentGuard'
import DashboardMain from '@/components/layout/DashboardMain'
import { SelectedCompanyProvider } from '@/contexts/SelectedCompanyContext'
import AjudaWidget from '@/components/ajuda/AjudaWidget'
import ChatWidget from '@/components/chat/ChatWidget'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SelectedCompanyProvider>
      <Suspense fallback={null}><AreaRedirectGuard /></Suspense>
      <Suspense fallback={null}><RecoveryGuard /></Suspense>
      {/* GATE LGPD (P0): restaura a chamada que sumiu no #126. Redireciona pra ROTA /aceite
          quem está pendente na versão vigente — nunca modal no root (evita a causa do #126). */}
      <Suspense fallback={null}><ConsentGuard /></Suspense>
      <div className="min-h-screen bg-[#FAF7F2]">
        <Sidebar />
        <div className="md:ml-[220px] min-h-screen flex flex-col">
          <TopNav />
          <DashboardMain>
            <Suspense fallback={null}>{children}</Suspense>
          </DashboardMain>
        </div>
      </div>
      {/* FABs flutuantes (ajuda "?" + comunicador). data-no-print → o @media print do globals.css esconde
          todo o subtree, tirando-os de CIMA da OS na impressão (pedido Jordana). display:none no wrapper
          remove os filhos position:fixed do render impresso. */}
      <div data-no-print="true">
        {/* Central de Ajuda · widget "?" contextual (F0 Fatia 3) — presente em toda tela do dashboard */}
        <AjudaWidget />
        {/* Comunicador Interno da Equipe · widget flutuante (tempo real) — presente em toda tela */}
        <ChatWidget />
      </div>
    </SelectedCompanyProvider>
  )
}
