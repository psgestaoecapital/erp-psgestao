// Gate · PM-J — importador de jobs do SIGA (CEO 02/10). Sem rede.
// Regra do CEO (05/10, blueprint): últimos 180 dias + em aberto; "em aprovação" antigo fica de fora; nada gravado sem prévia; não duplica.
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { adivinharMapa, dataSiga, ehCsv, numeroSiga, selecionar, situacaoSiga, textoCsv, tituloSemData } from '../../src/lib/pm/importSiga'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const cab = ['Nº Job', 'Título do Job', 'Cliente', 'Responsável', 'Status', 'Prazo', 'Data de Criação', 'Tipo de Peça', 'Descrição', 'Fornecedor', 'Terceiros']
const mapa = adivinharMapa(cab)
ok(mapa.numero === 0 && mapa.titulo === 1 && mapa.cliente === 2 && mapa.responsavel === 3 && mapa.situacao === 4 && mapa.prazo === 5 && mapa.criacao === 6 && mapa.peca === 7 && mapa.briefing === 8, 'reconhece os cabeçalhos comuns do SIGA')
// PM-Q (PDCA 27/11): fornecedor e terceiros também são reconhecidos e mapeados.
ok(mapa.fornecedor === 9 && mapa.terceiros === 10, 'reconhece as colunas de fornecedor e terceiros')
ok(situacaoSiga('Em Aprovação') === 'em_aprovacao' && situacaoSiga('Finalizado') === 'concluida' && situacaoSiga('Aguardando cliente') === 'aguardando'
  && situacaoSiga('Em andamento') === 'em_producao' && situacaoSiga('Cancelado') === 'cancelado' && situacaoSiga('Publicado') === 'publicado' && situacaoSiga('') === 'nao_iniciada', 'situação do SIGA → situação da Pauta')
ok(dataSiga('05/10/2026') === '2026-10-05' && dataSiga('2026-10-05') === '2026-10-05' && dataSiga(46300) !== null && dataSiga('05/10/26') === '2026-10-05' && dataSiga('abc') === null, 'datas dd/mm/aaaa, ISO, Excel e dd/mm/aa')
ok(JSON.stringify(numeroSiga('113223B')) === JSON.stringify({ numero: '113223', rodada: 2 }) && numeroSiga('113223')?.rodada === 0 && numeroSiga('JOB-1') === null, 'número com a letra da rodada')

// PM-Q regra 00.3 · "título sem data": tira a data embutida das pontas/parênteses, preserva miolo e não-datas; idempotente.
ok(tituloSemData('( 01/12) Post feed') === 'Post feed'
  && tituloSemData('05/10/2026 - Campanha dia das mães') === 'Campanha dia das mães'
  && tituloSemData('Banner promo 23/11') === 'Banner promo'
  && tituloSemData('[05/10] Stories') === 'Stories'
  && tituloSemData('Vídeo | 30/09/2026') === 'Vídeo'
  && tituloSemData('Top 10/10 motivos') === 'Top 10/10 motivos'
  && tituloSemData('Peça 99/99') === 'Peça 99/99'
  && tituloSemData(tituloSemData('( 01/12) Post feed')) === 'Post feed',
  'título sem data: remove data embutida nas pontas/parênteses, mantém miolo e não-datas, idempotente')

const hoje = '2026-10-02'
const linhas = [
  ['1001', 'Aberto antigo', 'C', '', 'Em produção', '2026-01-10', '2026-01-02'],      // em aberto: entra (mesmo antigo)
  ['1002', 'Concluído recente', 'C', '', 'Concluído', '2026-09-20', '2026-09-10'],   // recente: entra
  ['1003', 'Concluído antigo', 'C', '', 'Concluído', '2026-01-20', '2026-01-10'],    // fora da janela (>180 dias)
  ['1004', 'Em aprovação antigo', 'C', '', 'Em aprovação', '2026-02-01', '2026-01-15'], // fora (regra do CEO, >180 dias)
  ['1005', 'Em aprovação recente', 'C', '', 'Em aprovação', '2026-09-30', '2026-09-25'], // entra
  ['1006', 'Cancelado', 'C', '', 'Cancelado', '2026-09-30', '2026-09-25'],          // fora
  ['1002', 'Repetido', 'C', '', 'Em produção', '', '2026-09-30'],                     // repetido
  ['', 'sem número', 'C', '', '', '', ''],                                             // sem número
  ['', '', '', '', '', '', ''],                                                        // linha vazia: ignorada
]
const r = selecionar(linhas, mapa, hoje)
ok(r.entra.map((l) => l.numero).join() === '1001,1002,1005', 'entram: em aberto + últimos 180 dias (inclusive em aprovação recente)')
const m = Object.fromEntries(r.fora.map((f) => [f.numero ?? 'x', f.motivo]))
ok(m['1003'] === 'fora_da_janela' && m['1004'] === 'em_aprovacao_antigo' && m['1006'] === 'cancelado' && r.fora.some((f) => f.motivo === 'repetido_na_planilha') && r.fora.some((f) => f.motivo === 'sem_numero') && r.fora.length === 5,
  'ficam de fora: concluído antigo, em aprovação antigo, cancelado, repetido, sem número (linha vazia nem conta)')

