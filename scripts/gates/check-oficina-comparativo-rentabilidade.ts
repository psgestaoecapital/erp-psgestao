// Gate — Tela "Comparativo da OS" (rentabilidade, módulo oficina). Estático, sem rede.
// Garante: migration cria as RPCs de leitura + a tabela de tempo manual + colunas de imposto; não escreve em dado de
// cliente (só na tabela nova e nos parâmetros); registra a tela no menu + system_screens + ajuda RD-95; e a tela
// chama as RPCs e tem "?" (AjudaCampo). Dado sensível fechado ao anon e por fn_oficina_pode_ver_custo.
import { readFileSync, readdirSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// -------- migration --------
const dir = 'supabase/migrations'
const nome = readdirSync(dir).find((n) => n.endsWith('_oficina_comparativo_rentabilidade.sql'))
ok(!!nome, 'migration do comparativo presente')
const mig = nome ? readFileSync(`${dir}/${nome}`, 'utf8') : ''
const semComent = mig.replace(/--.*$/gm, '')

for (const fn of ['fn_oficina_pode_ver_custo', 'fn__oficina_comparativo_calc', 'fn_oficina_comparativo_os',
  'fn_oficina_comparativo_geral', 'fn_oficina_comparativo_params_get', 'fn_oficina_comparativo_params_salvar',
  'fn_os_mao_obra_manual_salvar', 'fn_os_mao_obra_manual_excluir']) {
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`).test(mig), `migration cria ${fn}`)
}
ok(/ADD COLUMN IF NOT EXISTS imposto_produtos_pct/.test(mig) && /imposto_servicos_pct/.test(mig) && /reserva_taxa_cartao_pct/.test(mig),
  'colunas de imposto (produtos/serviços) e reserva de taxa de cartão (aditivas)')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_os_mao_obra_manual/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_os_mao_obra_manual FROM anon/.test(mig),
  'tabela de tempo manual com RLS e fechada ao anon')
// cálculo da sobra líquida = diferença − tributos − taxa de cartão
ok(/sobra_liq/.test(mig) && /venda_liq[\s\S]*compra_total[\s\S]*taxa_real[\s\S]*taxa_estimada/.test(mig),
  'migration calcula a sobra líquida (diferença − tributos − taxa de cartão)')
ok(/busca_norm|fn_oficina_pode_ver_custo\(p_company_id\)/.test(mig) && /tenant_user_roles[\s\S]*CLIENT_OWNER[\s\S]*CLIENT_MANAGER/.test(mig),
  'dado sensível só para CLIENT_OWNER/CLIENT_MANAGER (+PS_ADMIN)')
ok(/REVOKE ALL ON FUNCTION public\.fn_oficina_comparativo_os/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_oficina_comparativo_geral/.test(mig),
  'RPCs de leitura fechadas ao anon')
// NÃO escreve em dado de cliente (só tabela nova de MO e parâmetros)
ok(!/INSERT INTO (public\.)?erp_os\b|UPDATE (public\.)?erp_os\b|DELETE FROM (public\.)?erp_os\b/.test(semComent), 'não escreve em erp_os')
ok(!/INSERT INTO (public\.)?erp_receber|UPDATE (public\.)?erp_receber|DELETE FROM (public\.)?erp_receber/.test(semComent), 'não escreve em erp_receber')
ok(!/UPDATE (public\.)?erp_os_diagnostico_item|DELETE FROM (public\.)?erp_os_diagnostico_item|UPDATE (public\.)?erp_estoque_movimentacoes/.test(semComent), 'não escreve em itens da OS nem em estoque')
// não toca a função de snapshot existente
ok(!/fn_os_snapshot_custo_lucro/.test(semComent), 'não altera fn_os_snapshot_custo_lucro')
// registro no menu + system_screens + ajuda
ok(/INSERT INTO public\.module_catalog[\s\S]*'oficina_comparativo'[\s\S]*'\/dashboard\/oficina\/comparativo'/.test(mig), 'registra a tela no menu (module_catalog)')
ok(/INSERT INTO public\.system_screens[\s\S]*'oficina_comparativo'/.test(mig), 'registra a tela em system_screens')
ok(/INSERT INTO public\.erp_ajuda_campo[\s\S]*oficina\.comparativo\./.test(mig) && /'publicado'/.test(mig), 'seed de ajuda RD-95 (publicado)')

// -------- tela --------
const telaPath = 'src/app/dashboard/oficina/comparativo/page.tsx'
ok(existsSync(telaPath), 'tela /dashboard/oficina/comparativo existe')
const tela = existsSync(telaPath) ? readFileSync(telaPath, 'utf8') : ''
ok(/fn_oficina_comparativo_geral/.test(tela) && /fn_oficina_comparativo_os/.test(tela), 'tela chama as RPCs de leitura')
ok(/fn_oficina_comparativo_params_salvar/.test(tela) && /fn_os_mao_obra_manual_salvar/.test(tela) && /fn_os_mao_obra_manual_excluir/.test(tela), 'tela tem parâmetros e tempo manual (RD-98)')
ok(/AjudaCampo/.test(tela) && /oficina\.comparativo\./.test(tela), 'tela usa AjudaCampo (RD-95)')
ok(/exportarExcel/.test(tela), 'tela exporta a análise')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
console.log('check-oficina-comparativo-rentabilidade OK')
