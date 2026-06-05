// Rota legada de detalhe de lote · redireciona pro entrypoint canonico
// em /dashboard/financeiro/conciliacao/inbox · FIX-CONCILIACAO-CONSOLIDACAO-v1.
// (lote_id descartado intencionalmente · inbox e single source.)
import { redirect } from 'next/navigation'

export default function ConciliacaoLoteLegadaRedirect() {
  redirect('/dashboard/financeiro/conciliacao/inbox')
}
