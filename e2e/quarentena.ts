// Quarentena de specs de aceitação @pos-migration da main (CEO 10/10).
//
// Problema: um spec da main que falha de forma instável ou por motivo SEM RELAÇÃO com a PR daquele head segura a fila
// (nenhuma PR com migration publica enquanto o @pos da main está vermelho). A quarentena tira esse spec da EXECUÇÃO
// — datado, com motivo e com tarefa ao Code dono — para a fila voltar, sem mascarar regressão de verdade.
//
// Travas (as duas valem SEMPRE, decididas pelo CEO):
//  1) "SEM RELAÇÃO com a PR": só entra em quarentena se, no run em que COMEÇOU a falhar (o 1º vermelho da sequência),
//     a PR daquele head NÃO tocou a ÁREA do spec (área derivada do nome do arquivo × arquivos da PR). Tocou → é
//     regressão da PR: NÃO quarentena, segura a fila (corrige/reverte a culpada).
//  2) "CRÍTICOS nunca entram": áreas de risco alto SEMPRE seguram a fila, mesmo sem relação com a PR — um @pos
//     vermelho nelas é trabalho AGORA, nunca se esconde.
//
// O detector (scripts/merge/quarentena-detectar.ts) decide e inclui/remove por commit no ramo da main; o Playwright
// lê `specsEmQuarentena()` em `testIgnore` para não rodar o spec (o ARQUIVO continua no repo — nunca se apaga).
// Sai da quarentena sozinho quando o spec volta a passar. Gate: scripts/gates/check-quarentena.ts.

// Áreas que NUNCA entram em quarentena (substring, minúsculas) — financeiro, fiscal, permissões/RLS/guarda, NR-36,
// LGPD, Wealth/CVM. Um spec cujo caminho/nome casa com qualquer uma destas sempre segura a fila.
export const QUARENTENA_CRITICOS = [
  'financeiro', 'fiscal', 'nfse', 'nfe', 'nf-e', 'imposto', 'tribut',
  'permiss', 'rls', 'guarda', 'rbac', 'acesso',
  'nr-36', 'nr36', 'lgpd', 'wealth', 'cvm',
] as const

export type SpecQuarentenado = {
  spec: string              // caminho a partir da raiz: e2e/jornadas/aceitacao/<arquivo>.spec.ts
  area: string              // área derivada do nome do spec (para a tarefa e a auditoria)
  motivo: string            // por que entrou (resumo do erro) — linguagem de quem vai consertar
  desde: string             // ISO 8601 de quando entrou
  runs: [number, number]    // os 2 runs @pos consecutivos da main que falharam
  code: string              // Code dono da área (recebe a tarefa de consertar)
}

// Lista VIVA — vazia por padrão. O detector inclui entradas entre os marcadores abaixo (edição segura por texto);
// a remoção é feita pela PR do Code dono que conserta o spec. Nunca apaga o arquivo do spec, só o tira da execução.
export const QUARENTENA: SpecQuarentenado[] = [
  /* quarentena:inicio */
  /* quarentena:fim */
]

export function specsEmQuarentena(): string[] {
  return QUARENTENA.map((q) => q.spec)
}

// Área do spec: tokens do nome do arquivo (sem .spec.ts), em minúsculas, só os com 3+ letras. Ex.:
// "mao-obra-componentes" → ['mao','obra','componentes']; "cliente-cnpj-duplicado-guarda" → ['cliente','cnpj',...].
export function tokensDoSpec(spec: string): string[] {
  const base = (spec.split('/').pop() ?? spec).replace(/\.spec\.ts$/, '').toLowerCase()
  return base.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
}

// Área "curta" para exibir (os 1–2 primeiros tokens).
export function areaDoSpec(spec: string): string {
  return tokensDoSpec(spec).slice(0, 2).join('-') || 'desconhecida'
}

// Crítico? (substring do caminho/nome contra a lista) — crítico SEMPRE segura a fila, nunca entra em quarentena.
export function ehCritico(spec: string): boolean {
  const s = spec.toLowerCase()
  return QUARENTENA_CRITICOS.some((c) => s.includes(c))
}

// Relação PR × área: a PR do 1º vermelho tocou a área do spec? Comparação GENEROSA (viés de segurança: na dúvida,
// "tocou" → NÃO quarentena → segura a fila). Casa se algum arquivo da PR contém algum token da área do spec.
export function prTocaAreaDoSpec(arquivosDaPr: string[], spec: string): boolean {
  const toks = tokensDoSpec(spec)
  const arq = arquivosDaPr.map((f) => f.toLowerCase())
  return arq.some((f) => toks.some((t) => f.includes(t)))
}

// Decisão final: pode pôr este spec em quarentena? (precisa: não-crítico E a PR do 1º vermelho não tocou a área).
export function podeQuarentenar(spec: string, arquivosDaPrPrimeiroVermelho: string[]): { ok: boolean; motivo: string } {
  if (ehCritico(spec)) return { ok: false, motivo: 'área crítica (financeiro/fiscal/permissões-RLS-guarda/NR-36/LGPD/Wealth) — sempre segura a fila' }
  if (prTocaAreaDoSpec(arquivosDaPrPrimeiroVermelho, spec)) return { ok: false, motivo: 'a PR do 1º vermelho tocou a área do spec — é regressão da PR, não quarentena' }
  return { ok: true, motivo: 'sem relação com a PR do 1º vermelho e não-crítico' }
}
