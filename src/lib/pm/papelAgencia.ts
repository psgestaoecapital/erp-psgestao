// P&M D0 · "Papel na agência": resumo antes/depois devolvido por fn_pm_papel_agencia_previa / _aplicar.
export type PapelPrevia = {
  ok: boolean
  erro?: string
  antes?: { papel_gestao?: string | null; acessos?: Record<string, string>; decidido?: { papel_slug?: string | null } | null }
  depois?: { papel_slug?: string; teto?: string; acessos_do_papel?: Record<string, string> }
  cria_linha_escopo?: boolean
  cria_no_raiz?: boolean
  efeito_nas_telas_hoje?: string
}

const ROTULO: Record<string, string> = {
  pm_comercial: 'Comercial (leads, propostas)', pm_producao: 'Produção (jobs, pauta)', pm_financeiro: 'Financeiro da agência',
  pm_inteligencia: 'Inteligência (painéis)', pm_midia: 'Mídia (PI, veículos)', pm_portal: 'Portal / aprovação do cliente',
  ge_financeiro: 'Gestão Empresarial (faturamento, comissões)',
}

/** Linhas legíveis do que o papel concede (antes/depois) — o papel de gestão atual nunca muda. */
export function resumirPrevia(p: PapelPrevia): string[] {
  if (!p.ok) return [p.erro ?? 'Não foi possível calcular a prévia.']
  const linhas: string[] = []
  linhas.push(`Papel de gestão (não muda): ${p.antes?.papel_gestao ?? '—'}`)
  linhas.push(`Papel na agência: ${p.antes?.decidido?.papel_slug ?? 'nenhum'} → ${p.depois?.papel_slug ?? '—'} (teto ${p.depois?.teto ?? '—'})`)
  for (const [sub, nivel] of Object.entries(p.depois?.acessos_do_papel ?? {}).sort()) linhas.push(`${ROTULO[sub] ?? sub}: ${nivel}`)
  if (p.cria_no_raiz) linhas.push('Cria o nó raiz da empresa (a agência ainda não tem estrutura).')
  if (p.efeito_nas_telas_hoje) linhas.push(`Efeito nas telas hoje: ${p.efeito_nas_telas_hoje}`)
  return linhas
}
