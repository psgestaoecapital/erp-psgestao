// HB0 (auditor F20 em /dashboard/projetos/takeoff): o take-off é um fluxo de 6 etapas e o usuário precisa ver em que
// etapa está e o que falta para gerar o orçamento. Regra única, sem rede — a tela e o gate usam a mesma conta.

export type AmbienteTakeoff = { confirmado: boolean; servico_id: string | null }

export type PlantaTakeoff = {
  status: string
  arquivo_tipo: string | null
  aps_status: string | null
}

export type EtapaTakeoff = { chave: string; rotulo: string; feita: boolean }

export type ContagemAmbientes = { total: number; confirmados: number; comServico: number; prontos: number }

// "Pronto" = confirmado E com serviço: só esses viram item no orçamento (fn_takeoff_gerar_orcamento).
export function contarAmbientes(ambientes: AmbienteTakeoff[]): ContagemAmbientes {
  let confirmados = 0, comServico = 0, prontos = 0
  for (const a of ambientes) {
    if (a.confirmado) confirmados++
    if (a.servico_id) comServico++
    if (a.confirmado && a.servico_id) prontos++
  }
  return { total: ambientes.length, confirmados, comServico, prontos }
}

// Planta analisada = a IA (PDF/PNG/JPG) já extraiu ambientes ou o CAD (DWG) foi radiografado.
// Ambiente digitado na mão também conta: o usuário já passou da análise.
export function plantaAnalisada(p: PlantaTakeoff | null, nAmbientes: number): boolean {
  if (!p) return false
  if (nAmbientes > 0) return true
  if (p.arquivo_tipo === 'dwg') return p.aps_status === 'radiografado'
  return p.status === 'processada' || p.status === 'confirmada'
}

export function etapasTakeoff(args: {
  planta: PlantaTakeoff | null
  ambientes: AmbienteTakeoff[]
  orcamentoEscolhido: boolean
  orcamentoGerado: boolean
}): EtapaTakeoff[] {
  const c = contarAmbientes(args.ambientes)
  // fn_takeoff_gerar_orcamento marca a planta como 'confirmada' ao gerar os itens: reabrir a planta mostra o fluxo concluído.
  const gerado = args.orcamentoGerado || args.planta?.status === 'confirmada'
  return [
    { chave: 'planta', rotulo: 'Enviar a planta', feita: !!args.planta },
    { chave: 'analise', rotulo: 'Analisar', feita: plantaAnalisada(args.planta, c.total) },
    { chave: 'revisar', rotulo: 'Revisar medidas', feita: c.total > 0 && c.confirmados === c.total },
    { chave: 'servico', rotulo: 'Vincular serviços', feita: c.total > 0 && c.comServico === c.total },
    { chave: 'destino', rotulo: 'Escolher orçamento', feita: args.orcamentoEscolhido || gerado },
    { chave: 'gerar', rotulo: 'Gerar orçamento', feita: gerado },
  ]
}

// Índice da primeira etapa não feita (a "etapa atual"); todas feitas → etapas.length.
export function etapaAtual(etapas: EtapaTakeoff[]): number {
  const i = etapas.findIndex((e) => !e.feita)
  return i === -1 ? etapas.length : i
}

// Situação da planta em linguagem do usuário (a lista de plantas enviadas).
export function situacaoPlanta(p: PlantaTakeoff, c: ContagemAmbientes): { rotulo: string; tom: 'ok' | 'atencao' | 'erro' | 'neutro' } {
  if (p.status === 'erro' || p.aps_status === 'erro') return { rotulo: 'Erro na análise', tom: 'erro' }
  if (p.status === 'processando' || p.aps_status === 'traduzindo') return { rotulo: 'Em análise', tom: 'atencao' }
  if (!plantaAnalisada(p, c.total)) return { rotulo: 'Aguardando análise', tom: 'neutro' }
  if (p.status === 'confirmada') return { rotulo: 'Orçamento gerado', tom: 'ok' }
  if (c.total > 0 && c.prontos === c.total) return { rotulo: 'Pronta para orçar', tom: 'ok' }
  if (c.total === 0) return { rotulo: 'Sem ambientes', tom: 'atencao' }
  return { rotulo: `${c.prontos} de ${c.total} prontos`, tom: 'atencao' }
}

// Progresso de UMA planta da lista (etapa X de 6), pela mesma regra das etapas da tela. "Escolher orçamento" conta como
// feita quando a planta já tem orçamento de destino. Sem rede.
export function progressoPlanta(
  p: PlantaTakeoff & { orcamento_id: string | null },
  ambientes: AmbienteTakeoff[],
): { atual: number; total: number; rotulo: string; concluido: boolean } {
  const etapas = etapasTakeoff({ planta: p, ambientes, orcamentoEscolhido: !!p.orcamento_id, orcamentoGerado: false })
  const atual = etapaAtual(etapas)
  const concluido = atual >= etapas.length
  return { atual: concluido ? etapas.length : atual + 1, total: etapas.length, rotulo: concluido ? 'Concluído' : etapas[atual].rotulo, concluido }
}
