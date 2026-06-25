import { Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import TopNav from '@/components/layout/TopNav'
import AreaRedirectGuard from '@/components/layout/AreaRedirectGuard'
import { SelectedCompanyProvider } from '@/contexts/SelectedCompanyContext'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SelectedCompanyProvider>
      <Suspense fallback={null}><AreaRedirectGuard /></Suspense>
      <div className="min-h-screen bg-[#FAF7F2]">
        <Sidebar />
        <div className="md:ml-[220px] min-h-screen flex flex-col">
          <TopNav />
          <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
            <Suspense fallback={null}>{children}</Suspense>
          </main>
        </div>
      </div>
    </SelectedCompanyProvider>
  )
}
