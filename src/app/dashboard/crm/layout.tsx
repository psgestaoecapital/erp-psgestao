import GuardaPlanoArea from '@/lib/area/GuardaPlanoArea'

// Guarda de plano da área PS CRM: empresa sem o plano vê "não contratado · trocar de empresa" em vez do vazio.
// Cobre /dashboard/crm/*.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <GuardaPlanoArea areaSlug="crm" areaNome="CRM">{children}</GuardaPlanoArea>
}
