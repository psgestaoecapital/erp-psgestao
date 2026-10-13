// #256 (Frioeste · SST) · Conferência: o relatório do IO Point entrega a pausa em pares (início, fim). Quando o
// colaborador não bate a saída e bate só o retorno, o par desliza: o retorno vira "início" e todos os pares seguintes
// do dia ficam deslocados (ex.: 13:30–15:02, 15:32–18:42… quando as pausas reais são 15:02→15:32 e 18:42→19:05).
// A responsável diz o que cada horário é — Saída, Retorno ou Ignorar (entrada do turno, almoço) — e o sistema refaz os
// pares. Esta é a MESMA regra de fn_nr36_reler_dia (banco); aqui serve para a prévia na tela e para o gate de build.

export type PapelMarca = 'saida' | 'retorno' | 'ignorar'
// origem 'arquivo' = batida original do relatório (imutável); 'manual' = horário digitado, que diz de onde veio (#587)
export type Marca = { hora: string; papel: PapelMarca; origem: 'arquivo' | 'manual'; origem_ajuste?: 'catraca' | 'conferido_colaborador' }
export type SituacaoPausa = 'fechada' | 'sem_retorno' | 'sem_saida'
export type PausaRelida = { inicio: string | null; fim: string | null; minutos: number | null; situacao: SituacaoPausa }
// sem_saida: a linha guarda um RETORNO cuja saída não foi batida (o horário está em inicio_local, sem fim)
export type LinhaPausaDia = { inicio_local: string | null; fim_local: string | null; inicio_manual?: boolean; fim_manual?: boolean; sem_saida?: boolean }

export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizarHora(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = `${m[1].padStart(2, '0')}:${m[2]}`
  return HORA_RE.test(h) ? h : null
}

const minDoDia = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

// Marcações do dia como estão gravadas: início de cada linha = Saída, fim = Retorno (linha sem_saida = só o Retorno).
export function marcasDasPausas(linhas: LinhaPausaDia[]): Marca[] {
  const out: Marca[] = []
  for (const l of linhas) {
    if (l.sem_saida) { if (l.inicio_local) out.push({ hora: l.inicio_local, papel: 'retorno', origem: 'arquivo' }); continue }
    if (l.inicio_local) out.push({ hora: l.inicio_local, papel: 'saida', origem: l.inicio_manual ? 'manual' : 'arquivo' })
    if (l.fim_local) out.push({ hora: l.fim_local, papel: 'retorno', origem: l.fim_manual ? 'manual' : 'arquivo' })
  }
  return ordenarMarcas(out)
}

export function ordenarMarcas(m: Marca[]): Marca[] {
  return [...m].sort((a, b) => minDoDia(a.hora) - minDoDia(b.hora))
}

// Pareia em ordem de horário: Saída abre a pausa, o próximo Retorno fecha. Saída seguida de outra Saída = pausa sem
// retorno (fica para conferir o fim). Retorno sem Saída antes = pausa sem hora de saída (não inventa o início — RD-38).
export function parearMarcas(marcas: Marca[]): PausaRelida[] {
  const out: PausaRelida[] = []
  let aberta: string | null = null
  for (const m of ordenarMarcas(marcas)) {
    if (m.papel === 'ignorar') continue
    if (m.papel === 'saida') {
      if (aberta) out.push({ inicio: aberta, fim: null, minutos: null, situacao: 'sem_retorno' })
      aberta = m.hora
    } else if (aberta) {
      out.push({ inicio: aberta, fim: m.hora, minutos: minDoDia(m.hora) - minDoDia(aberta), situacao: 'fechada' })
      aberta = null
    } else {
      out.push({ inicio: null, fim: m.hora, minutos: null, situacao: 'sem_saida' })
    }
  }
  if (aberta) out.push({ inicio: aberta, fim: null, minutos: null, situacao: 'sem_retorno' })
  return out
}

