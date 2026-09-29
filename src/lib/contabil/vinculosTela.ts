// Tela de vínculos gerencial × contábil (CEO 29/09 · FC): cada conta contábil analítica recebe UMA conta gerencial.
// O vínculo nasce PROPOSTO (editável, descartável) e vira CONFIRMADO (imutável — regra da contabilidade 15/09, ctx
// bda75838). Filtro padrão = pendências (sem vínculo + propostos). A regra é a mesma do banco
// (migration 20260929060000: fn_conta_contabil_vinculo_*), aqui para a tela e o gate de build.

export type StatusVinculo = 'sem_vinculo' | 'proposto' | 'confirmado'
export type FiltroVinculo = 'pendencias' | 'sem_vinculo' | 'proposto' | 'confirmado' | 'todas'

export interface LinhaVinculoTela {
  conta_contabil_id: string
  cont_codigo: string
  cont_descricao: string
  cont_codigo_antigo: string | null
  vinculo_id: string | null
  status: 'proposto' | 'confirmado' | null
  plano_conta_id: string | null
  ger_codigo: string | null
  ger_descricao: string | null
  confirmado_em: string | null
  origem: string | null
}

export const FILTRO_PADRAO: FiltroVinculo = 'pendencias'

export const statusDaLinha = (l: LinhaVinculoTela): StatusVinculo => (l.vinculo_id ? (l.status ?? 'confirmado') : 'sem_vinculo')

// Confirmado não se edita, não se descarta e não entra em ação em massa.
export const editavel = (l: LinhaVinculoTela) => statusDaLinha(l) !== 'confirmado'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarVinculos(linhas: LinhaVinculoTela[], filtro: FiltroVinculo, busca = ''): LinhaVinculoTela[] {
  const b = norm(busca.trim())
  return linhas.filter((l) => {
    const st = statusDaLinha(l)
    const passa = filtro === 'todas' ? true
      : filtro === 'pendencias' ? st !== 'confirmado'
      : st === filtro
    if (!passa) return false
    if (!b) return true
    return [l.cont_codigo, l.cont_descricao, l.cont_codigo_antigo ?? '', l.ger_codigo ?? '', l.ger_descricao ?? '']
      .some((t) => norm(t).includes(b))
  })
}

export function contarVinculos(linhas: LinhaVinculoTela[]) {
  const c = { total: linhas.length, sem_vinculo: 0, proposto: 0, confirmado: 0 }
  for (const l of linhas) c[statusDaLinha(l)]++
  return { ...c, pendencias: c.sem_vinculo + c.proposto }
}

// Ações em massa sobre a seleção: confirmar só propostos; propor/trocar só o que não está confirmado.
export function alvosDaSelecao(linhas: LinhaVinculoTela[], selecionadas: Set<string>) {
  const sel = linhas.filter((l) => selecionadas.has(l.conta_contabil_id))
  return {
    confirmarVinculoIds: sel.filter((l) => statusDaLinha(l) === 'proposto').map((l) => l.vinculo_id as string),
    proporContabilIds: sel.filter(editavel).map((l) => l.conta_contabil_id),
    descartarVinculoIds: sel.filter((l) => statusDaLinha(l) === 'proposto').map((l) => l.vinculo_id as string),
  }
}

export const MSG_IMUTAVEL = 'O vínculo contábil confirmado não pode ser alterado. Se a classificação mudou, crie uma nova conta gerencial e inative a anterior — assim os relatórios dos períodos anteriores continuam corretos.'
