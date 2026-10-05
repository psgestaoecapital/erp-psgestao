// Isola a aceitação do lease REAL de um agente (a sessão de produção do agente pode estar ativa durante o teste).
// Expira o lease durante o teste e devolve depois: mesma sessão, renovada agora se estava ativa (nunca restaura
// timestamp velho, que derrubaria a sessão real).
import { dbSelect, dbPatch } from './api'

type Lease = { sessao_ref: string; renovada_em: string }
const MIN = 60_000

export async function liberarLease(agente: string): Promise<() => Promise<void>> {
  const antes = (await dbSelect<Lease>('erp_agente_sessao_lease', `agente=eq.${agente}&select=sessao_ref,renovada_em`))[0]
  if (!antes) return async () => {}
  const estavaAtiva = Date.now() - new Date(antes.renovada_em).getTime() < 12 * MIN
  await dbPatch('erp_agente_sessao_lease', `agente=eq.${agente}`, { renovada_em: new Date(Date.now() - 60 * MIN).toISOString() })
  return async () => {
    const atual = (await dbSelect<Lease>('erp_agente_sessao_lease', `agente=eq.${agente}&select=sessao_ref`))[0]
    if (!atual) return
    await dbPatch('erp_agente_sessao_lease', `agente=eq.${agente}`, {
      sessao_ref: antes.sessao_ref,
      renovada_em: estavaAtiva ? new Date().toISOString() : antes.renovada_em,
    })
  }
}
