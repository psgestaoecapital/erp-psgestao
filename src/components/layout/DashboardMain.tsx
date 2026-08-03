'use client'
import { usePathname } from 'next/navigation'

// RD-41 · Layout global — o conteúdo do dashboard ocupa a LARGURA TODA (full-width),
// com padding lateral de respiro. Fix na RAIZ: antes o default era max-w-[1400px] mx-auto,
// que criava as margens vazias em TODAS as telas (a odonto/#819 já é full-width, mas o
// layout-mãe limitava). Agora o default é full-width; o PADDING é idêntico ao de antes
// (px-4 sm:px-6 py-6) — só sai o teto de 1400px. Regressão zero de espaçamento.
//
// EXCEÇÃO (opt-in): telas de formulário/leitura longa mantêm uma largura de conforto
// (max-w-3xl centrado) — esticar campos na tela inteira piora a usabilidade. Lista simples,
// cresce sob demanda (decisão do CEO). Telas que já se auto-limitam (maxWidth inline) não
// precisam entrar aqui.
const FORM_ROUTES: string[] = [
  '/dashboard/financeiro/nova-despesa',
  '/dashboard/financeiro/nova-receita',
]

export default function DashboardMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const modoForm = FORM_ROUTES.includes(pathname ?? '')
  return (
    <main
      className={
        modoForm
          // conforto de leitura: largura máxima centrada (campos não esticam)
          ? 'flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-6'
          // padrão: full-width + respiro lateral (mesmo padding de antes, sem o teto de 1400px)
          : 'flex-1 w-full px-4 sm:px-6 py-6'
      }
    >
      {children}
    </main>
  )
}
