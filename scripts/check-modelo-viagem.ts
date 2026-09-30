// Gate (CEO 30/09 · Diego/FC: relatório de viagem em planilha, importável depois pela tela de viagem sem redigitar).
// Roda no build, sem rede: gera o modelo, preenche como o colaborador preencheria (datas do Excel, texto, "150,90",
// rótulos das listas), lê de volta pela importação e confere o contrato: chaves na linha 4, abas, listas, validações,
// agrupamento por viagem, adiantamento uma vez, e os erros por linha (categoria/obra fora da lista, data fora do período).
import ExcelJS from 'exceljs'
import {
  gerarModeloViagem, lerPlanilhaViagem, lerData, lerValor, rotuloObra, rotuloCategoria, CHAVES_VIAGEM, COLUNAS_VIAGEM,
  ABA_LANCAMENTOS, ABA_INSTRUCOES, ABA_LISTAS, LINHA_CHAVES, PRIMEIRA_LINHA_DADOS, FORMAS_PAGAMENTO_VIAGEM,
} from '../src/lib/viagem/modeloPlanilha'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const OBRAS = [{ numero: 'OBR-2026-0001', nome: 'Obra teste — Lages/SC' }, { numero: 'OBR-2026-0002', nome: 'Obra teste 2' }]
const CATS = [
  { codigo: '2.05', descricao: 'Mobilização e permanência' },
  { codigo: '2.06', descricao: 'Veículos e equipamentos de obra' },
  { codigo: '5.01', descricao: 'Adiantamentos a colaboradores e viagens' },
]

