// Rota legada de detalhe de lote · redireciona pro entrypoint canonico
// em /dashboard/financeiro/conciliacao/inbox · FIX-CONCILIACAO-CONSOLIDACAO-v1.
import { redirect } from 'next/navigation'

export default function ConciliacaoFinanceiroLoteRedirect() {
  redirect('/dashboard/financeiro/conciliacao/inbox')
}
