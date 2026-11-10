// Cálculos da aba Cidades do painel v7 (SPEC §2.4). Funções puras sobre o motor v5 (fonte bi_comercial_venda_item_mv).
// Devolução por cidade = devoluções dos clientes da cidade (a devolução não traz cidade no cadastro do item).
// Prazo por cidade = prazo médio de cada nota, ponderado pelo valor dos itens da cidade.
import type { BaseV5, EstadoV5, GrupoProduto, ModeloV5 } from '../meu-painel/motor-v5'

export type CidadeV7 = {
  ci: number; nome: string; uf: string
  val: number; part: number; kg: number; kgP: number; valP: number; rpkg: number | null
  clientes: number; pctClientes: number; devolucao: number; prazo: number | null
}

export type CidadesV7 = {
  linhas: CidadeV7[]
  clientesPorCidade: Map<number, number[]>
  totalClientes: number
}

export function calcularCidadesV7(base: BaseV5, modelo: ModeloV5, estado: EstadoV5, pg: GrupoProduto[]): CidadesV7 {
  const porCid = new Map<number, { val: number; kg: number; kgP: number; valP: number; clis: Set<number>; prazoNum: number; prazoDen: number }>()
  const cidadeDoCliente = (ci: number) => base.cli[ci]?.[1] ?? -1
  modelo.its.forEach((x) => {
    const cid = cidadeDoCliente(x[3])
    let a = porCid.get(cid)
    if (!a) { a = { val: 0, kg: 0, kgP: 0, valP: 0, clis: new Set(), prazoNum: 0, prazoDen: 0 }; porCid.set(cid, a) }
    a.val += x[6]; a.kg += x[5]; a.clis.add(x[3])
    if (!estado.excl[x[4]]) { a.valP += x[6]; a.kgP += x[5] }
    const pz = base.notas[x[1]]?.[0]
    if (pz !== null && pz !== undefined) { a.prazoNum += pz * x[6]; a.prazoDen += x[6] }
  })
  const devPorCid = new Map<number, number>()
  modelo.devs.forEach((x) => {
    const cid = cidadeDoCliente(x[2] as number)
    devPorCid.set(cid, (devPorCid.get(cid) || 0) + (x[4] as number))
  })
  const totalVal = modelo.tot.val || 1
  const totalClientes = modelo.cliM.size
  const clientesPorCidade = new Map<number, number[]>()
  porCid.forEach((_, cid) => clientesPorCidade.set(cid, []))
  modelo.its.forEach((x) => {
    const cid = cidadeDoCliente(x[3])
    const lista = clientesPorCidade.get(cid); if (lista && !lista.includes(x[3])) lista.push(x[3])
  })
  const linhas: CidadeV7[] = [...porCid].map(([cid, a]) => {
    const nomeCompleto = base.cid[cid] ?? '—'
    const [nome, uf] = nomeCompleto.split('/')
    return {
      ci: cid, nome: nome || nomeCompleto, uf: uf || '',
      val: a.val, part: 100 * a.val / totalVal, kg: a.kg, kgP: a.kgP, valP: a.valP,
      rpkg: a.kgP ? a.valP / a.kgP : null,
      clientes: a.clis.size, pctClientes: totalClientes ? 100 * a.clis.size / totalClientes : 0,
      devolucao: devPorCid.get(cid) || 0,
      prazo: a.prazoDen ? a.prazoNum / a.prazoDen : null,
    }
  }).sort((a, b) => b.val - a.val)
  return { linhas, clientesPorCidade, totalClientes }
}
