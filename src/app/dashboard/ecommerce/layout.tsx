import GuardaPlanoArea from '@/lib/area/GuardaPlanoArea'

// Guarda de plano da área E-commerce: empresa sem o plano vê "não contratado · trocar de empresa". Cobre /dashboard/ecommerce/*.
export default function EcommerceLayout({ children }: { children: React.ReactNode }) {
  return <GuardaPlanoArea areaSlug="ecommerce" areaNome="E-commerce">{children}</GuardaPlanoArea>
}
