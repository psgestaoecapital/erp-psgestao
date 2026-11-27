// Gate (chamado #11065): Edição fiscal em massa e Padrão fiscal por NCM em LOTES — nunca mais "statement timeout".
// Estático, sem rede nem banco. Confere (1) a migration: motor em comandos de conjunto (sem temp table nem subquery
// correlacionada por produto), prévia só em agregados, fila com cursor/retomada/cancelamento, uma aplicação por empresa,
// tratamento de timeout por lote, ACL; (2) o condutor de lotes (puro) contra um banco simulado: avança, retoma, trata
// falha e "ocupado", para quando pedido; (3) as telas: usam o fluxo em lotes, sem ler 10 mil produtos, com "?" em todo
// campo e a chave de ajuda existente na migration.
import { readFileSync } from 'node:fs'
import { conduzirLote, emAndamento, mensagemDoErro, textoAndamento, type LoteFiscal, type RespostaPasso } from '../../src/lib/produtos/fiscalMassaLotes'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261125160030_fiscal_massa_em_lotes_11065.sql', 'utf8')
const corpo = (nome: string): string => {
  const i = mig.indexOf(`FUNCTION public.${nome}(`)
  if (i < 0) return ''
  const fim = mig.indexOf('$function$;', mig.indexOf('AS $function$', i) + 10)
  return mig.slice(i, fim)
}

