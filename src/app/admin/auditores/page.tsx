import PainelAuditores from '@/components/admin/PainelAuditores'

export const dynamic = 'force-dynamic'

// Gate is_admin: TODO. Componente é client e busca os dados via RLS;
// usuários sem permissão verão erro/lista vazia até o gate ser adicionado.
export default function Page() {
  return <PainelAuditores />
}
