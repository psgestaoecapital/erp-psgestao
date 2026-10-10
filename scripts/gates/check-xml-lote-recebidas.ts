// Gate (GF4 · XML de compra em lote, caixa jordana-code d6441db4). Regras puras do envio em lote + a tela usa a MESMA
// função do envio de um arquivo, confirma só o aceite que a resposta pediu (nunca em massa) e tem o "?" (RD-95).
// Roda no build. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { MAX_ARQUIVOS_LOTE, aceitePedido, classificarUpload, resumoLote, tipoArquivo } from '../../src/lib/fiscal/xmlLote'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) tipo de arquivo
ok(tipoArquivo('NF 394.102.XML') === 'xml' && tipoArquivo('setembro.zip') === 'zip', '.xml e .zip aceitos (maiúscula também)')
ok(tipoArquivo('danfe.pdf') === 'outro' && tipoArquivo('nota.xml.pdf') === 'outro', 'PDF (DANFE) não é XML')

// 2) cada resposta da fn_nfe_recebida_upload_xml vira situação + texto que ensina
const criada = classificarUpload({ ok: true, criada: true, itens: 3, duplicatas: 1 })
ok(criada.situacao === 'aplicada' && /criada: 3 itens, 1 parcela/.test(criada.texto), `aplicada (${criada.texto})`)
const comp = classificarUpload({ ok: true, criada: false, itens: 1, duplicatas: 0 })
ok(comp.situacao === 'aplicada' && /completada: 1 item, 0 parcelas/.test(comp.texto), 'nota que já estava na lista é completada')

const sob = { ok: false, erro: 'requer_aceite', motivo: 'sobrescrever_sefaz', xml_atual_origem: 'sefaz' }
ok(classificarUpload(sob).situacao === 'confirmar' && aceitePedido(sob) === 'sobrescrever', 'XML da SEFAZ já existe → pede confirmação de troca')
const div = { ok: false, erro: 'requer_aceite', motivo: 'divergencia_valor', valor_xml: 1500, valor_resumo: 1450.5 }
const cDiv = classificarUpload(div)
ok(cDiv.situacao === 'confirmar' && aceitePedido(div) === 'divergencia' && /R\$ 1\.500,00/.test(cDiv.texto) && /R\$ 1\.450,50/.test(cDiv.texto),
  `valor divergente → confirmação com os dois valores (${cDiv.texto})`)
ok(aceitePedido({ ok: false, erro: 'requer_aceite', motivo: 'outro' }) === null, 'motivo desconhecido nunca vira aceite')
ok(aceitePedido({ ok: true }) === null && aceitePedido({ ok: false, erro: 'xml_invalido' }) === null, 'sucesso/erro final não pedem aceite')

const outro = classificarUpload({ ok: false, erro: 'cnpj_destinatario_diverge', cnpj_no_xml: '11222333000181', cnpj_empresa: '55500000000142' })
ok(outro.situacao === 'recusada' && /11\.222\.333\/0001-81/.test(outro.texto) && /55\.500\.000\/0001-42/.test(outro.texto),
  'nota de outro CNPJ é recusada mostrando os dois CNPJs')
for (const erro of ['chave_invalida', 'xml_invalido', 'empresa_sem_cnpj', 'sem_acesso', 'aplicar_xml_falhou', 'tipo_arquivo']) {
  const c = classificarUpload({ ok: false, erro })
  ok(c.situacao === 'recusada' && c.texto !== erro && c.texto.length > 20, `${erro} → recusada com texto em linguagem do usuário`)
}

// 3) resumo do lote
const r = resumoLote(['aplicada', 'aplicada', 'confirmar', 'recusada', 'pendente', 'enviando'])
ok(r.total === 6 && r.aplicada === 2 && r.confirmar === 1 && r.recusada === 1 && r.pendente === 2, 'resumo conta cada situação')
ok(MAX_ARQUIVOS_LOTE >= 50 && MAX_ARQUIVOS_LOTE <= 500, `teto por envio razoável (${MAX_ARQUIVOS_LOTE})`)

// 4) a tela
const comp2 = readFileSync('src/components/fiscal/UploadXmlLoteRecebidas.tsx', 'utf8')
ok(/rpc\('fn_nfe_recebida_upload_xml'/.test(comp2), 'o lote usa a MESMA fn_nfe_recebida_upload_xml (mesmas travas)')
ok(/\bmultiple\b/.test(comp2) && /\.zip/.test(comp2) && /jszip/.test(comp2), 'aceita vários arquivos e .zip')
ok(/for \(let i = 0; i < lidas\.length; i\+\+\) await processar/.test(comp2), 'envia um por vez (um recusado não para o lote)')
ok(!/p_aceite_sobrescrever:\s*true/.test(comp2) && !/p_aceite_divergencia:\s*true/.test(comp2), 'nenhum aceite é ligado em massa')
ok(/\[l\.pedido\]: true/.test(comp2), 'Confirmar liga só o aceite que a resposta da linha pediu')
ok(/<AjudaCampo chave="compras\.docs_recebidos\.xml_lote"/.test(comp2), 'o botão tem o "?" (RD-95)')
const tela = readFileSync('src/app/dashboard/compras/documentos-recebidos/page.tsx', 'utf8')
ok(/<UploadXmlLoteRecebidas companyId=\{empresaUnica\}/.test(tela), 'Documentos Recebidos mostra o envio em lote')

// 5) as chaves do "?" estão numa migration
const mig = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const k of ['xml_lote', 'auto_ciencia', 'busca', 'filtro_status']) {
  ok(mig.includes(`'compras.docs_recebidos.${k}'`), `chave compras.docs_recebidos.${k} cadastrada em erp_ajuda_campo`)
}

if (falhas) { console.error(`\n${falhas} falha(s) no gate do XML em lote`); process.exit(1) }
console.log('✓ XML de compra em lote: ok')
