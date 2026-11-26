#!/usr/bin/env tsx
// Item A (CEO 25/11, "FILA CRÍTICA ENTUPIDA 2"): "precisa de revisão" ≠ "migration crítica". A etiqueta
// `revisao-eng-chefe` é posta por exige-via-revisada quando a PR toca TELA / cálculo / área crítica — ou seja,
// "precisa de olho humano". Mas a SERIALIZAÇÃO do @pos na fila só precisa acontecer quando a MIGRATION em si é
// crítica. Este classificador decide isso pelo CONTEÚDO da migration, reusando a MESMA regra pura e testada que
// decide a etiqueta — `migracaoCritica()` de exige-via-revisada.ts — para não haver duas verdades.
//
// ADITIVA (não serializa): CREATE de objeto novo, CREATE OR REPLACE de FUNÇÃO sem tocar tabela crítica, GRANT/REVOKE,
//   índice novo, FK para tabela crítica, INSERT em catálogo. → migracaoCritica devolve null.
// CRÍTICA (serializa o @pos): DML/ALTER/DROP em objeto que JÁ EXISTE, RLS/policy em tabela existente, CREATE OR
//   REPLACE VIEW, ou qualquer mutação de dado em tabela crítica (até dentro de corpo de função). → string de motivo.
//
// VIÉS DE SEGURANÇA (igual a exige-via-revisada / migracao-catalogo): migration vazia/ilegível → CRÍTICA. A fila ainda
// embrulha isto: só rebaixa para aditiva quando a PR tem MERGE AUTORIZADO válido E a saída diz `critica:false` EXPLÍCITO.
import { existsSync, readFileSync } from 'node:fs'
import { migracaoCritica } from './exige-via-revisada'

export interface Criticidade { critica: boolean; motivo: string }

// REDE DE SEGURANÇA do dinheiro (RD-103): migracaoCritica só trata mutação em TABELA_CRITICA dentro de corpo de função
// pela sua própria lista, que NÃO inclui as tabelas de MOVIMENTO (erp_receber/erp_pagar/lançamento/movimentação/folha).
// Um RPC (CREATE OR REPLACE FUNCTION) cujo CORPO ($$…$$) move dinheiro nessas tabelas sairia como "aditivo" e batelaria
// sem a cautela do @pos. Para a SERIALIZAÇÃO (não para a etiqueta), isso é crítico: serializa. Mutação de TOPO nessas
// tabelas já é crítica pelo migracaoCritica (ALTER/UPDATE/DELETE em objeto existente); esta rede cobre o corpo de função.
const FINANCEIRO_NUCLEO = /(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?(?:public\.)?"?(erp_receber|erp_pagar|erp_lancamentos|erp_movimentacoes|folha_competencia|folha_verba|folha_pagamento)\b/
// Bloco anônimo `DO $$ … $$` (ou `DO LANGUAGE …`): roda SQL dinâmico em TEMPO DE MIGRATION (p.ex. EXECUTE 'ALTER …').
// O migracaoCritica remove os corpos $$…$$ do check de DDL, então um ALTER/DROP escondido num DO sairia como "aditivo".
// Não dá para garantir estaticamente que um DO é aditivo → serializa (viés de segurança, igual ao migracao-catalogo).
// Distinção: o `$$` de um CREATE FUNCTION vem após `AS`/`RETURN`, não após `DO` — este regex casa só o DO de topo.
const DO_DINAMICO = /\bdo\s+(?:\$[a-z0-9_]*\$|language\b)/i

export function migracaoCriticidade(sql: string, nome = 'migration'): Criticidade {
  if (typeof sql !== 'string' || !sql.trim()) return { critica: true, motivo: 'migration vazia ou ilegível — na dúvida, crítica' }
  // `INSERT … ON CONFLICT … DO UPDATE SET …` (upsert idempotente, padrão de seed/catálogo) faz o regex de UPDATE do
  // migracaoCritica casar um "update set" e tratar como UPDATE em dado existente numa tabela fantasma 'set' — o que
  // prenderia todo seed com ON CONFLICT DO UPDATE na faixa crítica. Neutraliza só o token do UPSERT (um `DO UPDATE SET`
  // nunca é um UPDATE real — este é sempre `UPDATE tabela SET`): o upsert passa a ser julgado pelo ALVO do INSERT (uma
  // tabela crítica continua crítica pela linha do INSERT). Vale só p/ a SERIALIZAÇÃO; a etiqueta não muda.
  const sqlN = sql.replace(/\bdo\s+update\s+set\b/gi, 'do_upsert_set')
  const m = migracaoCritica(nome, sqlN)
  if (m) return { critica: true, motivo: m }
  // migracaoCritica disse aditiva: aplica as redes de segurança da SERIALIZAÇÃO (corpo de função incluso).
  const limpo = sql.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/'[^']*'/g, "''")
  if (DO_DINAMICO.test(limpo)) return { critica: true, motivo: `migration com bloco DO/anônimo (DDL dinâmico em tempo de migration · ${nome}) — serializa por segurança` }
  const f = limpo.match(FINANCEIRO_NUCLEO)
  if (f) return { critica: true, motivo: `migration/RPC mexe em dado financeiro de movimento (${f[1]} · ${nome}) — serializa por segurança (RD-103)` }
  return { critica: false, motivo: 'migration aditiva (cria objeto novo / RPC em tabela não-crítica / GRANT / índice / catálogo)' }
}

if (process.argv[1] && /\/migracao-criticidade\.ts$/.test(process.argv[1])) {
  const arg = process.argv[2]
  const sql = arg && existsSync(arg) ? readFileSync(arg, 'utf8') : (arg ?? '')
  process.stdout.write(JSON.stringify(migracaoCriticidade(sql)))
}
