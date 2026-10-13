// Conciliacao Bancaria · entrypoint canonico unico em /inbox.
// Esta rota era duplicada (placeholder do PR #162 + listagem propria) ·
// FIX-CONCILIACAO-CONSOLIDACAO-v1 unifica tudo em /inbox.
import { redirect } from 'next/navigation'

export default function ConciliacaoRedirect() {
  redirect('/dashboard/financeiro/conciliacao/inbox')
}
