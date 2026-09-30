/**
 * Gate de build · Tryo #264 + #266 (anexos). #266: a Nova oportunidade aceita fotos, PDF e DWG já na criação (anexos
 * em espera presos no CRIAR). #264: o orçamento feito FORA do sistema entra só com o PDF (sem lista de itens), o PDF
 * pode ser escolhido já no orçamento novo e a lista abre o PDF.
 *   tsx scripts/check-anexos-tryo.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const anexos = readFileSync('src/components/crm/AnexosCard.tsx', 'utf8')
ok(/\['dwg', 'dxf'\]\.includes\(ext\)\) return 'planta'/.test(anexos), 'DWG/DXF entra como planta')
ok(/input ref=\{inputRef\} type="file" multiple/.test(anexos), 'o card aceita vários arquivos de qualquer tipo (fotos, PDF, DWG)')

const form = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadeFormModal.tsx', 'utf8')
ok(/<AnexosCard ref=\{anexosRef\} companyId=\{companyId\} vinculoTipo="oportunidade" vinculoId=\{initial\?\.id \?\? null\} \/>/.test(form),
  'Nova oportunidade tem o card de anexos (em espera até o CRIAR) — #266')
ok(/anexosRef\.current\.confirmar\(novoId\)/.test(form), 'os anexos em espera são presos à oportunidade criada')
ok(/if \(!isEdit\) void anexosRef\.current\?\.limpar\(\)/.test(form) && (form.match(/onClick=\{fechar\}/g) ?? []).length === 2,
  'cancelar/fechar limpa os anexos em espera')

const orc = readFileSync('src/app/dashboard/orcamentos/page.tsx', 'utf8')
ok(/itensValidosCheck\.length===0&&!temPdf/.test(orc), 'orçamento com PDF não exige lista de itens — #264')
ok(/const temPdf = !!pdfNovo \|\| !!editing\?\.pdf_anexo_path;/.test(orc), 'vale o PDF escolhido agora ou o já anexado')
ok(/if\(!editing&&pdfNovo&&orcId\)[\s\S]{0,700}fn_orcamento_anexar_pdf/.test(orc), 'o PDF escolhido no orçamento novo sobe pela RPC oficial logo após criar')
ok(/data-testid="orc-pdf-novo-input"/.test(orc) && /data-testid="orc-lista-pdf"/.test(orc), 'PDF no orçamento novo e botão 📎 PDF na lista')

if (falhas > 0) { console.error(`\n[check-anexos-tryo] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-anexos-tryo] anexos da Tryo conferidos.')
