// Bancos com extrato por API FUNCIONANDO (#88 · CEO 29/09). Os adapters de Sicredi e Bradesco em
// src/lib/banco/extrato/ ainda lançam "extrato_nao_habilitado" (fase 2) — oferecer "Sincronizar extrato"
// para eles só gera erro. Sem conector, o extrato entra por OFX (Conciliação › Inbox › Importar OFX).
// Módulo puro (sem imports de servidor) para poder ser usado nas telas. Gate: scripts/check-sicredi-erro-claro.ts.

// Banco do Brasil (#1736): API Extratos v1 (src/lib/banco/extrato/bb.ts).
export const EXTRATO_COM_CONECTOR: readonly string[] = ['sicoob', 'bb']

export function temConectorExtrato(provider: string | null | undefined): boolean {
  return !!provider && EXTRATO_COM_CONECTOR.includes(provider)
}

export const MSG_EXTRATO_SEM_CONECTOR =
  'Extrato por API ainda não disponível para este banco. Importe o arquivo OFX em Conciliação › Inbox.'
