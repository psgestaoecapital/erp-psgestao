// Conjunto ÚNICO de ícones da interface PS (CEO 09/10): traço fino, 1.5 px, herda a cor do texto. Proibido emoji como ícone.
import { BarChart3, FileText, Bot, Wrench, type LucideProps } from 'lucide-react'

const ICONES = { leitura: BarChart3, documento: FileText, codes: Bot, ferramentas: Wrench } as const
export type NomeIcone = keyof typeof ICONES

export function Icone({ nome, size = 16, ...resto }: { nome: NomeIcone } & Omit<LucideProps, 'ref'>) {
  const C = ICONES[nome]
  return <C size={size} strokeWidth={1.5} aria-hidden="true" {...resto} />
}
