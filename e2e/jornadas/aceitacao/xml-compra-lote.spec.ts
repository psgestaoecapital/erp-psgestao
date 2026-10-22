// GF4 · XML de compra em lote (caixa jordana-code d6441db4 — "entrada de documentos sem digitar").
// Em Compras › Documentos Recebidos, "Subir XMLs em lote" recebe vários arquivos (ou um .zip) e cada um passa pela
// mesma fn_nfe_recebida_upload_xml do envio de um arquivo. Um arquivo recusado não para o lote.
// Só frontend (a migration da PR só traz os textos do "?"): roda no preview. Demonstração Revenda (tem CNPJ);
// as notas criadas aqui são apagadas no fim (itens e parcelas saem em cascata).

import JSZip from 'jszip'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000003'
const CNPJ_DEMO = '11222333000181'
const CNPJ_FORNECEDOR = '55500000000223'

// chave de 44 números com o dígito verificador (módulo 11, pesos 2..9 da direita para a esquerda)
function chave(nNF: number): string {
  const sem = `4126${'10'}${CNPJ_FORNECEDOR}55001${String(nNF).padStart(9, '0')}1${String(nNF).padStart(8, '7')}`
  let soma = 0
  let peso = 2
  for (let i = sem.length - 1; i >= 0; i--) { soma += Number(sem[i]) * peso; peso = peso === 9 ? 2 : peso + 1 }
  const dv = 11 - (soma % 11)
  return sem + (dv >= 10 ? 0 : dv)
}

function xml(ch: string, dest: string, nNF: number, valor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">` +
    `<ide><cUF>41</cUF><natOp>Venda</natOp><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide>` +
    `<emit><CNPJ>${CNPJ_FORNECEDOR}</CNPJ><xNome>Fornecedor Lote Demo</xNome><IE>123</IE><enderEmit><UF>PR</UF></enderEmit></emit>` +
    `<dest><CNPJ>${dest}</CNPJ></dest>` +
    `<det nItem="1"><prod><cProd>P1</cProd><xProd>Filtro de óleo</xProd><NCM>84212300</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>${valor}</vUnCom><vProd>${valor}</vProd></prod></det>` +
    `<total><ICMSTot><vProd>${valor}</vProd><vNF>${valor}</vNF></ICMSTot></total>` +
    `<cobr><dup><nDup>001</nDup><dVenc>2026-11-01</dVenc><vDup>${valor}</vDup></dup></cobr>` +
    `</infNFe></NFe><protNFe><infProt><chNFe>${ch}</chNFe></infProt></protNFe></nfeProc>`
}

const base = 900000 + (Date.now() % 90000)
const CH_A = chave(base)
const CH_B = chave(base + 1)
const CH_OUTRA = chave(base + 2)

test.describe('XML de compra em lote (GF4)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-xml-compra-lote', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    await dbDelete('erp_nfe_recebidas', `company_id=eq.${DEMO}&chave_acesso=in.(${CH_A},${CH_B},${CH_OUTRA})`)
  })

  test('vários XMLs e um .zip viram notas prontas; o recusado mostra o motivo e não para o lote', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean; cnpj: string }>('companies', `id=eq.${DEMO}&select=is_demo,cnpj`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    expect((emp?.cnpj ?? '').replace(/\D/g, ''), 'a demo Revenda tem CNPJ').toBe(CNPJ_DEMO)

    const zip = new JSZip()
    zip.file('pasta/nota-b.xml', xml(CH_B, CNPJ_DEMO, base + 1, '80.50'))
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' })

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/compras/documentos-recebidos')
    await aguardarConteudo(page)
    await expect(page.getByRole('button', { name: /Subir XMLs em lote/ })).toBeEnabled({ timeout: 20000 })

    await page.getByTestId('xml-lote-input').setInputFiles([
      { name: 'nota-a.xml', mimeType: 'text/xml', buffer: Buffer.from(xml(CH_A, CNPJ_DEMO, base, '120.00')) },
      { name: 'outra-empresa.xml', mimeType: 'text/xml', buffer: Buffer.from(xml(CH_OUTRA, '99888777000166', base + 2, '10.00')) },
      { name: 'danfe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
      { name: 'contador.zip', mimeType: 'application/zip', buffer: zipBuf },
    ])

    const painel = page.getByTestId('xml-lote-painel')
    await expect(painel).toBeVisible({ timeout: 20000 })
    await expect(painel.getByTestId('xml-lote-resumo')).toContainText('2 notas prontas', { timeout: 30000 })
    await expect(painel.getByTestId('xml-lote-resumo')).toContainText('2 recusados')
    await expect(painel.locator('[data-testid="xml-lote-linha"][data-situacao="aplicada"]')).toHaveCount(2)
    await expect(painel.getByText(/A nota é para outro CNPJ \(99\.888\.777\/0001-66\)/)).toBeVisible()
    await expect(painel.getByText(/Só arquivos \.xml/)).toBeVisible()
    await expect(painel.getByText('contador.zip › nota-b.xml')).toBeVisible()

    const notas = await dbSelect<{ id: string; chave_acesso: string; status: string; xml_origem: string; valor_total: number }>('erp_nfe_recebidas',
      `company_id=eq.${DEMO}&chave_acesso=in.(${CH_A},${CH_B},${CH_OUTRA})&select=id,chave_acesso,status,xml_origem,valor_total`)
    expect(notas.length, 'só as 2 notas da empresa foram gravadas').toBe(2)
    const a = notas.find((n) => n.chave_acesso === CH_A)
    const b = notas.find((n) => n.chave_acesso === CH_B)
    expect(a?.status).toBe('completa')
    expect(a?.xml_origem).toBe('upload')
    expect(Number(a?.valor_total)).toBe(120)
    expect(Number(b?.valor_total), 'a nota de dentro do .zip também entrou').toBe(80.5)
    const itens = await dbSelect<{ descricao: string }>('erp_nfe_recebidas_itens',
      `nfe_recebida_id=in.(${notas.map((n) => n.id).join(',')})&select=descricao`)
    expect(itens.map((i) => i.descricao), 'os itens vieram do XML, sem digitar').toEqual(['Filtro de óleo', 'Filtro de óleo'])
    const dups = await dbSelect('erp_nfe_recebidas_duplicatas', `nfe_recebida_id=in.(${notas.map((n) => n.id).join(',')})&select=id`)
    expect(dups.length, 'as parcelas também').toBe(2)

    // reenviar o mesmo lote é idempotente: completa de novo, não duplica
    await page.getByRole('button', { name: 'Fechar' }).click()
    await page.getByTestId('xml-lote-input').setInputFiles([
      { name: 'nota-a.xml', mimeType: 'text/xml', buffer: Buffer.from(xml(CH_A, CNPJ_DEMO, base, '120.00')) },
    ])
    await expect(page.getByTestId('xml-lote-resumo')).toContainText('1 nota pronta', { timeout: 30000 })
    await expect(page.getByText(/Nota completada/)).toBeVisible()
    const deNovo = await dbSelect('erp_nfe_recebidas', `company_id=eq.${DEMO}&chave_acesso=eq.${CH_A}&select=id`)
    expect(deNovo.length, 'mesma chave não duplica').toBe(1)
  })
})
