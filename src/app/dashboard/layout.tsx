import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopNav from '@/components/layout/TopNav'
import AreaRedirectGuard from '@/components/layout/AreaRedirectGuard'
import DashboardMain from '@/components/layout/DashboardMain'
import { SelectedCompanyProvider } from '@/contexts/SelectedCompanyContext'
import AjudaWidget from '@/components/ajuda/AjudaWidget'
import ChatWidget from '@/components/chat/ChatWidget'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SelectedCompanyProvider>
      <Suspense fallback={null}><AreaRedirectGuard /></Suspense>
      <div className="min-h-screen bg-[#FAF7F2]">
        <Sidebar />
        <div className="md:ml-[220px] min-h-screen flex flex-col">
          <TopNav />
          <DashboardMain>
            <Suspense fallback={null}>{children}</Suspense>
          </DashboardMain>
        </div>
      </div>
      {/* Central de Ajuda · widget "?" contextual (F0 Fatia 3) — presente em toda tela do dashboard */}
      <AjudaWidget />
      {/* Comunicador Interno da Equipe · widget flutuante (tempo real) — presente em toda tela */}
      <ChatWidget />
    </SelectedCompanyProvider>
  )
}
