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

// #273 · SINAL DE GESTÃO (decisão do CEO, 29/09): art. 253 da CLT — 20 min de repouso a cada 1h40 de trabalho em
// ambiente frio. Trecho contínuo sem pausa acima do limite, medido pelas batidas do ponto (pares entrada/saída) menos as
// pausas registradas. NÃO entra no veredito. Mesma regra de fn_nr36_supervisao_sinais (banco).
export type Trecho = { de: string; ate: string; min: number }
const minH = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
const hhmmDe = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function trechosSemPausa(pontos: string[], pausas: { de: string; ate: string }[], limiteMin = 100): Trecho[] {
  const p = [...pontos].sort((a, b) => minH(a) - minH(b))
  const ps = [...pausas].sort((a, b) => minH(a.de) - minH(b.de))
  const out: Trecho[] = []
  for (let i = 0; i + 1 < p.length; i += 2) {
    const ini = minH(p[i]), fim = minH(p[i + 1])
    let atual = ini
    for (const pa of ps) {
      const d = minH(pa.de), a = minH(pa.ate)
      if (a <= atual || d >= fim) continue
      if (d > atual && d - atual > limiteMin) out.push({ de: hhmmDe(atual), ate: hhmmDe(d), min: d - atual })
      atual = Math.max(atual, a)
    }
    if (fim - atual > limiteMin) out.push({ de: hhmmDe(atual), ate: hhmmDe(fim), min: fim - atual })
  }
  return out
}

export function fraseSinal(t: Trecho, limiteMin = 100): string {
  const h = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
  return `ficou ${h(t.min)} sem pausa, das ${t.de} às ${t.ate} — o limite é ${h(limiteMin)} (art. 253 da CLT)`
}
