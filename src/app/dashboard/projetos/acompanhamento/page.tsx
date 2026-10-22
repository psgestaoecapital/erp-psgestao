// Hub · "Orçado vs realizado" já existe pronto em /obras/resultado (v_obra_resultado: previsto × realizado
// por obra). Redirect de servidor (sem estado, sem loading): o redirect de cliente ficava preso em
// "Abrindo Orçado vs realizado…" na auditoria do chamado #3418.
import { redirect } from 'next/navigation'

export default function AcompanhamentoPage() {
  redirect('/dashboard/projetos/obras/resultado')
}