// selecionar aplica o "título sem data" no job importado (PM-Q); se o título for só a data, preserva o original.
{
  const mapaT = { numero: 0, titulo: 1, cliente: 2, responsavel: 3, situacao: 4, prazo: 5, criacao: 6 }
  const rT = selecionar([
    ['2001', '( 15/03) Post carrossel', 'C', '', 'Em produção', '', '2026-09-30'],
    ['2002', '05/10/2026', 'C', '', 'Em produção', '', '2026-09-30'],
  ], mapaT, hoje)
  ok(rT.entra.length === 2 && rT.entra[0].titulo === 'Post carrossel' && rT.entra[1].titulo === '05/10/2026',
    'selecionar limpa a data do título e mantém o original quando o título é só a data')
}

// PM-Q (PDCA 27/11): selecionar carrega fornecedor e terceiros para o job importado (migram, não se perdem).
{
  const mapaF = { numero: 0, titulo: 1, situacao: 2, criacao: 3, fornecedor: 4, terceiros: 5 }
  const rF = selecionar([
    ['3001', 'Post', 'Em produção', '2026-09-30', 'Gráfica Alfa', 'Freela João'],
    ['3002', 'Reels', 'Em produção', '2026-09-30', '', ''],
  ], mapaF, hoje)
  ok(rF.entra.length === 2 && rF.entra[0].fornecedor === 'Gráfica Alfa' && rF.entra[0].terceiros === 'Freela João'
    && rF.entra[1].fornecedor === null && rF.entra[1].terceiros === null,
    'selecionar carrega fornecedor/terceiros (vazio vira null)')
}

// PM-Q (PDCA 27/11): a migration aditiva cria as colunas e o INSERT grava fornecedor/terceiros no job.
const migFT = readFileSync('supabase/migrations/20261128190445_pm_importar_jobs_fornecedor_terceiros.sql', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS fornecedor text/.test(migFT) && /ADD COLUMN IF NOT EXISTS terceiros\s+text/.test(migFT), 'migration cria as colunas fornecedor e terceiros (aditiva)')
ok(/NULLIF\(btrim\(l->>'fornecedor'\), ''\)/.test(migFT) && /NULLIF\(btrim\(l->>'terceiros'\), ''\)/.test(migFT), 'o INSERT grava fornecedor e terceiros no job')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_importar_jobs_siga\(uuid, jsonb, boolean\) FROM PUBLIC, anon;/.test(migFT), 'função continua fechada a anônimo após o CREATE OR REPLACE')
ok(!/\b(DROP\s+(TABLE|COLUMN|FUNCTION)|TRUNCATE|DELETE\s+FROM)\b/i.test(migFT.split('\n').filter((ln) => !ln.trim().startsWith('--')).join('\n')), 'migration aditiva: nada apagado/truncado')