// Validação antes de gravar (a mesma do banco): horário válido, sem horário repetido, ao menos uma marcação usada.
export function validarMarcas(marcas: Marca[]): string | null {
  if (marcas.some(m => !HORA_RE.test(m.hora))) return 'Horário inválido — use HH:MM.'
  const horas = marcas.map(m => m.hora)
  if (new Set(horas).size !== horas.length) return 'Há horário repetido. Cada marcação aparece uma vez só.'
  if (!marcas.some(m => m.papel !== 'ignorar')) return 'Marque ao menos um horário como Saída ou Retorno.'
  return null
}

// #587 (Frioeste · CEO 01/10) · Auditoria de batidas: SUGERE o que cada horário do dia é quando os pares do relatório
// deslizaram (falta uma batida e o coletor encaixa a próxima no lugar). Regra combinada: o sistema sugere, a responsável
// confirma com justificativa, nada grava sozinho. A sugestão escolhe a leitura com mais pausas "plausíveis" (entre
// PAUSA_MIN e PAUSA_MAX minutos) e, no empate, a mais perto de 20 min. Par longo que JÁ era par no relatório e não
// disputa horário com outra pausa (ex.: almoço) fica como está. Horário que sobra sem par = "batida faltando": fica
// como Saída sem retorno — a pausa continua pendente, nada é inventado (RD-38).
export const PAUSA_MIN = 5
export const PAUSA_MAX = 45
export type SugestaoDia = { marcas: Marca[]; faltando: string[]; pausas: PausaRelida[]; mudou: boolean }

const plausivel = (p: PausaRelida) => p.situacao === 'fechada' && (p.minutos ?? 0) >= PAUSA_MIN && (p.minutos ?? 0) <= PAUSA_MAX

export function sugerirPapeis(marcasDia: Marca[]): SugestaoDia {
  const ms = ordenarMarcas(marcasDia).filter((m, i, arr) => i === 0 || arr[i - 1].hora !== m.hora)
  const n = ms.length
  // dp[i] = melhor leitura de ms[i..]: [horários sem par, desvio total de 20 min]
  const dp: Array<[number, number]> = Array.from({ length: n + 2 }, () => [0, 0])
  const escolha: Array<'par' | 'orfa'> = new Array(n).fill('orfa')
  const melhor = (a: [number, number], b: [number, number]) => (a[0] !== b[0] ? a[0] < b[0] : a[1] <= b[1])
  for (let i = n - 1; i >= 0; i--) {
    let best: [number, number] = [dp[i + 1][0] + 1, dp[i + 1][1]]
    let esc: 'par' | 'orfa' = 'orfa'
    if (i + 1 < n) {
      const d = minDoDia(ms[i + 1].hora) - minDoDia(ms[i].hora)
      if (d >= PAUSA_MIN && d <= PAUSA_MAX) {
        const cand: [number, number] = [dp[i + 2][0], dp[i + 2][1] + Math.abs(d - 20)]
        if (melhor(cand, best)) { best = cand; esc = 'par' }
      }
    }
    dp[i] = best; escolha[i] = esc
  }
  const out: Marca[] = []; const faltando: string[] = []
  for (let i = 0; i < n;) {
    const parOriginal = i + 1 < n && ms[i].papel === 'saida' && ms[i + 1].papel === 'retorno'
    if (escolha[i] === 'par') {
      out.push({ ...ms[i], papel: 'saida' }, { ...ms[i + 1], papel: 'retorno' }); i += 2
    } else if (parOriginal && escolha[i + 1] === 'orfa') {
      // par longo do relatório sem disputa (ex.: almoço): mantém como estava
      out.push({ ...ms[i] }, { ...ms[i + 1] }); i += 2
    } else {
      out.push({ ...ms[i], papel: 'saida' }); faltando.push(ms[i].hora); i += 1
    }
  }
  const mudou = out.some((m) => ms.find((x) => x.hora === m.hora)?.papel !== m.papel)
  return { marcas: out, faltando, pausas: parearMarcas(out), mudou }
}

// Dia com par provavelmente deslizado: a sugestão fecha MAIS pausas plausíveis do que a leitura atual.
export function diaSuspeito(linhas: LinhaPausaDia[]): boolean {
  const marcas = marcasDasPausas(linhas)
  const atual = parearMarcas(marcas).filter(plausivel).length
  const sug = sugerirPapeis(marcas)
  return sug.mudou && sug.pausas.filter(plausivel).length > atual
}
