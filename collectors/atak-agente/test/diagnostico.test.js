// Diagnóstico 2.1.5 (CEO 02/10): o agente só LÊ o ATAK para contar linhas e chaves distintas por domínio.
// Rodar: cd collectors/atak-agente && node --test test/diagnostico.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.PS_AGENTE_TESTE = '1'
process.env.PS_AGENTE_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-diag-'))
const ag = require('../agent.js')

test('chave natural: conta total, chave atual e cada candidata numa consulta só', () => {
  const q = ag.montarSqlDiagnostico({
    dominio: 'contabil_dre', tabela_origem: 'dbo.vwmovtofinresultad', chave_fato_sql: 'CONVERT(varchar,Num_lancto)',
    coluna_watermark: 'Data_movto', chaves_teste: ["CONCAT(Cod_filial,'|',Chave_fato,'|',Num_lancto)", ''],
  }, 7)
  assert.match(q.principal, /^SELECT COUNT_BIG\(\*\) AS total, COUNT_BIG\(DISTINCT \(CONVERT\(varchar,Num_lancto\)\)\) AS chave_atual, COUNT_BIG\(DISTINCT \(CONCAT/)
  assert.match(q.principal, /FROM dbo\.vwmovtofinresultad$/)
  assert.strictEqual(q.cands.length, 1, 'candidata vazia é ignorada')
  assert.match(q.janela, /WHERE \[Data_movto\] >= DATEADD\(day, -7,/)
  assert.strictEqual(q.distintasLinha, null)
})

test('HASH_ROW: conta linhas distintas (SELECT DISTINCT *)', () => {
  const q = ag.montarSqlDiagnostico({ dominio: 'camara_fria', tabela_origem: 'dbo.vwWMS_CamaraFriaPosicaoArmazenada', chave_fato_sql: 'HASH_ROW' }, 7)
  assert.strictEqual(q.principal, 'SELECT COUNT_BIG(*) AS total FROM dbo.vwWMS_CamaraFriaPosicaoArmazenada')
  assert.match(q.distintasLinha, /SELECT DISTINCT \* FROM dbo\.vwWMS_CamaraFriaPosicaoArmazenada/)
  assert.strictEqual(q.janela, null, 'sem watermark não há contagem de janela')
})

test('diagnóstico nunca escreve no ATAK (só SELECT)', () => {
  const q = ag.montarSqlDiagnostico({ dominio: 'x', tabela_origem: 'dbo.v', chave_fato_sql: 'a', coluna_watermark: 'd', chaves_teste: ['b'] }, 7)
  for (const s of [q.principal, q.janela]) {
    assert.match(s, /^SELECT /)
    assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|EXEC)\b/i)
  }
})

test('versão 2.1.5', () => { assert.strictEqual(ag.VERSAO_AGENTE, '2.1.5') })