async function main() {
  // 1) leitura de data e valor como vem do Excel/Planilhas Google
  ok(lerData(new Date(Date.UTC(2026, 9, 6))) === '2026-10-06' && lerData('06/10/2026') === '2026-10-06' && lerData('6/10/26') === '2026-10-06', 'data: Date, dd/mm/aaaa e d/m/aa')
  ok(lerData(46301) === '2026-10-06' && lerData('31/02/2026') === null && lerData('abc') === null, 'data: número serial do Excel; 31/02 recusado')
  ok(lerValor('1.250,90') === 1250.9 && lerValor('R$ 150,9') === 150.9 && lerValor(89.456) === 89.46 && lerValor('x') === null, 'valor: 1.250,90 / R$ / número')

  // 2) modelo: abas, linha 4 = chaves, cabeçalho com *, listas da empresa, validações
  const bytes = await gerarModeloViagem({ empresa: 'Empresa Teste', obras: OBRAS, categorias: CATS })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  ok(wb.worksheets.map((w) => w.name).join('|') === `${ABA_LANCAMENTOS}|${ABA_INSTRUCOES}|${ABA_LISTAS}`, 'abas: Lançamentos, Instruções, Listas')
  const ws = wb.getWorksheet(ABA_LANCAMENTOS)!
  const chaves: string[] = []
  ws.getRow(LINHA_CHAVES).eachCell((c) => { chaves.push(String(c.value)) })
  ok(chaves.join(',') === CHAVES_VIAGEM.join(','), 'linha 4 = chaves técnicas, na ordem do contrato')
  ok(CHAVES_VIAGEM.join(',') === 'colaborador,obra,periodo_inicio,periodo_fim,data,categoria,descricao,valor,forma_pagamento,adiantamento_recebido,observacao',
    'colunas pedidas pelo CEO: colaborador, obra, período, data, categoria, descrição, valor, forma de pagamento, adiantamento, observação')
  ok(String(ws.getCell(3, 1).value) === 'Colaborador *' && String(ws.getCell(3, 11).value) === 'Observação', 'cabeçalho: obrigatória com *')
  const wl = wb.getWorksheet(ABA_LISTAS)!
  ok(wl.getCell('A2').value === rotuloObra(OBRAS[0]) && wl.getCell('B4').value === rotuloCategoria(CATS[2]) && wl.getCell('C2').value === FORMAS_PAGAMENTO_VIAGEM[0].rotulo, 'aba Listas: obras, categorias e formas')
  const instr: string[] = []
  wb.getWorksheet(ABA_INSTRUCOES)!.eachRow((r) => instr.push(r.values ? (r.values as unknown[]).join(' ') : ''))
  const tInstr = instr.join('\n')
  ok(tInstr.includes('Adiantamento recebido') && tInstr.includes('2.06') && tInstr.includes('Não apague a linha 4'), 'aba Instruções: adiantamento, categorias, linha 4')
  const dv = (ws as unknown as { dataValidations: { model: Record<string, { type: string; formulae: unknown[] }> } }).dataValidations.model
  const dvCat = Object.entries(dv).find(([k]) => k.startsWith('F5'))?.[1]
  ok(dvCat?.type === 'list' && String(dvCat.formulae[0]).includes(`'${ABA_LISTAS}'!$B$2:$B$4`), 'categoria: lista suspensa das 3 categorias')
  ok(Object.values(dv).some((v) => v.type === 'date') && Object.values(dv).some((v) => v.type === 'decimal'), 'datas e valores com validação')

  // 3) preencher como o colaborador e importar de volta
  const L = (r: number, vals: unknown[]) => vals.forEach((v, i) => { ws.getCell(r, i + 1).value = v as ExcelJS.CellValue })
  const d = (s: string) => new Date(`${s}T00:00:00Z`)
  const r0 = PRIMEIRA_LINHA_DADOS
  L(r0, ['João da Silva', rotuloObra(OBRAS[0]), d('2026-10-06'), d('2026-10-10'), d('2026-10-06'), rotuloCategoria(CATS[0]), 'Hotel 2 diárias', 420, FORMAS_PAGAMENTO_VIAGEM[0].rotulo, 1000, 'NF 123'])
  L(r0 + 1, ['João  da Silva', rotuloObra(OBRAS[0]), '06/10/2026', '10/10/2026', '07/10/2026', rotuloCategoria(CATS[1]), 'Diesel caminhonete', '350,50', FORMAS_PAGAMENTO_VIAGEM[1].rotulo, '', ''])
  L(r0 + 2, ['Maria Souza', rotuloObra(OBRAS[1]), d('2026-10-01'), d('2026-10-02'), d('2026-10-02'), '2.05', 'Almoço', 45.9, FORMAS_PAGAMENTO_VIAGEM[4].rotulo, null, null])
  // linha em branco no meio (ignorada)
  L(r0 + 4, ['Pedro', rotuloObra(OBRAS[0]), d('2026-10-06'), d('2026-10-10'), d('2026-10-15'), '9.99 · Inexistente', 'x', 0, 'Cheque', null, null])
  L(r0 + 5, ['Ana', 'OBR-2099-0009 · Obra nova', d('2026-10-06'), d('2026-10-10'), d('2026-10-07'), rotuloCategoria(CATS[0]), 'Pedágio', 12, FORMAS_PAGAMENTO_VIAGEM[1].rotulo, null, null])
  L(r0 + 6, ['Maria Souza', rotuloObra(OBRAS[1]), d('2026-10-01'), d('2026-10-02'), d('2026-10-01'), '2.05', 'Jantar', 60, FORMAS_PAGAMENTO_VIAGEM[4].rotulo, 200, null])
  L(r0 + 7, ['Maria Souza', rotuloObra(OBRAS[1]), d('2026-10-01'), d('2026-10-02'), d('2026-10-01'), '2.05', 'Café', 10, FORMAS_PAGAMENTO_VIAGEM[4].rotulo, 300, null])
  const preenchido = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
  const res = await lerPlanilhaViagem(preenchido, { categoriasValidas: CATS.map((c) => c.codigo), obrasValidas: OBRAS.map((o) => o.numero) })

  ok(res.despesas.length === 5, `5 despesas válidas (${res.despesas.length})`)
  const joao = res.viagens.find((v) => v.colaborador === 'João da Silva')
  ok(!!joao && joao.despesas.length === 2 && joao.total_despesas === 770.5 && joao.adiantamento_recebido === 1000,
    'João: 2 despesas na mesma viagem (Date e texto), total 770,50, adiantamento 1.000 informado uma vez')
  ok(joao?.despesas[1].categoria_codigo === '2.06' && joao?.despesas[1].forma_pagamento === 'cartao_empresa' && joao?.despesas[0].observacao === 'NF 123',
    'categoria pelo código gerencial; forma pelo código; observação preservada')
  const erroEm = (linha: number, campo: string) => res.erros.some((e) => e.linha === linha && e.campo === campo)
  ok(erroEm(r0 + 4, 'data') && erroEm(r0 + 4, 'categoria') && erroEm(r0 + 4, 'valor') && erroEm(r0 + 4, 'forma_pagamento'),
    'linha ruim: data fora do período, categoria fora da empresa, valor zero, forma fora da lista')
  ok(erroEm(r0 + 5, 'obra') && !!res.erros.find((e) => e.linha === r0 + 5)?.mensagem.includes('cadastre a obra'), 'obra não cadastrada: pede cadastrar antes (não cria sozinho)')
  ok(erroEm(r0 + 7, 'adiantamento_recebido'), 'adiantamento diferente na mesma viagem é recusado')
  ok(!res.erros.some((e) => e.linha === r0 + 3), 'linha em branco é ignorada')

  // 4) arquivo errado / linha 4 apagada
  const outro = new ExcelJS.Workbook(); outro.addWorksheet('Plan1')
  const r1 = await lerPlanilhaViagem(new Uint8Array(await outro.xlsx.writeBuffer() as ArrayBuffer), { categoriasValidas: [], obrasValidas: [] })
  ok(r1.erros[0]?.campo === 'arquivo', 'arquivo sem a aba Lançamentos: recusado com mensagem')
  ws.getRow(LINHA_CHAVES).values = []
  const r2 = await lerPlanilhaViagem(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer), { categoriasValidas: [], obrasValidas: [] })
  ok(r2.erros[0]?.campo === 'cabecalho', 'linha 4 apagada: recusado com mensagem')
  ok(COLUNAS_VIAGEM.filter((c) => c.obrigatoria).length === 9, '9 colunas obrigatórias (adiantamento e observação opcionais)')
  let semObra = false
  try { await gerarModeloViagem({ empresa: 'x', obras: [], categorias: CATS }) } catch { semObra = true }
  ok(semObra, 'sem obra cadastrada: não gera modelo vazio')

  if (falhas) { console.error(`\n${falhas} falha(s) no modelo de viagem`); process.exit(1) }
  console.log('\nModelo de viagem: ok')
}

main().catch((e) => { console.error(e); process.exit(1) })
