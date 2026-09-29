// #273 (Frioeste · SST) · Frases da Supervisão para o desvio de pausa. A apuração atual (termica_253_v2) grava o desvio
// como { tipo: 'pausa_insuficiente', quantidade: N } e as pausas do dia em detalhe.pausas; a tela lia o formato antigo
// ({ duracao_min, inicio, minimo }) e escrevia "pausa de undefined minutos às undefined". Aqui cada pausa curta vira uma
// frase com horário e minutos; as pausas acima do tempo previsto aparecem como gestão (não é infração).
export type PausaDia = { de?: string | null; ate?: string | null; min?: number | null; classe?: string | null }
export type DesvioSup = { tipo: string; quantidade?: number | null; duracao_min?: number | null; inicio?: string | null; minimo?: number | null; faltantes?: number | null }

export function frasesPausasCurtas(dv: DesvioSup, pausas: PausaDia[] | null | undefined, pausaMin: number): string[] {
  // formato antigo, com os dados da pausa no próprio desvio
  if (dv.duracao_min != null && dv.inicio) return [`pausa de ${dv.duracao_min} min às ${dv.inicio} — o mínimo é ${dv.minimo ?? pausaMin} min`]
  const curtas = (pausas || []).filter(p => p.classe === 'pausa_insuficiente')
  if (curtas.length) return curtas.map(p => `pausa das ${p.de ?? '—'} às ${p.ate ?? '—'}: ${p.min ?? '—'} min — o mínimo é ${pausaMin} min`)
  const n = dv.quantidade ?? 1
  return [n === 1 ? `uma pausa abaixo de ${pausaMin} min` : `${n} pausas abaixo de ${pausaMin} min`]
}

export function frasesExcesso(pausas: PausaDia[] | null | undefined): string[] {
  return (pausas || []).filter(p => p.classe === 'pausa_excesso')
    .map(p => `pausa das ${p.de ?? '—'} às ${p.ate ?? '—'}: ${p.min ?? '—'} min — acima do tempo previsto (gestão, não é infração)`)
}
