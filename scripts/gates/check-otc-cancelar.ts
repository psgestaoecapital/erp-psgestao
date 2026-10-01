// Gate (#728 R.R · CEO aprovou 01/10): cancelar orçamento e pedido em Vender e Faturar. As travas moram no banco
// (uma regra, qualquer tela); a tela só abre a janela com motivo obrigatório. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261002090000_otc_cancelar_pedido_orcamento.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')
const ped = sql.slice(sql.indexOf('FUNCTION public.fn_pedido_cancelar'), sql.indexOf('FUNCTION public.fn_orcamento_cancelar'))
const orc = sql.slice(sql.indexOf('FUNCTION public.fn_orcamento_cancelar'))

ok(/PERFORM public\.fn__guarda_empresa\(v_ped\.company_id\)/.test(ped) && /PERFORM public\.fn__guarda_empresa\(v_orc\.company_id\)/.test(orc), 'guarda de empresa nas duas funções')
ok(ped.includes('fn__otc_motivo_cancelamento') && orc.includes('fn__otc_motivo_cancelamento'), 'motivo obrigatório (lista da empresa ou texto) nas duas')
ok(sql.includes("length(v_txt) < 5"), 'texto livre exige um motivo de verdade (5+ caracteres)')
const iFat = ped.indexOf("v_ped.status IN ('faturado', 'faturamento_parcial')")
const iNota = ped.indexOf('erp_nfse_emitidas')
const iPago = ped.indexOf("status IN ('pago', 'parcial')")
const iBol = ped.indexOf("boleto_status = 'registrado'")
const iUpd = ped.indexOf("SET status = 'cancelado', motivo_perda_id")
ok(iFat > 0 && iFat < iUpd, 'pedido faturado é recusado antes de mexer em qualquer coisa (sem estorno de estoque)')
ok(iNota > 0 && iNota < iUpd && ped.includes('erp_nfe_emitidas'), 'nota fiscal (NFS-e/NF-e) emitida é recusada antes')
ok(iPago > 0 && iPago < iUpd, 'parcela já recebida é recusada antes (devolução/estorno)')
ok(iBol > 0 && iBol < iUpd, 'boleto registrado no banco é recusado antes')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30)')
ok(/INSERT INTO erp_pedido_historico/.test(ped) && /INSERT INTO erp_orcamento_historico/.test(orc), 'histórico com quem/quando/por quê')
ok(orc.includes("v_orc.status IN ('convertido', 'venda_avulsa')") && orc.includes('Cancele o pedido'), 'orçamento convertido manda cancelar o pedido')
for (const fn of ['fn_pedido_cancelar(uuid, uuid, text)', 'fn_orcamento_cancelar(uuid, uuid, text)']) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`) && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated, service_role;`), `${fn}: só usuário logado (com guarda)`)
}

const modal = readFileSync('src/components/comum/CancelarVendaModal.tsx', 'utf8')
ok(modal.includes("tipo === 'pedido' ? 'fn_pedido_cancelar' : 'fn_orcamento_cancelar'"), 'a janela chama as funções do banco (as travas são de lá)')
ok(modal.includes('textoOk = texto.trim().length >= 5') && modal.includes('disabled={!podeConfirmar}'), 'sem motivo o botão fica travado')
ok(modal.includes('setErro(error.message)') && modal.includes('data-testid="cancelar-venda-erro"'), 'a recusa do banco aparece na tela como está')
const pagina = readFileSync('src/app/dashboard/commerce/otc/page.tsx', 'utf8')
ok(pagina.includes('data-testid="pedido-cancelar"') && pagina.includes('data-testid="orcamento-cancelar"'), 'botões "Cancelar pedido" e "Cancelar orçamento" na tela')

if (falhas) { console.error(`\ncheck-otc-cancelar: ${falhas} falha(s)`); process.exit(1) }
console.log('\nVender e Faturar · cancelar orçamento/pedido: ok')