const mig = readFileSync('supabase/migrations/20261002270000_pm_importar_jobs_siga.sql', 'utf8')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\);/.test(mig) && /fn_acessos_pode_gerir\(p_company_id\)/.test(mig), 'só gestor da empresa importa')
ok(/IF EXISTS \(SELECT 1 FROM agency_jobs WHERE company_id = p_company_id AND numero = v_num\) THEN/.test(mig), 'número que já existe não entra de novo (não duplica)')
ok(/IF p_gravar THEN/.test(mig) && /p_gravar boolean DEFAULT false/.test(mig), 'prévia por padrão; grava só com confirmação')
ok(/jsonb_array_length\(p_linhas\) > 5000/.test(mig), 'limite de 5.000 linhas')
ok(/ARRAY\['siga'\]/.test(mig) && /fn_pm_cliente_garantir\(p_company_id, v_erp\)/.test(mig), 'job importado com etiqueta "siga" e cliente do cadastro')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_importar_jobs_siga\(uuid, jsonb, boolean\) FROM PUBLIC, anon;/.test(mig), 'nada aberto a anônimo')
ok(!/\b(DELETE\s+FROM|CREATE TABLE|DROP\s+(TABLE|COLUMN|FUNCTION))\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'sem tabela nova e nada apagado')
const tela = readFileSync('src/app/dashboard/pm/importar-sistema-anterior/page.tsx', 'utf8')
ok(/chamar\(false\)/.test(tela) && /disabled=\{ocupado \|\| !conf \|\| !conf\.novos/.test(tela), 'tela: importar só depois de conferir no sistema')
// RD-100: identificador interno renomeado pm.siga.* -> pm.importacao.*; a rota das chaves de ajuda foi
// repontada para /dashboard/pm/importar-sistema-anterior na migration abaixo (os "?" abriam vazios antes).
const migAjuda = readFileSync('supabase/migrations/20261111120040_pm_importacao_ajuda_rota_rd100.sql', 'utf8')
for (const k of ['pm.importacao.arquivo', 'pm.importacao.mapa', 'pm.importacao.previa']) ok(tela.includes(`chave="${k}"`) && migAjuda.includes(`'${k}'`), `"?" ${k}`)
ok(migAjuda.includes("rota  = '/dashboard/pm/importar-sistema-anterior'") && migAjuda.includes("'pm.importacao.historico'"), 'ajuda repontada para a rota nova na migration')
ok(readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8').includes('href="/dashboard/pm/importar-sistema-anterior"'), 'Pauta vazia leva ao importador')

// veredito em produção 02/10 (#1991): o CSV lido como bytes trocava os acentos ("NÂº Job") e o mapa não achava número
// nem título; e a biblioteca lia 05/10/2026 como 10 de maio. CSV vira texto (UTF-8 ou Windows-1252) e as datas ficam texto.
{
  const csv = 'Nº Job,Título do Job,Cliente,Responsável,Status,Prazo,Data de Criação,Tipo de Peça\n24101,Post,Café Serra Azul,,Em produção,05/10/2026,01/10/2026,Post feed'
  const ler = (bytes: Uint8Array) => {
    const wb = XLSX.read(textoCsv(bytes), { type: 'string', raw: true })
    return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  }
  const utf8 = ler(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]))
  const mapa = adivinharMapa((utf8[0] as unknown[]).map(String))
  ok(mapa.numero === 0 && mapa.titulo === 1 && mapa.cliente === 2 && mapa.responsavel === 3 && mapa.peca === 7, 'CSV UTF-8 (com BOM): acentos certos e mapa completo')
  ok(dataSiga(utf8[1][5]) === '2026-10-05', 'CSV: 05/10/2026 é 5 de outubro (não 10 de maio)')
  const win = new Uint8Array([...csv].map((c) => { const k = c.charCodeAt(0); return k < 256 ? k : 63 }))  // Windows-1252 = Latin-1 nesses acentos
  ok(String(ler(win)[0][1]) === 'Título do Job' && String(ler(win)[0][0]) === 'Nº Job', 'CSV Windows-1252 (Excel brasileiro): acentos certos')
  ok(ehCsv('jobs.CSV') && ehCsv('x', 'text/csv') && !ehCsv('jobs.xlsx'), 'reconhece o CSV pelo nome ou tipo')
  const tela = readFileSync('src/app/dashboard/pm/importar-sistema-anterior/page.tsx', 'utf8')
  ok(/ehCsv\(f\.name, f\.type\)/.test(tela) && /XLSX\.read\(textoCsv\(/.test(tela) && /type: "string", raw: true/.test(tela), 'tela lê CSV como texto, sem converter datas')
}

if (falhas) { console.error(`\ncheck-pm-importar-siga: ${falhas} falha(s)`); process.exit(1) }
console.log('\nImportador do SIGA: ok')
