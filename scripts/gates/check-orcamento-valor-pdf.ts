// Gate (Rodrigo, Canal PS 04/11 · chamado #6730 Tryo) — o valor do orçamento só-PDF não pode ser zerado pelo "Salvar" do formulário.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const page = readFileSync('src/app/dashboard/orcamentos/page.tsx', 'utf8')
const i = page.indexOf('somentePdfSemItens')
ok(i > 0, 'tela: detecta orçamento só-PDF sem itens ao salvar')
const bloco = page.slice(i, i + 600)
ok(/itensValidosCheck\.length===0 && !!editing\.pdf_anexo_path/.test(bloco), 'tela: condição = sem itens válidos E PDF já anexado')
ok(/delete dadosUpd\.subtotal;delete dadosUpd\.total/.test(bloco), 'tela: não regrava subtotal/total nesse caso (preserva o valor do "Salvar valor")')
ok(/\.update\(dadosUpd\)\.eq\("id",editing\.id\)/.test(bloco), 'tela: o UPDATE usa o payload sem total')
ok(/fn_orcamento_anexar_pdf/.test(page) && /onSaved=\{\(novoPath\)=>\{[\s\S]{0,200}loadOrcamentos\(\)/.test(page), 'tela: anexar/salvar valor recarrega a lista na hora')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
