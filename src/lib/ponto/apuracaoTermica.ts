// Espelho da regra de fn_nr36_apurar para a térmica_253 (migration 20261005000000 · #587). Serve de fixture executável
// no gate: a regra do banco e esta função precisam dizer o mesmo. Sem CPF: só minutos.
export type DiaTermica = {
  jornadaMin: number            // 1ª → última batida
  almocoMin: number             // saída→volta das batidas (2ª→3ª, 4ª→5ª…)
  pausasMin: number[]           // pausas fechadas, em minutos
}
export type ParamTermica = { gatilho_min?: number; pausa_min?: number; limite_inferior_min?: number; almoco_interrompe_exposicao?: boolean }
export type VeredictoTermica = { status: 'conforme' | 'desvio' | 'pendente_confirmacao'; motivo: string | null; devido: number; realizado: number }

export function apurarDiaTermica(d: DiaTermica, p: ParamTermica): VeredictoTermica {
  const gatilho = p.gatilho_min ?? 100
  const limInf = p.limite_inferior_min ?? p.pausa_min ?? 20
  const almoco = p.almoco_interrompe_exposicao === true   // sem o parâmetro: resultado de antes
  const exposicao = Math.max(d.jornadaMin - (almoco ? d.almocoMin : 0) - d.pausasMin.reduce((a, b) => a + b, 0), 0)
  const devido = Math.floor(exposicao / Math.max(gatilho, 1))
  const realizado = d.pausasMin.length
  const insuf = d.pausasMin.filter(m => m < limInf).length
  if (insuf > 0) return { status: 'desvio', motivo: null, devido, realizado }
  if (realizado === 0 && devido > 0) return { status: 'pendente_confirmacao', motivo: 'sem_registro_pausa', devido, realizado }
  if (almoco && realizado < devido) return { status: 'pendente_confirmacao', motivo: 'pausas_faltantes', devido, realizado }
  return { status: 'conforme', motivo: null, devido, realizado }
}
