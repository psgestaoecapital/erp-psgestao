import GuardaPlanoArea from '@/lib/area/GuardaPlanoArea'

// Guarda de plano da área Agro (print CEO 19/09): empresa sem plano agro vê "não contratado · trocar
// de empresa" em vez de "não tem propriedade". Cobre todas as sub-rotas /dashboard/agro/*.
export default function AgroLayout({ children }: { children: React.ReactNode }) {
  return <GuardaPlanoArea areaSlug="agro" areaNome="Agro">{children}</GuardaPlanoArea>
}
