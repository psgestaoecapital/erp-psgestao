import GuardaPlanoArea from '@/lib/area/GuardaPlanoArea'

// Guarda de plano da área Revenda de Veículos: empresa sem o plano vê "não contratado · trocar de
// empresa" em vez do vazio. Cobre /dashboard/revenda/*.
export default function RevendaLayout({ children }: { children: React.ReactNode }) {
  return <GuardaPlanoArea areaSlug="revenda_veiculos" areaNome="Revenda de Veículos">{children}</GuardaPlanoArea>
}
