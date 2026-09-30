// Gate (CEO 30/09 · Diego/FC: acerto de viagem em planilha, com os dados do acerto atual da FC em layout PS, importável
// depois pela tela de viagem sem redigitar). Roda no build, sem rede: gera o modelo, preenche como o colaborador
// preencheria (a viagem 471 do acerto de julho: alimentação, outras despesas, 2 abastecimentos), lê de volta pela
// importação e confere o contrato (chaves, abas, listas, validações, fórmulas do resumo), os totais do acerto
// (à vista × a prazo, pago pelo colaborador, saldo da prestação, km rodado, média km/l, custo por km, por categoria)
// e os erros por linha.
import ExcelJS from 'exceljs'
import {
  gerarModeloViagem, lerPlanilhaViagem, lerData, lerValor, rotuloObra, rotuloCategoria, CAMPOS_CABECALHO,
  COLUNAS_DESPESAS, COLUNAS_ABASTECIMENTOS, ABA_ACERTO, ABA_DESPESAS, ABA_ABASTECIMENTOS, ABA_INSTRUCOES, ABA_LISTAS,
  LINHA_CHAVES, PRIMEIRA_LINHA_DADOS, FORMAS_PAGAMENTO_VIAGEM, CAMPOS_TRANSPORTE,
} from '../src/lib/viagem/modeloPlanilha'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const OBRAS = [{ numero: 'OBR-2026-0001', nome: 'Obra teste — Promissão/SP' }]
const CATS = [
  { codigo: '2.05', descricao: 'Mobilização e permanência' },
  { codigo: '2.06', descricao: 'Veículos e equipamentos de obra' },
  { codigo: '5.01', descricao: 'Adiantamentos a colaboradores e viagens' },
]
const F = (c: string) => FORMAS_PAGAMENTO_VIAGEM.find((f) => f.codigo === c)!.rotulo
const d = (s: string) => new Date(`${s}T00:00:00Z`)
const buf = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b) as ArrayBuffer
const OP = { categoriasValidas: CATS.map((c) => c.codigo), obrasValidas: OBRAS.map((o) => o.numero) }

