#!/usr/bin/env tsx
// "Migration só de CATÁLOGO" (CEO 31/10 · Eng. Chefe, "FILA CRÍTICA ENTUPIDA"): decide se uma migration GRAVA SOMENTE
// texto de ajuda / metadado de tela — INSERT/UPSERT (ON CONFLICT) ou UPDATE numa tabela de catálogo da whitelist — e
// NADA MAIS. O eng_chefe pediu "só insere/ATUALIZA linhas de ajuda/metadado": o UPDATE de texto de ajuda
// (erp_ajuda_*) e de metadado de tela (system_screens.views_consumidas/rpcs_chamadas — origem do dado, RD-98 p3) é
// tão aditivo em risco quanto o INSERT (sem dado de cliente, sem fiscal/financeiro/RLS), então também não serializa.
//
// Serve SÓ para a SERIALIZAÇÃO do @pos na fila de merge. Uma PR de RD-95 ("?") / RD-98 p3 leva a etiqueta
// `revisao-eng-chefe` por causa da TELA (.tsx) — e a fila, por ter a etiqueta, a tratava como migration CRÍTICA
// (n_critica=1): 1 por rodada, esperando o @pos da crítica anterior (~13 min cada → ~5 h de fila com 22 PRs). Mas a
// migration dessas PRs só insere linhas de ajuda/metadado: é ADITIVA. Quando esta função devolve `catalogo:true`, a
// fila mantém a PR na VIA REVISADA (a TELA ainda exige MERGE AUTORIZADO do gilberto-revisor), porém batela a migration
// como ADITIVA (não serializa o @pos). O veredito da migration continua no deploy-migrations + auditor PDCA.
//
// VIÉS DE SEGURANÇA (igual à doutrina do exige-via-revisada): QUALQUER dúvida → `catalogo:false` (serializa como
// crítica). São dúvida: migration vazia/ilegível, SQL dinâmico (EXECUTE/DO), corpo de função ($$…$$), qualquer DDL
// (CREATE/ALTER/DROP/TRUNCATE), GRANT/REVOKE, policy, DELETE (inclusive numa tabela de catálogo — o eng_chefe excluiu
// DELETE), ou QUALQUER statement que não seja um INSERT ou um UPDATE numa tabela de catálogo da whitelist. Só o que é
// comprovadamente "texto/metadado de catálogo" escapa da serialização.
import { existsSync, readFileSync } from 'node:fs'

// Tabelas de CATÁLOGO = texto de ajuda e metadado de tela. SEM dado de cliente, SEM domínio financeiro/fiscal/RLS.
//  - erp_ajuda_campo / erp_ajuda_artigo / erp_ajuda_categoria: textos da Central de Ajuda (RD-95 "?", RD-98 p3).
//  - system_screens: metadado de tela (menu, auditada_ok, origem do dado) — não é dado de cliente.
// Deliberadamente FORA: erp_ajuda_cache/_llm_log/_uso (dado de runtime, não texto de catálogo) e tudo o mais.
export const TABELAS_CATALOGO = new Set<string>([
  'erp_ajuda_campo',
  'erp_ajuda_artigo',
  'erp_ajuda_categoria',
  'system_screens',
])

export interface Catalogo {
  catalogo: boolean
  motivo: string
}

const tiraComentarios = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
// Tira os literais de texto (aspas simples, com a aspa dobrada '' como escape) ANTES de separar por ';' — assim um ';'
// dentro de um texto de ajuda não corta o comando no meio.
const tiraLiterais = (s: string): string => s.replace(/'(?:[^']|'')*'/g, "''")
const norm = (s: string): string => s.trim().replace(/"/g, '').replace(/^public\./i, '').toLowerCase()

export function soCatalogo(sqlBruto: string): Catalogo {
  const texto = tiraComentarios(sqlBruto)
  if (!texto.trim()) return { catalogo: false, motivo: 'migration vazia ou ilegível' }
  // SQL dinâmico / bloco anônimo: não dá para garantir o que grava
  if (/\bEXECUTE\b/i.test(texto) || /\bDO\s+(?:\$|LANGUAGE)/i.test(texto)) return { catalogo: false, motivo: 'SQL dinâmico (EXECUTE/DO)' }
  // corpo de função / dollar-quote ($$…$$): é lógica, fora do escopo de "só texto de catálogo"
  if (/\$[a-z0-9_]*\$/i.test(texto)) return { catalogo: false, motivo: 'corpo de função / dollar-quote ($$)' }

  const stmts = tiraLiterais(texto)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  if (stmts.length === 0) return { catalogo: false, motivo: 'nenhum comando identificado' }

  for (const s of stmts) {
    // Só dois verbos escapam da serialização, e só numa tabela da whitelist: INSERT (semear texto/metadado) e
    // UPDATE ... SET (ATUALIZAR texto de ajuda / metadado de origem do dado). DELETE/TRUNCATE/DDL/GRANT/policy e
    // qualquer outro comando caem no ramo `!m` → crítica. O `SET` no UPDATE garante que é um UPDATE de verdade.
    const ins = s.match(/^INSERT\s+INTO\s+(?:public\.)?"?([a-z0-9_]+)"?/i)
    const upd = s.match(/^UPDATE\s+(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+SET\b/i)
    const m = ins ?? upd
    if (!m) {
      const amostra = s.slice(0, 28).replace(/\s+/g, ' ')
      return { catalogo: false, motivo: `comando não é INSERT/UPDATE de catálogo (${amostra}…)` }
    }
    const verbo = ins ? 'INSERT' : 'UPDATE'
    const tab = norm(m[1])
    if (!TABELAS_CATALOGO.has(tab)) return { catalogo: false, motivo: `${verbo} em tabela fora do catálogo (${tab})` }
    // ON CONFLICT ... DO UPDATE no PRÓPRIO catálogo é upsert de texto — permitido. DO NOTHING idem. Nada mais pode
    // aparecer no statement (CREATE/ALTER/DROP/GRANT/DELETE já foram barrados por não começar com INSERT/UPDATE, pois
    // cada um seria um statement separado após o split por ';').
  }
  return { catalogo: true, motivo: `só INSERT/UPDATE em catálogo de ajuda/metadado (${stmts.length} comando[s])` }
}

if (process.argv[1] && /\/migracao-catalogo\.ts$/.test(process.argv[1])) {
  const arg = process.argv[2]
  const sql = arg && existsSync(arg) ? readFileSync(arg, 'utf8') : (arg ?? '')
  process.stdout.write(JSON.stringify(soCatalogo(sql)))
}
