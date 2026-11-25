// Gate (#9726 · núcleo de estoque): a baixa de estoque da OS passa a ler os ITENS REAIS da OS
// (erp_os_diagnostico_item.produto_id, aprovado) e não só as peças de NF, sem baixa dupla, sem fingir
// baixa, e sem travar faturamento/botão por saldo. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_os_baixa_estoque_itens_reais_9726.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_os_baixa_estoque_itens_reais_9726.sql não encontrada'); process.exit(1) }
const sql = readFileSync(`${dir}/${arq}`, 'utf8')
const flat = sql.replace(/\s+/g, ' ')  // normaliza espaços p/ casar independentemente da formatação

// assinatura mantida (RETURNS integer) — 3 chamadores dependem do inteiro
ok(/CREATE OR REPLACE FUNCTION public\.fn_os_estoque_baixar_interno\(p_os_id uuid\)\s*\n\s*RETURNS integer/.test(sql), 'interno mantém RETURNS integer (não quebra chamadores)')
// fonte canônica: itens reais da OS (diagnóstico) aprovados, produto físico
ok(sql.includes('FROM erp_os_diagnostico_item di'), 'lê os itens reais da OS (diagnóstico)')
ok(sql.includes('di.aprovado IS TRUE'), 'só itens aprovados (faturados)')
ok(/COALESCE\(p\.tipo,\s*'produto'\)\s*<>\s*'servico'/.test(sql), 'só produto físico (controla estoque)')
ok(sql.includes('di.estoque_saida_mov_id IS NULL'), 'idempotência por item (estoque_saida_mov_id)')
ok(sql.includes('UPDATE erp_os_diagnostico_item SET estoque_saida_mov_id'), 'grava o vínculo item→movimentação')
// dedup com a origem NF de compra
ok(sql.includes('FROM erp_nfe_recebidas_itens ni'), 'mantém a origem NF de compra')
ok(flat.includes('NOT EXISTS ( SELECT 1 FROM erp_os_diagnostico_item di WHERE di.os_id = p_os_id AND di.produto_id = ni.produto_id'), 'NF só baixa produto SEM item de diagnóstico (evita baixa dupla)')
ok(flat.includes("NOT EXISTS ( SELECT 1 FROM erp_estoque_movimentacoes mv WHERE mv.ref_tipo = 'os'"), 'NF não re-baixa produto com saída já registrada')
// não travar faturamento/botão por saldo: captura por item
ok((flat.match(/EXCEPTION WHEN OTHERS THEN v_falhas := v_falhas \+ 1/g) || []).length >= 2, 'saldo/erro capturado por item (não aborta a OS inteira)')
// nunca fingir baixa: marca baixado só com item de estoque e zero falhas
ok(flat.includes('IF v_tem_estoque AND v_falhas = 0 THEN'), 'marca baixado só com item de estoque e nenhuma falha')
// movimentação: tipo saída, ref os, motivo por modo
ok(sql.includes("'Baixa de estoque da OS'") && sql.includes("'Consumo em OS faturada'"), 'motivo conforme o modo (botão x faturamento)')
ok(sql.includes("p_ref_tipo := 'os'") || sql.includes("'saida',r.qtd"), 'saída referenciando a OS')
// wrapper: conta baixados e avisa pendentes/zero
ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_os_baixar_estoque'), 'wrapper do botão atualizado')
ok(sql.includes("'itens_pendentes'") && sql.includes("'aviso'"), 'wrapper informa pendentes e aviso')
// reconciliação read-only
ok(sql.includes('CREATE OR REPLACE VIEW public.v_os_estoque_reconciliacao'), 'view de reconciliação (read-only)')
ok(sql.includes('security_invoker=true') || sql.includes('security_invoker = true'), 'view respeita RLS do usuário (security_invoker)')
ok(/REVOKE ALL ON public\.v_os_estoque_reconciliacao FROM anon/.test(sql), 'reconciliação: REVOKE anon')
// não cria migração que corrige saldo retroativo (read-only neste PR)
ok(!/UPDATE erp_produtos SET estoque_atual/.test(sql), 'não corrige saldo retroativo neste PR')

if (falhas) process.exit(1)
console.log('check-os-baixa-estoque-itens-reais OK')
