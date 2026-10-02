// Gate · PM-J — importador de jobs do SIGA (CEO 02/10). Sem rede.
// Regra do CEO: últimos 60 dias + em aberto; "em aprovação" antigo fica de fora; nada gravado sem prévia; não duplica.
import { readFileSync } from 'node:fs'
import { adivinharMapa, dataSiga, numeroSiga, selecionar, situacaoSiga } from '../../src/lib/pm/importSiga'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const cab = ['Nº Job', 'Título do Job', 'Cliente', 'Responsável', 'Status', 'Prazo', 'Data de Criação', 'Tipo de Peça', 'Descrição']
const mapa = adivinharMapa(cab)
ok(mapa.numero === 0 && mapa.titulo === 1 && mapa.cliente === 2 && mapa.responsavel === 3 && mapa.situacao === 4 && mapa.prazo === 5 && mapa.criacao === 6 && mapa.peca === 7 && mapa.briefing === 8, 'reconhece os cabeçalhos comuns do SIGA')
ok(situacaoSiga('Em Aprovação') === 'em_aprovacao' && situacaoSiga('Finalizado') === 'concluida' && situacaoSiga('Aguardando cliente') === 'aguardando'
  && situacaoSiga('Em andamento') === 'em_producao' && situacaoSiga('Cancelado') === 'cancelado' && situacaoSiga('Publicado') === 'publicado' && situacaoSiga('') === 'nao_iniciada', 'situação do SIGA → situação da Pauta')
ok(dataSiga('05/10/2026') === '2026-10-05' && dataSiga('2026-10-05') === '2026-10-05' && dataSiga(46300) !== null && dataSiga('05/10/26') === '2026-10-05' && dataSiga('abc') === null, 'datas dd/mm/aaaa, ISO, Excel e dd/mm/aa')
ok(JSON.stringify(numeroSiga('113223B')) === JSON.stringify({ numero: '113223', rodada: 2 }) && numeroSiga('113223')?.rodada === 0 && numeroSiga('JOB-1') === null, 'número com a letra da rodada')

const hoje = '2026-10-02'
const linhas = [
  ['1001', 'Aberto antigo', 'C', '', 'Em produção', '2026-01-10', '2026-01-02'],      // em aberto: entra (mesmo antigo)
  ['1002', 'Concluído recente', 'C', '', 'Concluído', '2026-09-20', '2026-09-10'],   // recente: entra
  ['1003', 'Concluído antigo', 'C', '', 'Concluído', '2026-05-20', '2026-05-10'],    // fora da janela
  ['1004', 'Em aprovação antigo', 'C', '', 'Em aprovação', '2026-06-01', '2026-05-01'], // fora (regra do CEO)
  ['1005', 'Em aprovação recente', 'C', '', 'Em aprovação', '2026-09-30', '2026-09-25'], // entra
  ['1006', 'Cancelado', 'C', '', 'Cancelado', '2026-09-30', '2026-09-25'],          // fora
  ['1002', 'Repetido', 'C', '', 'Em produção', '', '2026-09-30'],                     // repetido
  ['', 'sem número', 'C', '', '', '', ''],                                             // sem número
  ['', '', '', '', '', '', ''],                                                        // linha vazia: ignorada
]
const r = selecionar(linhas, mapa, hoje)
ok(r.entra.map((l) => l.numero).join() === '1001,1002,1005', 'entram: em aberto + últimos 60 dias (inclusive em aprovação recente)')
const m = Object.fromEntries(r.fora.map((f) => [f.numero ?? 'x', f.motivo]))
ok(m['1003'] === 'fora_da_janela' && m['1004'] === 'em_aprovacao_antigo' && m['1006'] === 'cancelado' && r.fora.some((f) => f.motivo === 'repetido_na_planilha') && r.fora.some((f) => f.motivo === 'sem_numero') && r.fora.length === 5,
  'ficam de fora: concluído antigo, em aprovação antigo, cancelado, repetido, sem número (linha vazia nem conta)')

const mig = readFileSync('supabase/migrations/20261002270000_pm_importar_jobs_siga.sql', 'utf8')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\);/.test(mig) && /fn_acessos_pode_gerir\(p_company_id\)/.test(mig), 'só gestor da empresa importa')
ok(/IF EXISTS \(SELECT 1 FROM agency_jobs WHERE company_id = p_company_id AND numero = v_num\) THEN/.test(mig), 'número que já existe não entra de novo (não duplica)')
ok(/IF p_gravar THEN/.test(mig) && /p_gravar boolean DEFAULT false/.test(mig), 'prévia por padrão; grava só com confirmação')
ok(/jsonb_array_length\(p_linhas\) > 5000/.test(mig), 'limite de 5.000 linhas')
ok(/ARRAY\['siga'\]/.test(mig) && /fn_pm_cliente_garantir\(p_company_id, v_erp\)/.test(mig), 'job importado com etiqueta "siga" e cliente do cadastro')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_importar_jobs_siga\(uuid, jsonb, boolean\) FROM PUBLIC, anon;/.test(mig), 'nada aberto a anônimo')
ok(!/\b(DELETE\s+FROM|CREATE TABLE|DROP\s+(TABLE|COLUMN|FUNCTION))\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'sem tabela nova e nada apagado')
const tela = readFileSync('src/app/dashboard/pm/importar-siga/page.tsx', 'utf8')
ok(/chamar\(false\)/.test(tela) && /disabled=\{ocupado \|\| !conf \|\| !conf\.novos/.test(tela), 'tela: importar só depois de conferir no sistema')
for (const k of ['pm.siga.arquivo', 'pm.siga.mapa', 'pm.siga.previa']) ok(tela.includes(`chave="${k}"`) && mig.includes(`'${k}'`), `"?" ${k}`)
ok(readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8').includes('href="/dashboard/pm/importar-siga"'), 'Pauta vazia leva ao importador')

if (falhas) { console.error(`\ncheck-pm-importar-siga: ${falhas} falha(s)`); process.exit(1) }
console.log('\nImportador do SIGA: ok')
