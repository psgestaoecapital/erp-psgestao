// #587 (Frioeste · CEO 02/10) · Batida ajustada como CAMADA à parte da batida original (imutável — Portaria 671/2021).
// A mesma camada (fn__nr36_ajustes_dia no banco) alimenta a Auditoria, a Conferência (editor do dia) e a Ciência.
// Aqui ficam os rótulos e o texto de cada pausa no documento, usados pela tela e pela página pública de assinatura,
// e a leitura das pendências da prévia (o que impede gravar sem dizer, de propósito, que não se sabe o horário).
import type { PausaRelida } from './pausasMarcas'

export type OrigemAjuste = 'catraca' | 'conferido_colaborador'
export const ORIGENS_AJUSTE: Array<{ valor: OrigemAjuste; rotulo: string }> = [
  { valor: 'catraca', rotulo: 'Catraca' },
  { valor: 'conferido_colaborador', rotulo: 'Conferido com o colaborador' },
]
export const rotuloOrigemAjuste = (o?: string | null): string =>
  o === 'catraca' ? 'catraca' : o === 'conferido_colaborador' ? 'conferido com o colaborador' : (o || '')

export type AjusteBatida = { hora: string; papel: 'saida' | 'retorno'; origem: OrigemAjuste; origem_label?: string; justificativa?: string; por?: string | null; em?: string }
export type AjusteDia = { originais: string[]; ajustes: AjusteBatida[]; desconsideradas: string[]; relido: boolean; justificativas?: Array<{ justificativa: string; por: string | null; em: string; pendencia_ciente?: boolean }> }

const dataCurta = (iso?: string) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) } catch { return '' }
}

// "ajustada · catraca · por Fulana em 02/10"
export function rotuloAjuste(a: AjusteBatida): string {
  const partes = ['ajustada', rotuloOrigemAjuste(a.origem)]
  if (a.por || a.em) partes.push(`por ${a.por || 'a responsável'}${a.em ? ` em ${dataCurta(a.em)}` : ''}`)
  return partes.join(' · ')
}

export const ajusteDe = (aj: AjusteDia | null | undefined, hora: string | null | undefined, papel: 'saida' | 'retorno') =>
  hora && aj ? aj.ajustes.find(a => a.hora === hora && a.papel === papel) ?? null : null

// Pausa como sai no documento de Ciência (detalhe apurado + camada de ajuste do dia).
export type PausaDoc = { de?: string | null; ate?: string | null; min?: number | null; fim_origem?: string | null; sem_saida?: boolean | null }
export type LinhaDoc = { texto: string; tom: 'normal' | 'alerta' | 'estimado' | 'ponto' | 'confirmado'; sufixo: string; notas: string[] }

export function linhaPausaDoc(p: PausaDoc, aj?: AjusteDia | null): LinhaDoc {
  const notas: string[] = []
  // retorno sem saída: o horário gravado é o RETORNO (antes saía como "09:04 → sem registro de saída", invertido)
  if (p.sem_saida) {
    return { texto: `saída não registrada → ${p.de || '—'} (retorno)`, tom: 'alerta', sufixo: '', notas: ['batida original do relógio; a saída não foi batida'] }
  }
  const de = p.de || '—'
  const as = ajusteDe(aj, p.de, 'saida'); const ar = ajusteDe(aj, p.ate, 'retorno')
  if (as) notas.push(`saída ${p.de} ${rotuloAjuste(as)}`)
  if (ar) notas.push(`retorno ${p.ate} ${rotuloAjuste(ar)}`)
  if (aj && (as || ar)) {
    const originais = [p.de, p.ate].filter((h): h is string => !!h && aj.originais.includes(h))
    if (originais.length) notas.push(`original do relógio: ${originais.join(' e ')}`)
  }
  if (!p.ate) return { texto: `${de} → sem registro de retorno`, tom: 'alerta', sufixo: '', notas }
  switch (p.fim_origem) {
    case 'estimado': return { texto: `${de} → ~${p.ate}`, tom: 'estimado', sufixo: ' (estimado)', notas }
    case 'confirmado_ponto': return { texto: `${de} → ${p.ate}`, tom: 'ponto', sufixo: ' (confirmado pelo ponto)', notas }
    case 'confirmado_manual': return { texto: `${de} → ${p.ate}`, tom: 'confirmado', sufixo: ar ? '' : ' (confirmado)', notas }
    default: return { texto: `${de} → ${p.ate}`, tom: 'normal', sufixo: '', notas }
  }
}

// Linha do dia no documento: as batidas originais do relógio e o que foi desconsiderado na releitura.
export function notaDiaDoc(aj?: AjusteDia | null): string | null {
  if (!aj || (!aj.ajustes.length && !aj.desconsideradas.length)) return null
  const partes = [`Batidas originais do relógio: ${aj.originais.join(', ') || '—'}`]
  if (aj.desconsideradas.length) partes.push(`desconsideradas na conferência: ${aj.desconsideradas.join(', ')}`)
  return partes.join(' · ')
}

// O que a prévia deixaria pendente (mesma regra do banco em fn_nr36_reler_dia_justificado).
export type Pendencia = { tipo: 'sem_saida' | 'sem_retorno'; hora: string }
export function pendenciasDaPrevia(pausas: PausaRelida[]): Pendencia[] {
  return pausas.flatMap((p): Pendencia[] =>
    p.situacao === 'sem_saida' && p.fim ? [{ tipo: 'sem_saida', hora: p.fim }]
      : p.situacao === 'sem_retorno' && p.inicio ? [{ tipo: 'sem_retorno', hora: p.inicio }] : [])
}
export const textoPendencia = (p: Pendencia) =>
  p.tipo === 'sem_saida' ? `falta a saída do retorno das ${p.hora}` : `falta o retorno da saída das ${p.hora}`