// ---- 1 · migration ----
const massa = corpo('fn_produtos_fiscal_massa')
const motor = corpo('fn__pfm_processar')
const passo = corpo('fn__pfm_job_passo')
ok(!/CREATE TEMP/i.test(mig.replace(/--.*$/gm, '')), 'sem tabela temporária (era a materialização que estourava o tempo)')
ok(!/SELECT m\.depois FROM/.test(mig.replace(/--.*$/gm, '')), 'sem subquery correlacionada por produto/campo (custo quadrático)')
ok(/UPDATE public\.erp_produtos p SET[\s\S]*FROM novo n[\s\S]*WHERE p\.id = n\.produto_id/.test(motor), 'UPDATE por join com o conjunto de mudanças')
ok(/INSERT INTO public\.erp_produto_fiscal_alteracao/.test(motor) && /valor_antes, valor_depois/.test(motor), 'antes/depois de cada campo continua em erp_produto_fiscal_alteracao')
ok(/p_gravar/.test(motor) && /jsonb_agg\(y\.o\)/.test(motor) && /LIMIT 20/.test(motor), 'prévia só agrega e devolve amostra de 20 (não materializa linhas)')
ok(/v_sync_max constant int := 500/.test(massa) && /use_lote_assincrono/.test(massa), 'aplicação direta só até 500 produtos; acima, devolve use_lote_assincrono')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_produto_fiscal_job/.test(mig) && /cursor_id uuid/.test(mig) && /lote_id uuid NOT NULL REFERENCES public\.erp_produto_fiscal_lote/.test(mig), 'fila de lotes com cursor e vínculo ao lote de auditoria')
ok(/CREATE UNIQUE INDEX IF NOT EXISTS ux_produto_fiscal_job_ativo_empresa[\s\S]*WHERE status IN \('pendente','processando'\)/.test(mig), 'uma aplicação em lotes por empresa por vez (índice único parcial)')
ok(/query_canceled/.test(passo) && /greatest\(25, tamanho_lote \/ 2\)/.test(passo) && /tentativas \+ 1 >= 5/.test(passo), 'timeout/erro de um lote: só ele desfaz, lote encolhe pela metade, para após 5 falhas')
ok(/FOR UPDATE SKIP LOCKED/.test(passo), 'passo trava a fila (navegador e agendador não processam o mesmo lote juntos)')
ok(/cron\.schedule\('produtos-fiscal-job-retomar'/.test(mig) && /fn_produtos_fiscal_job_retomar/.test(mig), 'agendador termina sozinho a aplicação largada')
ok(/padrao_ncm/.test(corpo('fn__pfm_alvo_ids')) && /length\(q\.ncm\) > length\(v_padrao\)/.test(corpo('fn__pfm_alvo_ids')), 'filtro do Padrão fiscal por NCM respeita o padrão mais específico')
ok(/ORDER BY p\.id[\s\S]*LIMIT p_limite/.test(corpo('fn__pfm_alvo_ids')) && /p\.id > p_depois_id/.test(corpo('fn__pfm_alvo_ids')), 'varredura por cursor (keyset) em ordem de id')
ok(/fn_produtos_fiscal_filtros/.test(mig), 'opções de NCM/grupo numa agregação (a tela não lê 10 mil produtos)')

const publicas = ['fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean, text)', 'fn_produtos_fiscal_job_criar(uuid, jsonb, jsonb, boolean, text)',
  'fn_produtos_fiscal_job_processar(uuid, boolean)', 'fn_produtos_fiscal_job_obter(uuid, uuid)', 'fn_produtos_fiscal_job_cancelar(uuid)',
  'fn_produtos_fiscal_massa_historico(uuid)', 'fn_produtos_fiscal_filtros(uuid)']
for (const f of publicas) ok(mig.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon;`) && mig.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated, service_role;`), `${f.split('(')[0]}: fechada ao anon, aberta a logados`)
const internas = ['fn__pfm_alvo_ids(uuid, jsonb, uuid, int)', 'fn__pfm_validar(uuid, jsonb, jsonb)', 'fn__pfm_processar(uuid, uuid[], jsonb, boolean, text, uuid, boolean)', 'fn__pfm_job_passo(uuid)', 'fn_produtos_fiscal_job_retomar()']
for (const f of internas) ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.replace(/[()[\]]/g, '\\$&')} FROM PUBLIC, anon, authenticated;`).test(mig), `${f.split('(')[0]}: interna, só service_role`)
for (const f of ['fn_produtos_fiscal_massa', 'fn_produtos_fiscal_job_criar', 'fn_produtos_fiscal_job_processar', 'fn_produtos_fiscal_job_cancelar', 'fn_produtos_fiscal_filtros']) {
  ok(/fn__guarda_empresa/.test(corpo(f)), `${f}: guarda de empresa`)
}
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE INSERT, UPDATE, DELETE ON public\.erp_produto_fiscal_job FROM authenticated/.test(mig), 'fila com RLS e sem escrita direta')
ok(!/DELETE FROM public\.erp_produtos|TRUNCATE|DROP TABLE/.test(mig.replace(/--.*$/gm, '')), 'migration aditiva: não apaga produto nem tabela')

// ---- 2 · condutor de lotes (banco simulado) ----
const novo = (p: Partial<LoteFiscal>): LoteFiscal => ({ id: 'j', lote_id: 'l', status: 'processando', total_alvo: 12125, total_mudam: 12125, processados: 0, produtos_alterados: 0,
  campos_alterados: 0, percentual: 0, tamanho_lote: 500, tentativas: 0, erro: null, ultimo_passo_ms: 40, criado_em: '', atualizado_em: '', ...p })

async function simula() {
  // 12.125 produtos em passos de 500: 25 passos + o que fecha
  let proc = 0
  const vistos: number[] = []
  const banco = async (): Promise<RespostaPasso> => {
    proc = Math.min(12125, proc + 500)
    const fim = proc >= 12125
    return { ok: true, job: novo({ processados: proc, produtos_alterados: proc, percentual: Math.floor(100 * proc / 12125), status: fim ? 'concluido' : 'processando' }) }
  }
  const r = await conduzirLote('j', banco, { aoProgredir: (j) => vistos.push(j.percentual), dormir: async () => undefined })
  ok(r.motivo === 'terminou' && r.job?.status === 'concluido' && r.job.processados === 12125, '12.125 produtos: conduz até concluir')
  ok(vistos.length === 25 && vistos.every((v, i) => i === 0 || v >= vistos[i - 1]), 'progresso visível e crescente a cada lote (25 passos)')

  // parada pedida (cancelar/fechar): não chama o banco de novo
  let chamadas = 0
  const r2 = await conduzirLote('j', async () => { chamadas++; return { ok: true, job: novo({ processados: chamadas * 500 }) } }, { aoProgredir: () => undefined, deveParar: () => chamadas >= 3 })
  ok(r2.motivo === 'parado' && chamadas === 3, 'cancelar/fechar para entre lotes')

  // falha de um lote não perde o que já foi: o servidor devolve o estado com erro e o condutor mostra, sem laço infinito
  const r3 = await conduzirLote('j', async () => ({ ok: false, job: novo({ status: 'erro', erro: 'tempo esgotado num lote de 500 produtos', processados: 1000 }) }), { aoProgredir: () => undefined })
  ok(r3.motivo === 'erro' && r3.job?.status === 'erro', 'parada por erro volta ao usuário (com "Continuar"), sem laço')
  ok(textoAndamento(novo({ status: 'erro', erro: 'x', processados: 1000 })).includes('Continuar'), 'mensagem de erro orienta a continuar')

  // retomada: a primeira chamada leva p_retentar
  const flags: boolean[] = []
  await conduzirLote('j', async (_id, ret) => { flags.push(ret); return { ok: true, job: novo({ status: 'concluido', processados: 12125, percentual: 100 }) } }, { aoProgredir: () => undefined }, true)
  ok(flags.length === 1 && flags[0] === true, 'retomar uma aplicação parada manda p_retentar na primeira chamada')

  // ocupado (agendador do servidor está no lote): espera e segue, sem martelar
  let n = 0; const esperas: number[] = []
  await conduzirLote('j', async () => (++n < 3 ? { ok: true, ocupado: true } : { ok: true, job: novo({ status: 'concluido', percentual: 100 }) }),
    { aoProgredir: () => undefined, dormir: async (ms) => { esperas.push(ms) } })
  ok(esperas.length === 2 && esperas.every((e) => e > 0), 'lote ocupado pelo servidor: espera entre tentativas')

  // limite de passos: nunca laço infinito
  const r4 = await conduzirLote('j', async () => ({ ok: true, job: novo({}) }), { aoProgredir: () => undefined, maxPassos: 5 })
  ok(r4.motivo === 'limite', 'limite de passos protege contra laço infinito')
}

ok(emAndamento(novo({ status: 'pendente' })) && emAndamento(novo({ status: 'processando' })) && !emAndamento(novo({ status: 'concluido' })) && !emAndamento(null), 'emAndamento: só pendente/processando')
ok(!/statement timeout/i.test(mensagemDoErro(new Error('canceling statement due to statement timeout'))), 'erro cru de timeout vira texto de usuário')

// ---- 3 · telas ----
const modal = readFileSync('src/components/cadastros/EdicaoFiscalMassaModal.tsx', 'utf8')
const padrao = readFileSync('src/components/cadastros/PadraoFiscalNcmModal.tsx', 'utf8')
const hook = readFileSync('src/components/cadastros/useLoteFiscal.ts', 'utf8')
ok(!/from\('erp_produtos'\)\.select\('ncm, grupo'\)/.test(modal) && /fn_produtos_fiscal_filtros/.test(modal), 'edição em massa não lê 10 mil produtos para montar filtros')
ok(/fn_produtos_fiscal_job_criar/.test(modal) && /useLoteFiscal/.test(modal) && /ProgressoLoteFiscal/.test(modal), 'edição em massa aplica em lotes com barra de progresso')
ok(/fn_produtos_fiscal_job_criar/.test(padrao) && /padrao_ncm/.test(padrao) && /pf-aplicar-existentes/.test(padrao), 'Padrão fiscal por NCM aplica aos já cadastrados, em lotes')
ok(/fn_produtos_fiscal_job_obter/.test(hook) && /conduzirLote/.test(hook), 'tela retoma a aplicação que estiver andando ao abrir')
ok(modal.includes("data-testid=\"fm-previa\"") && modal.includes("data-testid=\"fm-aplicar\"") && modal.includes('data-testid="fm-aplicado"'), 'testids da edição em massa preservados')

const chaves = new Set<string>()
for (const m of mig.matchAll(/^ \('([a-z_.]+)',/gm)) chaves.add(m[1])
const usadas = new Set<string>()
for (const m of (modal + padrao + readFileSync('src/components/cadastros/ProgressoLoteFiscal.tsx', 'utf8')).matchAll(/chave=(?:"([^"]+)"|\{A \+ '([^']+)'\})/g)) usadas.add(m[1] ?? `cadastros.produtos.fiscal_massa.${m[2]}`)
for (const c of ['tipo_item_sped', 'cst_icms', 'cst_pis', 'cst_cofins', 'cfop_venda', 'cfop_venda_interestadual']) usadas.add(`cadastros.produtos.fiscal_massa.valor.${c}`)
const antigas = readFileSync('supabase/migrations/20261120133220_padrao_fiscal_ncm_ajuda_4051.sql', 'utf8')
const faltam = [...usadas].filter((c) => !chaves.has(c) && !antigas.includes(`'${c}'`))
ok(faltam.length === 0, `todo "?" da tela tem texto no banco${faltam.length ? ' — faltam: ' + faltam.join(', ') : ''}`)

simula().then(() => {
  if (falhas) { console.error(`\ncheck-fiscal-massa-lotes: ${falhas} falha(s)`); process.exit(1) }
  console.log('\ncheck-fiscal-massa-lotes: ok')
})
