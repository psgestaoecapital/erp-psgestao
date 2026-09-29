// "Enviar link de acesso" (Admin › Acessos · CEO 29/09 · caso Renato/Tryo). Regra do que sai para cada pessoa:
// - convite pendente (a pessoa ainda não tem conta)  → reenvia o CONVITE (mesmo código, validade renovada);
// - tem conta e NUNCA entrou                         → e-mail de convite com link para CRIAR a senha;
// - tem conta e já entrou                            → e-mail de CRIAR SENHA NOVA.
// O link de senha é sempre de recuperação (gerado no servidor) e NUNCA volta para a tela — só vai no e-mail.
// Quem enviou e quando: audit_log_global (acao ACESSO_LINK_ENVIADO). Gate: scripts/check-acessos-enviar-link.ts.

export type AlvoEnvio = { tipo: 'convite_pendente' } | { tipo: 'pessoa'; jaEntrou: boolean }

export interface PlanoEnvio {
  template: 'convite' | 'reset_senha'   // templates de fn_email_render
  link: 'convite' | 'recuperacao'
  rotulo: string                        // o que a tela diz depois de enviar
}

export function planoDeEnvio(alvo: AlvoEnvio): PlanoEnvio {
  if (alvo.tipo === 'convite_pendente') return { template: 'convite', link: 'convite', rotulo: 'Convite reenviado' }
  if (!alvo.jaEntrou) return { template: 'convite', link: 'recuperacao', rotulo: 'Convite reenviado (link para criar a senha)' }
  return { template: 'reset_senha', link: 'recuperacao', rotulo: 'E-mail para criar senha nova enviado' }
}

export const ACAO_AUDIT_LINK = 'ACESSO_LINK_ENVIADO'
export const VALIDADE_CONVITE_DIAS = 14

export interface UltimoEnvio { em: string; por: string | null }

export function textoUltimoEnvio(e: UltimoEnvio | null | undefined): string | null {
  if (!e) return null
  const d = new Date(e.em)
  if (Number.isNaN(d.getTime())) return null
  const quando = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `Último envio: ${quando}${e.por ? ` por ${e.por}` : ''}`
}