async function main() {
  // 1) leitura de data e número como vem do Excel/Planilhas Google
  ok(lerData(new Date(Date.UTC(2026, 6, 6))) === '2026-07-06' && lerData('06/07/2026') === '2026-07-06' && lerData('6/7/26') === '2026-07-06', 'data: Date, dd/mm/aaaa e d/m/aa')
  ok(lerData(46301) === '2026-10-06' && lerData('31/02/2026') === null, 'data: número serial do Excel; 31/02 recusado')
  ok(lerValor('1.080,00') === 1080 && lerValor('R$ 6,78') === 6.78 && lerValor(75.44) === 75.44 && lerValor('x') === null, 'número: 1.080,00 / R$ / decimal')

  // 2) modelo: abas, chaves, listas, validações, fórmulas
  const bytes = await gerarModeloViagem({ empresa: 'Empresa Teste', cnpj: '00.000.000/0001-00', obras: OBRAS, categorias: CATS })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf(bytes))
  ok(wb.worksheets.map((w) => w.name).join('|') === [ABA_ACERTO, ABA_DESPESAS, ABA_ABASTECIMENTOS, ABA_INSTRUCOES, ABA_LISTAS].join('|'), 'abas: Acerto, Despesas, Abastecimentos, Instruções, Listas')
  const wa = wb.getWorksheet(ABA_ACERTO)!, wd = wb.getWorksheet(ABA_DESPESAS)!, wab = wb.getWorksheet(ABA_ABASTECIMENTOS)!
  const chavesA: string[] = []
  wa.eachRow((r) => { const v = r.getCell(1).value; if (v) chavesA.push(String(v)) })
  ok(CAMPOS_CABECALHO.every((c) => chavesA.includes(c.chave)), 'Acerto: coluna A com as chaves do cabeçalho')
  ok(['viagem_numero', 'colaborador', 'obra', 'placa', 'periodo_inicio', 'periodo_fim', 'origem', 'destino', 'km_inicial', 'km_final', 'adiantamento_recebido'].every((k) => chavesA.includes(k)),
    'dados do acerto atual: viagem, motorista, obra, placa, período, origem/destino, km inicial/final, adiantamento')
  const linha4 = (ws: ExcelJS.Worksheet) => { const k: string[] = []; ws.getRow(LINHA_CHAVES).eachCell((c) => { k.push(String(c.value)) }); return k.join(',') }
  ok(linha4(wd) === COLUNAS_DESPESAS.map((c) => c.chave).join(','), 'Despesas: linha 4 = chaves (data, fornecedor, nº doc, tipo, categoria, obs, forma, pago pelo colaborador, valor)')
  ok(linha4(wab) === COLUNAS_ABASTECIMENTOS.map((c) => c.chave).join(','), 'Abastecimentos: linha 4 = chaves (data, placa, posto, nº doc, hodômetro, litros, valor, R$/litro, tanque cheio, forma, pago)')
  const dv = (ws: ExcelJS.Worksheet) => (ws as unknown as { dataValidations: { model: Record<string, { type: string; formulae: unknown[] }> } }).dataValidations.model
  ok(Object.entries(dv(wd)).some(([k, v]) => k.startsWith('E5') && v.type === 'list' && String(v.formulae[0]).includes(`'${ABA_LISTAS}'!$B$2:$B$4`)), 'Despesas: categoria em lista suspensa (3 categorias)')
  ok(Object.values(dv(wab)).filter((v) => v.type === 'list').length >= 3, 'Abastecimentos: forma, tanque cheio e pago pelo colaborador em lista')
  const formulas: string[] = []
  wa.eachRow((r) => r.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && v.formula) formulas.push(v.formula) }))
  ok(formulas.some((f) => f.includes('SUMIF') && f.includes('"Sim"')) && formulas.some((f) => f.includes('ROUND') && f.includes('/')), 'Acerto: resumo em fórmula (pago pelo colaborador, média, custo/km)')
  const txtInstr: string[] = []
  wb.getWorksheet(ABA_INSTRUCOES)!.eachRow((r) => txtInstr.push((r.values as unknown[]).join(' ')))
  ok(txtInstr.join('\n').includes('Saldo da prestação') && txtInstr.join('\n').includes('2.06'), 'Instruções: saldo da prestação e categorias')

  // 3) preencher a viagem 471 (acerto de julho) e importar
  const setC = (k: string, v: ExcelJS.CellValue) => { wa.eachRow((r) => { if (r.getCell(1).value === k) r.getCell(3).value = v }) }
  setC('viagem_numero', '471'); setC('colaborador', 'Paulinho Kunzler'); setC('obra', rotuloObra(OBRAS[0])); setC('placa', 'RYF1G36')
  setC('periodo_inicio', d('2026-07-06')); setC('periodo_fim', '17/07/2026'); setC('origem', 'Iporã do Oeste/SC'); setC('destino', 'Promissão/SP')
  setC('km_inicial', 160261); setC('km_final', 161187); setC('adiantamento_recebido', 5000)
  const L = (ws: ExcelJS.Worksheet, r: number, vals: unknown[]) => vals.forEach((v, i) => { ws.getCell(r, i + 1).value = v as ExcelJS.CellValue })
  const R = PRIMEIRA_LINHA_DADOS
  const cat = (i: number) => rotuloCategoria(CATS[i])
  L(wd, R, [d('2026-07-06'), 'RESTAURANTE BELL MAIK LTDA', '56', 'Alimentação', cat(0), '', F('dinheiro'), 'Sim', 286])
  L(wd, R + 1, ['08/07/2026', 'DOUGLAS PAZNEAUSKI', '22606', 'Alimentação', cat(0), '', F('cartao_proprio'), 'Sim', '297,93'])
  L(wd, R + 2, [d('2026-07-17'), 'MARIA LUIZA DOS SANTOS DE MELO', '125', 'Alimentação', cat(0), '3 dias de marmita', F('a_prazo'), 'Não', 1080])
  L(wd, R + 3, [d('2026-07-10'), 'POSTO PEIXINHO PROMISSAO LTDA', '129602', 'Outras despesas', cat(1), '', F('dinheiro'), 'Sim', 157.77])
  L(wab, R, [d('2026-07-06'), 'RYF1G36', 'SANTA RITA COMERCIO DE COMBUSTIVEL', '', 160884, 75.44, 511.46, null, 'Sim', F('cartao_empresa'), 'Não'])
  L(wab, R + 1, [d('2026-07-12'), 'ryf1g36', 'POSTO PEIXINHO PROMISSAO LTDA', '', 161187, '40,93', '286,10', null, 'Sim', F('dinheiro'), 'Sim'])
  const preenchido = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
  const res = await lerPlanilhaViagem(preenchido, OP)

  ok(res.erros.length === 0, `viagem 471 sem erros (${res.erros.map((e) => `${e.aba}:${e.linha}:${e.campo}`).join(' ')})`)
  ok(res.cabecalho?.colaborador === 'Paulinho Kunzler' && res.cabecalho.obra_numero === 'OBR-2026-0001' && res.cabecalho.periodo_inicio === '2026-07-06' && res.cabecalho.periodo_fim === '2026-07-17',
    'cabeçalho: colaborador, obra, período (Date e texto)')
  ok(res.despesas.length === 4 && res.abastecimentos.length === 2, '4 despesas e 2 abastecimentos')
  ok(res.abastecimentos[1].placa === 'RYF1G36' && res.abastecimentos.every((a) => a.categoria_codigo === '2.06'), 'abastecimento: placa normalizada, categoria 2.06')
  const s = res.resumo!
  ok(s.total_despesas === 1821.7 && s.total_abastecimentos === 797.56 && s.total === 2619.26, `totais: despesas 1.821,70 + abastecimentos 797,56 = 2.619,26 (${s.total})`)
  ok(s.a_prazo === 1080 && s.a_vista === 1539.26, 'a prazo 1.080,00 (faturado p/ empresa) · à vista 1.539,26')
  ok(s.pago_colaborador === 1027.8 && s.saldo === 3972.2, 'pago pelo colaborador 1.027,80 · saldo da prestação 3.972,20 (colaborador devolve)')
  ok(s.km_rodado === 926 && s.litros === 116.37 && s.media_km_l === 7.96 && s.custo_km === 2.83, `km 926 · 116,37 L · média 7,96 km/l · custo/km 2,83 (${s.media_km_l}, ${s.custo_km})`)
  ok(s.por_categoria['2.05'] === 1663.93 && s.por_categoria['2.06'] === 955.33, 'por categoria: 2.05 = 1.663,93 · 2.06 = 157,77 + 797,56')

  // 4) erros por linha
  L(wd, R + 5, [d('2026-07-20'), 'X', '', 'Alimentação', '9.99 · Inexistente', '', 'Cheque', 'Talvez', 0])
  L(wab, R + 3, [d('2026-07-10'), 'RYF1G36', 'Posto', '', 170000, 10, 50, null, 'Sim', F('dinheiro'), 'Sim'])
  setC('obra', 'OBR-2099-0009 · Obra nova')
  const res2 = await lerPlanilhaViagem(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer), OP)
  const erroEm = (aba: string, linha: number, campo: string) => res2.erros.some((e) => e.aba === aba && e.linha === linha && e.campo === campo)
  ok(['data', 'categoria', 'forma_pagamento', 'pago_colaborador', 'valor'].every((c) => erroEm(ABA_DESPESAS, R + 5, c)),
    'despesa ruim: fora do período, categoria fora da empresa, forma fora da lista, Sim/Não, valor zero')
  ok(erroEm(ABA_ABASTECIMENTOS, R + 3, 'hodometro'), 'abastecimento com hodômetro acima do km final é recusado')
  ok(res2.erros.some((e) => e.aba === ABA_ACERTO && e.campo === 'obra' && e.mensagem.includes('cadastre a obra')), 'obra não cadastrada: pede cadastrar antes (não cria sozinho)')
  ok(!res2.erros.some((e) => e.linha === R + 4), 'linha em branco no meio é ignorada')

  // 5) arquivo errado / chaves apagadas
  const outro = new ExcelJS.Workbook(); outro.addWorksheet('Plan1')
  const r1 = await lerPlanilhaViagem(new Uint8Array(await outro.xlsx.writeBuffer() as ArrayBuffer), OP)
  ok(r1.erros[0]?.campo === 'arquivo', 'arquivo que não é o modelo: recusado com mensagem')
  wd.getRow(LINHA_CHAVES).values = []
  const r2 = await lerPlanilhaViagem(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer), OP)
  ok(r2.erros.some((e) => e.aba === ABA_DESPESAS && e.campo === 'cabecalho'), 'linha 4 das Despesas apagada: recusado com mensagem')
  // 6) perfil transporte (opção por empresa; a FC usa o padrão): campos de transportadora só aparecem quando pedidos
  ok(res.cabecalho?.transporte === null && res.resumo?.transporte === null, 'perfil padrão (FC): sem campos de transporte')
  ok(!chavesA.some((k) => CAMPOS_TRANSPORTE.some((c) => c.chave === k)), 'modelo padrão não mostra peso/km vazio/fretes/salário')
  const bt = await gerarModeloViagem({ empresa: 'Transportadora Teste', obras: OBRAS, categorias: CATS, perfil: 'transporte' })
  const wt = new ExcelJS.Workbook(); await wt.xlsx.load(buf(bt))
  const wat = wt.getWorksheet(ABA_ACERTO)!
  const chavesT: string[] = []
  wat.eachRow((r) => { const v = r.getCell(1).value; if (v) chavesT.push(String(v)) })
  ok(CAMPOS_TRANSPORTE.every((c) => chavesT.includes(c.chave)), 'perfil transporte: peso, km vazio/carregado, fretes e salário no Acerto')
  const resumoT: string[] = []
  wat.eachRow((r) => { const v = r.getCell(4).value; if (v) resumoT.push(String(v)) })
  ok(resumoT.includes('res_rendimento') && resumoT.includes('res_rendimento_km'), 'perfil transporte: rendimento da viagem e por km no resumo')
  const setT = (k: string, v: ExcelJS.CellValue) => { wat.eachRow((r) => { if (r.getCell(1).value === k) r.getCell(3).value = v }) }
  setT('colaborador', 'Motorista Teste'); setT('obra', rotuloObra(OBRAS[0])); setT('periodo_inicio', d('2026-07-06')); setT('periodo_fim', d('2026-07-17'))
  setT('km_inicial', 160261); setT('km_final', 161187); setT('frete_total', 9000); setT('salario_motorista', '1.200,00'); setT('peso_carga', 25000)
  const wdt = wt.getWorksheet(ABA_DESPESAS)!
  L(wdt, R, [d('2026-07-06'), 'RESTAURANTE', '56', 'Alimentação', cat(0), '', F('dinheiro'), 'Sim', 286])
  const rt = await lerPlanilhaViagem(new Uint8Array(await wt.xlsx.writeBuffer() as ArrayBuffer), OP)
  ok(rt.erros.length === 0 && rt.cabecalho?.transporte?.peso_carga === 25000 && rt.cabecalho.transporte.salario_motorista === 1200, 'perfil transporte: lê peso e salário')
  ok(rt.resumo?.transporte?.rendimento === 7514 && rt.resumo.transporte.rendimento_km === 8.11, `rendimento = 9.000 − 286 − 1.200 = 7.514 · 8,11/km (${rt.resumo?.transporte?.rendimento})`)

  let semObra = false
  try { await gerarModeloViagem({ empresa: 'x', obras: [], categorias: CATS }) } catch { semObra = true }
  ok(semObra, 'sem obra cadastrada: não gera modelo vazio')

  if (falhas) { console.error(`\n${falhas} falha(s) no acerto de viagem`); process.exit(1) }
  console.log('\nAcerto de viagem: ok')
}

main().catch((e) => { console.error(e); process.exit(1) })
