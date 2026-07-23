import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopNav from '@/components/layout/TopNav'
import AreaRedirectGuard from '@/components/layout/AreaRedirectGuard'
import DashboardMain from '@/components/layout/DashboardMain'
import { SelectedCompanyProvider } from '@/contexts/SelectedCompanyContext'

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
    </SelectedCompanyProvider>
  )
}
