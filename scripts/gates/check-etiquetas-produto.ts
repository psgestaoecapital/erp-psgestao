// Gate (CEO 30/09 · Diego/FC: etiquetas A4 de produtos). Roda no build, sem rede: gera o PDF de verdade (pdf-lib +
// bwip-js/node), lê o texto de volta (pdfjs) e confere nome, código, local e o código de barras de cada etiqueta,
// a folha 3×8, as cópias e o "começar na etiqueta nº". E as travas do código: a tela lê o local do banco.
import { readFileSync } from 'node:fs'
import bwipjs from 'bwip-js/node'
import { PDFDocument } from 'pdf-lib'
import {
  eanValido, simboloDoProduto, posicoesEtiquetas, expandirCopias, gerarEtiquetasA4, opcoesBwip, textoCode128,
  POR_FOLHA, type RenderBarcode,
} from '../../src/lib/produtos/etiquetasA4'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const render: RenderBarcode = async (s) => new Uint8Array(await bwipjs.toBuffer(opcoesBwip(s)))

async function textoDasPaginas(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join('\n'))
  }
  return out
}

async function main() {
  // 1) código de barras: EAN válido vira EAN; inválido/alfanumérico vira Code128; sem EAN usa o código interno
  ok(eanValido('4006381333931') && eanValido('96385074') && !eanValido('4006381333932'), 'dígito verificador do EAN-13/EAN-8')
  ok(JSON.stringify(simboloDoProduto({ codigo: 'X', nome: 'n', codigo_barras: '4006381333931' })) === '{"bcid":"ean13","texto":"4006381333931"}', 'EAN-13 válido sai como EAN-13')
  ok(simboloDoProduto({ codigo: 'X', nome: 'n', codigo_barras: '4006381333932' })?.bcid === 'code128', 'EAN com dígito errado não vira EAN (sai Code128, o leitor lê o que está impresso)')
  ok(JSON.stringify(simboloDoProduto({ codigo: 'ARG-001', nome: 'n', codigo_barras: null })) === '{"bcid":"code128","texto":"ARG-001"}', 'sem EAN: Code128 do código interno')
  ok(textoCode128('Tubo São João ½"') === 'Tubo Sao Joao -"', 'Code128 só com ASCII (acento tirado, resto vira -)')
  ok(simboloDoProduto({ codigo: '', nome: 'n', codigo_barras: '' }) === null, 'sem código nenhum: etiqueta sem barras (não inventa)')

  // 2) posições na folha 3×8, cópias e início
  const pos = posicoesEtiquetas(26, 3)
  ok(POR_FOLHA === 24, 'folha A4 de 24 etiquetas (3×8)')
  ok(pos[0].pagina === 0 && pos[0].linha === 0 && pos[0].coluna === 2, 'começar na nº 3: 1ª etiqueta na 3ª coluna da 1ª linha')
  ok(pos[21].pagina === 0 && pos[22].pagina === 1 && pos[22].linha === 0 && pos[22].coluna === 0, '22 cabem na 1ª folha; a 23ª abre a 2ª folha')
  ok(expandirCopias(['a', 'b'], 3).join('') === 'aaabbb', 'cópias repetem cada produto em sequência')

  // 3) PDF de verdade: 25 produtos → 2 folhas A4, cada etiqueta com nome, código, local e barras
  const produtos = Array.from({ length: 25 }, (_, i) => ({
    codigo: i === 3 ? 'E2E-ETQ-MUO0YCEO-A' : `FC-${String(i + 1).padStart(3, '0')}`,
    nome: i === 0 ? 'Argamassa colante AC-III cinza 20 kg para porcelanato de grande formato área externa' : `Produto ${i + 1}`,
    codigo_barras: i === 1 ? '4006381333931' : null,
    localizacao: i === 0 ? 'Galpão B · Prat. 3' : i === 2 ? null : `Rua ${i}`,
  }))
  const bytes = await gerarEtiquetasA4(produtos, { renderBarcode: render })
  const doc = await PDFDocument.load(bytes)
  ok(doc.getPageCount() === 2, `25 etiquetas = 2 folhas (${doc.getPageCount()})`)
  const { width, height } = doc.getPage(0).getSize()
  ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, 'página A4 (210×297 mm)')
  const txt = await textoDasPaginas(bytes)
  const p1 = txt[0]
  ok(p1.includes('Argamassa colante AC-III cinza 20 kg') && p1.includes('…'), 'nome longo em até 2 linhas, cortado com reticências')
  ok(p1.includes('Cód. FC-001') && p1.includes('Local: Galpão B · Prat. 3'), 'código e local de armazenagem (com acento) na etiqueta')
  ok(p1.includes('4006381333931'), 'EAN impresso legível embaixo das barras')
  ok(p1.includes('Local: —'), 'produto sem local mostra "Local: —" (não some o campo)')
  ok(p1.includes('Cód. E2E-ETQ-MUO0YCEO-A'), 'código longo sai inteiro, sem reticências (achado da aceitação 30/09)')
  ok(!/Cód\. [^\n]*…/.test(txt.join('\n')), 'nenhum código cortado')
  ok(txt[1].includes('Cód. FC-025') && !p1.includes('FC-025'), 'a 25ª etiqueta está na 2ª folha')
  const imagens = (Buffer.from(bytes).toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length
  ok(imagens === 25, `um código de barras por produto (${imagens} imagens)`)

  const copias = await PDFDocument.load(await gerarEtiquetasA4(produtos.slice(0, 5), { copias: 5, inicio: 1, renderBarcode: render }))
  ok(copias.getPageCount() === 2, '5 produtos × 5 cópias = 25 etiquetas = 2 folhas')
  let vazio = false
  try { await gerarEtiquetasA4([], { renderBarcode: render }) } catch { vazio = true }
  ok(vazio, 'sem produto selecionado: recusa com mensagem')

  // 4) travas do código: a tela marca produtos, abre o modal, e o modal lê o local do banco da empresa
  const tela = readFileSync('src/app/dashboard/cadastros/produtos/page.tsx', 'utf8')
  const modal = readFileSync('src/components/cadastros/EtiquetasProdutosModal.tsx', 'utf8')
  const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
  ok(tela.includes('data-testid="produto-sel"') && tela.includes('data-testid="etiquetas-abrir"') && tela.includes('<EtiquetasProdutosModal'), 'Produtos: marcar na lista + botão Etiquetas A4')
  ok(/select\('id,codigo,nome,codigo_barras,localizacao'\)/.test(modal) && modal.includes(".eq('company_id', companyId)"), 'modal lê nome/código/barras/local do banco, só da empresa')
  ok(form.includes('localizacao: localizacao.trim() || null'), 'ficha do produto grava o local de armazenagem')

  if (falhas) { console.error(`\n${falhas} falha(s) nas etiquetas A4`); process.exit(1) }
  console.log('\nEtiquetas A4: ok')
}

main().catch((e) => { console.error(e); process.exit(1) })
