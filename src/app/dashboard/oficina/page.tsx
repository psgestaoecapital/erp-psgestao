import OficinaHome from '@/components/oficina/OficinaHome'

// RD-41 · home da Oficina = operação real do tenant (por company_id), não o painel
// comercial interno da PS. Zero placeholder — todo número vem do banco do tenant.
export default function OficinaRootPage() {
  return <OficinaHome />
}
