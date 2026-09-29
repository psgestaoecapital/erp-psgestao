// #256 (Frioeste · SST) · Conferência: o relatório do IO Point entrega a pausa em pares (início, fim). Quando o
// colaborador não bate a saída e bate só o retorno, o par desliza: o retorno vira "início" e todos os pares seguintes
// do dia ficam deslocados (ex.: 13:30–15:02, 15:32–18:42… quando as pausas reais são 15:02→15:32 e 18:42→19:05).
// A responsável diz o que cada horário é — Saída, Retorno ou Ignorar (entrada do turno, almoço) — e o sistema refaz os
// pares. Esta é a MESMA regra de fn_nr36_reler_dia (banco); aqui serve para a prévia na tela e para o gate de build.

export type PapelMarca = 'saida' | 'retorno' | 'ignorar'
export type Marca = { hora: string; papel: PapelMarca; origem: 'arquivo' | 'manual' }
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
