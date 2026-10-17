/**
 * Gate (#1677 B2): solicitação de compra — regras puras (orçamentos da alçada, urgência só nas categorias liberadas,
 * validação do formulário, pasta do arquivo = empresa), tela só pelas RPCs com guarda, "?" com chave cadastrada (RD-95),
 * menu/inventário, e no SQL: RLS nas tabelas novas, REVOKE anon, guarda de empresa e "quem pede não aprova".
 */
import { readdirSync, readFileSync } from 'node:fs'
import { caminhoOrcamento, lerQuantidade, pendenciasEnvio, validarSolicitacaoForm, ITEM_VAZIO } from '../../src/lib/compras/solicitacao'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const alc = { configurada: true, aprovador_principal_id: 'u1', min_orcamentos: 3 as const, urgencia_categorias: ['Lubrificantés'], urgencia_produto_ids: ['p9'] }
ok(pendenciasEnvio({ urgente: false, itens: [{ categoria: 'Peças' }], orcamentos: 2 }, alc).some((p) => /faltam 1/.test(p)), 'sem os 3 orçamentos: falta 1')
ok(pendenciasEnvio({ urgente: false, itens: [{ categoria: 'Peças' }], orcamentos: 3 }, alc).length === 0, 'com 3 orçamentos pode enviar')
ok(pendenciasEnvio({ urgente: false, itens: [{}], orcamentos: 1 }, { ...alc, min_orcamentos: 1 }).length === 0, 'alçada de 1 orçamento aceita 1')
ok(pendenciasEnvio({ urgente: true, itens: [{ categoria: 'lubrificantes' }, { produto_id: 'p9' }], orcamentos: 0 }, alc).length === 0, 'urgente nas categorias/produtos liberados dispensa orçamento (sem acento/caixa)')
ok(pendenciasEnvio({ urgente: true, itens: [{ categoria: 'lubrificantes' }, { categoria: 'Pneus' }], orcamentos: 0 }, alc).length === 1, 'urgente com 1 item fora da lista não envia')
ok(pendenciasEnvio({ urgente: false, itens: [{}], orcamentos: 3 }, { ...alc, configurada: false }).some((p) => /aprovador/.test(p)), 'sem alçada configurada não envia')
ok(pendenciasEnvio({ urgente: false, itens: [], orcamentos: 3 }, alc).some((p) => /item/.test(p)), 'sem item não envia')

ok(validarSolicitacaoForm({ titulo: 'ab', itens: [{ ...ITEM_VAZIO, descricao: 'x' }] }) !== null, 'título curto não salva')
ok(validarSolicitacaoForm({ titulo: 'Pastilhas', itens: [{ ...ITEM_VAZIO, descricao: 'x', quantidade: '0' }] }) !== null, 'quantidade 0 não salva')
ok(validarSolicitacaoForm({ titulo: 'Pastilhas', itens: [{ ...ITEM_VAZIO, descricao: 'x', quantidade: '1,5' }] }) === null, 'quantidade com vírgula salva')
ok(lerQuantidade('1,5') === 1.5 && lerQuantidade('1.234,5') === 1234.5 && lerQuantidade('2.5') === 2.5 && Number.isNaN(lerQuantidade('')), 'quantidade/valor no formato brasileiro')
const cam = caminhoOrcamento('emp-1', 'sol-1', 'Orçamento Peças (1).pdf', 1)
ok(cam.split('/')[0] === 'emp-1' && !/[ ()ç]/.test(cam), `arquivo na pasta da empresa, nome limpo (${cam})`)

const tela = readFileSync('src/app/dashboard/compras/solicitacoes/page.tsx', 'utf8')
// acha a migration pelo nome (a fila de merge pode renumerar a versão)
const migArq = readdirSync('supabase/migrations').find((f) => f.endsWith('_compras_solicitacao.sql'))
const mig = migArq ? readFileSync(`supabase/migrations/${migArq}`, 'utf8') : ''
ok(!!migArq, 'migration da solicitação de compra existe')
for (const fn of ['listar', 'salvar', 'orcamento_adicionar', 'orcamento_remover', 'enviar', 'decidir', 'cancelar'])
  ok(tela.includes(`'fn_compras_solicitacao_${fn}'`) && mig.includes(`FUNCTION public.fn_compras_solicitacao_${fn}(`), `tela usa e migration cria fn_compras_solicitacao_${fn}`)
ok(!/from\('erp_compras_solicitacao[a-z_]*'\)\s*\.\s*(insert|update|upsert|delete)/.test(tela), 'tela não escreve direto nas tabelas')
ok(/storage\.from\(BUCKET\)\.upload\(path/.test(tela) && /caminhoOrcamento\(empresa/.test(tela), 'upload no bucket privado, pasta da empresa')
const chaves = [...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 20, `tela tem "?" nos campos, filtro e ações (${chaves.length})`)
for (const c of new Set(chaves)) ok(mig.includes(`'${c}'`), `chave de ajuda cadastrada: ${c}`)

const semCom = mig.replace(/--[^\n]*/g, '')
for (const t of ['erp_compras_solicitacao', 'erp_compras_solicitacao_item', 'erp_compras_solicitacao_orcamento'])
  ok(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(semCom), `RLS ligada em ${t}`)
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.erp_compras_solicitacao,/.test(semCom), 'escrita direta revogada do authenticated')
ok(/'compras-orcamentos', 'compras-orcamentos', false/.test(semCom), 'bucket dos orçamentos é privado')
const fns = [...semCom.matchAll(/CREATE OR REPLACE FUNCTION public\.(fn_compras_solicitacao_[a-z_]+)\(/g)].map((m) => m[1])
for (const f of fns) ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM anon`).test(semCom), `anon sem acesso a ${f}`)
const corpo = (f: string) => semCom.slice(semCom.indexOf(`FUNCTION public.${f}(`), semCom.indexOf('END $$', semCom.indexOf(`FUNCTION public.${f}(`)))
for (const f of ['fn_compras_solicitacao_salvar', 'fn_compras_solicitacao_orcamento_adicionar', 'fn_compras_solicitacao_orcamento_remover', 'fn_compras_solicitacao_enviar', 'fn_compras_solicitacao_decidir', 'fn_compras_solicitacao_cancelar'])
  ok(/fn__guarda_empresa\(/.test(corpo(f)), `guarda de empresa em ${f}`)
ok(/s\.solicitante = auth\.uid\(\) THEN RETURN[^;]*não aprova a própria/.test(corpo('fn_compras_solicitacao_decidir')), 'quem pede não aprova a própria compra')
ok(/NOT p_aprovar AND v_motivo IS NULL/.test(corpo('fn_compras_solicitacao_decidir')), 'recusa exige motivo')
ok(/v_orc < c\.min_orcamentos/.test(corpo('fn_compras_solicitacao_enviar')), 'envio confere os orçamentos da alçada')
ok(/INSERT INTO public\.module_catalog[\s\S]*'\/dashboard\/compras\/solicitacoes'/.test(mig), 'tela entra no menu (module_catalog)')
ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/compras\/solicitacoes'/.test(mig), 'tela no inventário (system_screens)')
ok(!/\b(DROP TABLE|DROP FUNCTION|DELETE FROM public\.(?!erp_compras_solicitacao))/i.test(semCom), 'migration aditiva (sem DROP de tabela/função nem DELETE em tabela existente)')

if (falhas) { console.error(`\n[check-compras-solicitacao] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-solicitacao] solicitação de compra conferida.')
