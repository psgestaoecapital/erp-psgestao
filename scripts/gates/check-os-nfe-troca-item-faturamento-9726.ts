// Gate (#9726 etapa final): "Trocar item de faturamento" na NF-e de peças, ISOLADO por
// erp_oficina_parametros.modo_baixa_estoque='baixar_estoque'. Item '99 - Outras' não pode ser faturado;
// a troca não altera o item da OS/estoque. Validação no servidor (não só no front). Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// --- migration (por sufixo; a fila pode renumerar o prefixo) ---
const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_os_nfe_troca_item_faturamento_9726.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_os_nfe_troca_item_faturamento_9726.sql não encontrada'); process.exit(1) }
const sql = readFileSync(`${dir}/${arq}`, 'utf8')
const flat = sql.replace(/\s+/g, ' ')
ok(sql.includes('CREATE TABLE IF NOT EXISTS public.erp_os_nfe_item_faturamento'), 'tabela de vínculo da troca (aditiva, IF NOT EXISTS)')
ok(flat.includes('UNIQUE (os_id, item_os_id)'), 'um vínculo por item da OS (idempotente)')
ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_os_nfe_item_faturamento_definir'), 'RPC define/limpa a troca')
ok(flat.includes("COALESCE(v_modo, 'faturamento') <> 'baixar_estoque'"), 'RPC só no modo baixar_estoque')
ok(flat.includes("COALESCE(v_pf.tipo_item_sped, '') <> '00'"), 'RPC exige produto de faturamento tipo 00')
ok(/v_pf\.ncm[^;]*\^\[0-9\]\{8\}\$/.test(flat) || flat.includes("'^[0-9]{8}$'"), 'RPC exige NCM de 8 dígitos')
ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_os_nfe_preparar'), 'preparar reescrita')
ok(flat.includes("v_troca := COALESCE(v_modo, 'faturamento') = 'baixar_estoque'"), 'preparar só troca/bloqueia no modo baixar_estoque')
ok(flat.includes("(v_troca AND COALESCE(pf.tipo_item_sped,'') = '99') AS faturamento_bloqueado"), "preparar marca '99' como bloqueado só nesse modo")
ok(flat.includes("'produto_origem_id'") && flat.includes("'produto_faturamento_id'") && flat.includes("'faturado_como'"), 'preparar expõe origem/faturamento/faturado_como')
ok(flat.includes("'permite_troca', v_troca"), 'preparar devolve permite_troca')
ok(sql.includes("'oficina.os.nfe_trocar_item_faturamento'"), 'RD-95: chave de ajuda da troca inserida (idempotente)')
ok(/INSERT INTO public\.erp_ajuda_campo[\s\S]*WHERE NOT EXISTS/.test(sql), 'ajuda inserida de forma idempotente')

// --- rota de emissão: guard '99' no servidor ---
const rota = readFileSync('src/app/api/fiscal/nfe/emitir/route.ts', 'utf8')
const rflat = rota.replace(/\s+/g, ' ')
ok(rflat.includes("modo_baixa_estoque") && rflat.includes("'baixar_estoque'"), 'rota confere o modo baixar_estoque')
ok(rflat.includes("tipo_item_sped") && rflat.includes("=== '99'"), "rota rejeita item de faturamento '99' no servidor")
ok(rflat.includes('Item 99 - Outras não pode ser faturado'), 'rota devolve mensagem de troca do item')

// --- tela ---
const tela = readFileSync('src/components/comum/EmitirNFeOSButton.tsx', 'utf8')
ok(tela.includes('fn_os_nfe_item_faturamento_definir'), 'tela chama a RPC de troca')
ok(tela.includes('permiteTroca') && tela.includes('prep?.permite_troca'), 'tela só mostra a troca no modo baixar_estoque')
ok(tela.includes('bloqueioSelecionado') && tela.includes('!bloqueioSelecionado'), 'tela bloqueia Emitir com item 99 selecionado')
ok(tela.includes('chave="oficina.os.nfe_trocar_item_faturamento"'), 'RD-95: campo de busca da troca tem "?"')
ok(tela.includes('faturado como'), 'tela mostra "usado X · faturado como Y"')
ok(tela.includes("tipo_item_sped', '00'") || tela.includes("eq('tipo_item_sped', '00')"), 'busca restrita a produtos tipo 00')

if (falhas) process.exit(1)
console.log('check-os-nfe-troca-item-faturamento-9726 OK')
