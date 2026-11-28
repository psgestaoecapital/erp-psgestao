// Plano de Ação 5W2H — Indústria. 5W2H duplicado (ajuste do Eng. Chefe 25/11): a Indústria tinha DUAS entradas
// pro mesmo motor (erp_plano_acao + fn_plano_acao_*): esta (/dashboard/industrial/plano-acao) e a compartilhada
// (/dashboard/_compartilhado/plano-acao). Fica só a compartilhada. Esta rota redireciona pra lá (RD-30: nada
// apagado — a tela não foi removida, virou redirect; o catálogo industrial_plano_acao fica ativo=false na migration).
import { redirect } from 'next/navigation'

export default function PlanoAcaoIndustriaRedirect() {
  redirect('/dashboard/_compartilhado/plano-acao')
}
