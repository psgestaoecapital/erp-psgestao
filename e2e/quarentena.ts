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
  {
    spec: 'e2e/jornadas/aceitacao/agency-origens-semente.spec.ts',
    area: 'agency-origens',
    motivo: 'asserção da linha 31 falha no banco de testes novo (DEMO da agência sem algum dado da semente); trava o teste da main e ~32 PRs. Conserto: Eng. Chefe msg 8787bb9d, ação 2',
    desde: '2026-10-11T09:00:00Z',
    runs: [0, 0], // run da aceitacao-main 01:09 e o seguinte (CEO destrava manual, 11/10)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-caixa-mensagens.spec.ts',
    area: 'agentes-caixa',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-despertador.spec.ts',
    area: 'agentes-despertador',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-encerrar-despertador5.spec.ts',
    area: 'agentes-despertador',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-lease.spec.ts',
    area: 'agentes-lease',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-atendimento-fila.spec.ts',
    area: 'atendimento-fila',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-clonar-produto.spec.ts',
    area: 'clonar-produto',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-clonar-servico.spec.ts',
    area: 'clonar-servico',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-conexoes-bancarias.spec.ts',
    area: 'caminho-conexoes',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-oficina-os-impressao.spec.ts',
    area: 'caminho-oficina',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/coletor-antigo-fora-do-ar.spec.ts',
    area: 'coletor-antigo',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/fila-rascunho-precisa-de-mim.spec.ts',
    area: 'fila-rascunho',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/gean-cnpj-duplicado-editar-130.spec.ts',
    area: 'gean-cnpj',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/hidratacao-empresa-sel.spec.ts',
    area: 'hidratacao-empresa',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/ibpt-empresa-token.spec.ts',
    area: 'ibpt-empresa',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-devolucao-compra-obs-94.spec.ts',
    area: 'kgf-devolucao',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-os-impressao-cnpj-foto-89-80.spec.ts',
    area: 'kgf-os',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/plano-contas-relatorio-arvore.spec.ts',
    area: 'plano-contas',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/plano-contas-relatorio-kpi.spec.ts',
    area: 'plano-contas',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/pm-selos-margem.spec.ts',
    area: 'pm-selos',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/produtividade-cadastro-editavel.spec.ts',
    area: 'produtividade-cadastro',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/revenda-foto-upload.spec.ts',
    area: 'revenda-foto',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/revenda-vistoria-rapida-foto-reparo.spec.ts',
    area: 'revenda-vistoria',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/sicredi-erro-claro-88.spec.ts',
    area: 'sicredi-erro',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/tryo-anexos-264-266.spec.ts',
    area: 'tryo-anexos',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts',
    area: 'xml-compra',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-quantidade-fracionada-102.spec.ts',
    area: 'kgf-quantidade',
    motivo: 'falha igual em todas as PRs (#2563, #2839, #2827): a DEMO Oficina das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T22:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    code: 'gilberto-esteira',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-oficina-diagnostico.spec.ts',
    area: 'caminho-oficina-diagnostico',
    motivo: 'falha de ambiente em 4 PRs diferentes (#2114, #2856, #2118, #2845) — DEMO das vagas ≠ produção; não crítico',
    desde: '2026-10-19T10:00:00Z',
    runs: [0, 0], // falha de ambiente nas vagas (não é regressão de PR), 19/10
    code: 'gilberto-esteira',
  },
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
