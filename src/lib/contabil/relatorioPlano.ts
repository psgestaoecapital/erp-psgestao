// Relatório Plano Gerencial × Contábil (CEO 29/09 · FC): o relatório impresso se lê pela árvore GERENCIAL — cada conta
// gerencial (1, 1.01, 2, 2.01…) e, logo abaixo, as contábeis vinculadas a ela. As contábeis ainda sem conta gerencial vão
// numa seção à parte, no FIM, em lista compacta (sem repetir a frase em cada linha nem coluna gerencial vazia).
// Monta a partir das linhas de fn_plano_contas_relatorio (que traz os dois lados misturados e as órfãs primeiro).

export interface LinhaRelatorioPlano {
  origem: 'gerencial' | 'contabil_sem_vinculo'
  ger_codigo: string | null
  ger_descricao: string | null
  ger_grupo: string | null
  ger_tipo: string | null
  ger_nivel: number | null
  ger_is_totalizador: boolean | null
  cont_codigo: string | null
  cont_descricao: string | null
  cont_nivel: number | null
  cont_analitica: boolean | null
  cont_codigo_antigo: string | null
  vinculo_observacao: string | null
}

export interface ContaContabilRel { codigo: string; descricao: string; antigo: string | null }
export interface NoGerencial {
  codigo: string
  descricao: string
  nivel: number
  totalizador: boolean
  contabeis: ContaContabilRel[]
}
export interface RelatorioPlano { arvore: NoGerencial[]; pendentes: ContaContabilRel[] }

// Ordem natural de código estruturado: 1 < 1.01 < 1.02 < 2 < 2.01 < 10 (texto puro poria 10 antes de 2).
export function compararCodigo(a: string, b: string): number {
  const pa = a.split('.'), pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = Number(pa[i]), nb = Number(pb[i])
    const d = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i].localeCompare(pb[i])
    if (d !== 0) return d
  }
  return 0
}

const contabil = (l: LinhaRelatorioPlano): ContaContabilRel => ({
  codigo: l.cont_codigo ?? '', descricao: l.cont_descricao ?? '', antigo: l.cont_codigo_antigo ?? null,
})

export function montarRelatorioPlano(linhas: LinhaRelatorioPlano[]): RelatorioPlano {
  const nos = new Map<string, NoGerencial>()
  const pendentes: ContaContabilRel[] = []
  for (const l of linhas) {
    if (l.origem === 'contabil_sem_vinculo') { if (l.cont_codigo) pendentes.push(contabil(l)); continue }
    if (!l.ger_codigo) continue
    let no = nos.get(l.ger_codigo)
    if (!no) {
      no = { codigo: l.ger_codigo, descricao: l.ger_descricao ?? '', nivel: l.ger_nivel ?? l.ger_codigo.split('.').length,
        totalizador: !!l.ger_is_totalizador, contabeis: [] }
      nos.set(l.ger_codigo, no)
    }
    if (l.cont_codigo) no.contabeis.push(contabil(l))
  }
  const arvore = [...nos.values()].sort((a, b) => compararCodigo(a.codigo, b.codigo))
  for (const no of arvore) no.contabeis.sort((a, b) => compararCodigo(a.codigo, b.codigo))
  pendentes.sort((a, b) => compararCodigo(a.codigo, b.codigo))
  return { arvore, pendentes }
}

// Filtro "Só vinculadas": mantém as gerenciais com contábil e os totalizadores que as agrupam (o caminho na árvore).
export function soVinculadas(arvore: NoGerencial[]): NoGerencial[] {
  const comVinculo = arvore.filter((n) => n.contabeis.length > 0).map((n) => n.codigo)
  return arvore.filter((n) => n.contabeis.length > 0 || comVinculo.some((c) => c.startsWith(n.codigo + '.')))
}
