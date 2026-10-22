/**
 * Gate (#3281, etapa 2): o gerador dos relatórios em segundo plano.
 * - migration aditiva: bucket privado "relatorios", leitura só do próprio arquivo (empresa + solicitante), função das
 *   linhas com a MESMA regra do saldo (baixa ativa, legado quitado sem baixa, excluídos fora) só para service_role, e
 *   acionador do pg_cron que não chama nada sem pedido na fila (custo zero parado);
 * - rota do gerador: só processa a fila (empresa/solicitante vêm do pedido), grava em {empresa}/{solicitante}/{pedido};
 * - a planilha soma entradas e saídas por mês e NÃO conta transferência como receita/despesa (montada de verdade aqui).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { montarPlanilhaMovimentacao, resumoMensal, type LinhaMovimentacao } from '../../src/lib/relatorios/movimentacaoExcel'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

async function main() {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const arq = readdirSync(dir).find((f) => f.endsWith('_relatorio_gerador_movimentacao.sql'))
  ok(!!arq, 'migration relatorio_gerador_movimentacao existe')
  const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

  ok(/INSERT INTO storage\.buckets[\s\S]*?'relatorios', 'relatorios', false/.test(sql), 'bucket "relatorios" é privado')
  ok(/CREATE POLICY relatorios_ler_proprio ON storage\.objects FOR SELECT TO authenticated/.test(sql), 'logado só LÊ (sem gravar/apagar)')
  ok(/\(storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text/.test(sql)
    && /\(storage\.foldername\(name\)\)\[1\] IN \(SELECT public\.get_user_company_ids\(\)::text\)/.test(sql), 'arquivo só do próprio solicitante, de empresa com acesso')
  const fn = /FUNCTION public\.fn_relatorio_movimentacao_linhas[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? ''
  ok(!!fn, 'função das linhas existe')
  ok((fn.match(/deleted_at IS NULL/g) ?? []).length >= 4, 'baixas e títulos excluídos ficam fora')
  ok(/t\.tem_baixa AND t\.status IN \('recebido','pago','parcial'\)/.test(fn) && /NOT t\.tem_baixa AND t\.status IN \('recebido','pago'\)/.test(fn), 'recebimentos: mesma regra do saldo (baixa ou legado quitado)')
  ok(/t\.tem_baixa AND t\.status IN \('pago','parcial'\)/.test(fn) && /NOT t\.tem_baixa AND t\.status = 'pago'/.test(fn), 'pagamentos: mesma regra do saldo (baixa ou legado quitado)')
  ok((fn.match(/company_id = p_company_id/g) ?? []).length >= 5, 'toda leitura filtrada pela empresa do pedido')
  ok(!/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i.test(fn), 'função das linhas não grava nada')
  ok(/REVOKE ALL ON FUNCTION public\.fn_relatorio_movimentacao_linhas\(uuid,date,date\) FROM anon, PUBLIC, authenticated/.test(sql), 'linhas: só service_role')
  ok(/REVOKE ALL ON FUNCTION public\.fn_relatorio_fila_dispatch\(\) FROM anon, PUBLIC, authenticated/.test(sql), 'acionador: só service_role')
  ok(/IF NOT EXISTS \(SELECT 1 FROM erp_relatorio_pedido[\s\S]*?RETURN jsonb_build_object\('ok', true, 'acionado', false\)[\s\S]*?net\.http_post/.test(sql), 'acionador não chama a rota sem pedido na fila')
  ok(/cron\.schedule\('relatorio-fila-gerador'/.test(sql), 'pg_cron agendado')
  ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN|ALTER TABLE)\b/i.test(sql) && !/CREATE OR REPLACE VIEW/i.test(sql), 'aditiva: sem DELETE/DROP/ALTER e sem view')

  const rota = 'src/app/api/relatorios/fila/route.ts'
  const ts = existsSync(rota) ? readFileSync(rota, 'utf8') : ''
  ok(/comGuarda\(\{ cron: true, servico: true \}/.test(ts), 'rota exige login, cron ou service key')
  ok(/'fn_relatorio_fila_pegar'/.test(ts) && /'fn_relatorio_fila_atualizar'/.test(ts), 'rota usa a fila (pegar/atualizar)')
  ok(/`\$\{p\.company_id\}\/\$\{p\.solicitante\}\/\$\{p\.id\}\.xlsx`/.test(ts), 'arquivo na pasta {empresa}/{solicitante}')
  ok(!/req\.json\(\)/.test(ts), 'rota não aceita empresa/solicitante do corpo')
  const tela = readFileSync('src/app/dashboard/financeiro/meus-relatorios/page.tsx', 'utf8')
  ok(/fetch\('\/api\/relatorios\/fila'/.test(tela), 'tela acorda o gerador logo após o pedido')

  // planilha de verdade: 2 meses, parcial em 2 baixas, legado, transferência fora do resultado
  const L = (o: Partial<LinhaMovimentacao>): LinhaMovimentacao => ({ chave: '', data: '', tipo: 'Recebimento', pessoa: null, descricao: null,
    categoria: null, documento: null, conta: null, forma: null, entrada: null, saida: null, transferido: null, origem: null, ...o })
  const linhas = [
    L({ chave: 'rb:1', data: '2026-09-30', entrada: 2255 }),
    L({ chave: 'rb:2', data: '2026-10-13', entrada: 2253 }),
    L({ chave: 'rb:3', data: '2026-10-14', entrada: 195 }),
    L({ chave: 'p:9', data: '2026-10-02', tipo: 'Pagamento', saida: 1000.1 }),
    L({ chave: 'tr:5', data: '2026-10-05', tipo: 'Transferência', transferido: 100 }),
  ]
  const r = resumoMensal(linhas)
  ok(r.length === 2 && r[0].mes === '2026-09' && r[0].entradas === 2255, 'resumo: setembro com a 1ª baixa')
  ok(r[1].entradas === 2448 && r[1].saidas === 1000.1 && r[1].resultado === 1447.9, 'resumo: outubro soma baixas e pagamento; transferência fora')
  const buf = await montarPlanilhaMovimentacao(linhas, { empresa: 'Teste', titulo: 'Movimentação', dataInicio: '2026-09-01', dataFim: '2026-10-31', geradoEm: new Date('2026-10-16T12:00:00Z') })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const wm = wb.getWorksheet('Movimentação')
  const wr = wb.getWorksheet('Resumo')
  ok(!!wm && wm.rowCount === 1 + linhas.length, 'aba Movimentação: uma linha por lançamento')
  ok(!!wm && wm.getRow(2).getCell(1).value === '30/09/2026', 'aba Movimentação: em ordem de data')
  const total = wr?.getRow(4)
  ok(!!total && total.getCell(1).value === 'Total' && total.getCell(2).value === 4703 && total.getCell(3).value === 1000.1, 'aba Resumo: total = 4.703,00 recebido e 1.000,10 pago')

  if (falhas) { console.error(`\n[check-relatorio-gerador] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
  console.log('\n[check-relatorio-gerador] gerador dos relatórios em segundo plano conferido.')
}

main().catch((e) => { console.error(e); process.exit(1) })
