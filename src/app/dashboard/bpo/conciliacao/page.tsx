// Rota legada (wrapper BPO) · redireciona pro entrypoint canonico em
// /dashboard/financeiro/conciliacao/inbox · FIX-CONCILIACAO-CONSOLIDACAO-v1.
import { redirect } from 'next/navigation'

export default function BpoConciliacaoRedirect() {
  redirect('/dashboard/financeiro/conciliacao/inbox')
}
