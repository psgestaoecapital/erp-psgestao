// Agente de TESTE reservado para a aceitação do despertador/lease/encerrar (CEO 11/10). Isola os specs do estado vivo
// de erp_agente_rotina (agentes reais congelados com aciona=false). Liga só durante o spec e remove no teardown, mesmo
// em falha. Nunca toca em agente real. Migration 20261011150000 libera o nome nos CHECKs.
import { dbSelect, dbPatch, dbInsert, dbDelete } from './api'

export const AGENTE_TESTE = 'teste-despertador'

export async function ligarAgenteTeste(): Promise<() => Promise<void>> {
  const ja = await dbSelect('erp_agente_rotina', `agente=eq.${AGENTE_TESTE}&select=agente`)
  if (ja.length) await dbPatch('erp_agente_rotina', `agente=eq.${AGENTE_TESTE}`, { aciona: true })
  else await dbInsert('erp_agente_rotina', { agente: AGENTE_TESTE, aciona: true, observacao: 'TESTE da aceitação — removido no teardown' })
  return async () => {
    // desliga primeiro (seguro mesmo se a remoção falhar); depois limpa o que referencia o agente (FK) e a rotina
    await dbPatch('erp_agente_rotina', `agente=eq.${AGENTE_TESTE}`, { aciona: false }).catch(() => {})
    await dbDelete('erp_agente_mensagem', `para=eq.${AGENTE_TESTE}`).catch(() => {})
    await dbDelete('erp_agente_sessao_lease', `agente=eq.${AGENTE_TESTE}`).catch(() => {})
    await dbDelete('erp_agente_rotina', `agente=eq.${AGENTE_TESTE}`).catch(() => {})
  }
}
