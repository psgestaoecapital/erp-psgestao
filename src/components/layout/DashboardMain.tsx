'use client'
import { usePathname } from 'next/navigation'

// Rotas que ocupam a LARGURA TODA (boards/tabelas largas). Opt-out por rota:
// o default é IDÊNTICO ao wrapper antigo (max-w-[1400px] centrado) — nenhuma outra tela muda.
// Array simples para crescer. Candidatas futuras (revisar em lote, decisão do CEO):
//   /dashboard/analises · /dashboard/relatorio · /dashboard/dre-divisional ·
//   /dashboard/operacional · /dashboard/admin/trilha-auditoria · /dashboard/visao-mensal
const FULL_WIDTH_ROUTES: string[] = [
  '/dashboard/projetos/oportunidades',
]

export default function DashboardMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const fullWidth = FULL_WIDTH_ROUTES.includes(pathname ?? '')
  return (
    <main
      className={
        fullWidth
          ? 'flex-1 w-full px-4 py-6'
          : 'flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-6'
      }
    >
      {children}
    </main>
  )
}
