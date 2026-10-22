// Gate (#2867, carteira Rodrigo): "OS como orçamento na tela de Ordens de Serviço". Prova, de forma estática, que a
// ligação ponta-a-ponta está inteira — do CHECK/função no banco até a tela — para não regredir. Sem rede, sem banco.
// Procura a migration pelo CONTEÚDO (nunca pelo nome do arquivo), para a renumeração automática da fila seguir valendo.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const erro = (m: string) => { falhas++; console.error(`✗ ${m}`) }
const ok = (m: string) => console.log(`✓ ${m}`)

// 1) Migration: achar o arquivo que cria o recurso (marcador nasceu_orcamento) e conferir as travas.
const DIR = 'supabase/migrations'
const migs = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.sql')) : []
const migFile = migs.find((f) => readFileSync(join(DIR, f), 'utf8').includes('nasceu_orcamento'))
if (!migFile) {
  erro('migration do #2867 não encontrada (nenhuma migration menciona nasceu_orcamento)')
} else {
  const sql = readFileSync(join(DIR, migFile), 'utf8')
  const sqlNoSpace = sql.replace(/\s+/g, ' ').toLowerCase()
  if (!/alter table\s+public\.erp_os\s+add column if not exists\s+nasceu_orcamento\s+boolean/i.test(sqlNoSpace.replace(/public\. erp_os/g, 'public.erp_os')))
    erro(`${migFile}: coluna aditiva nasceu_orcamento boolean não encontrada`)
  else ok('erp_os.nasceu_orcamento (coluna aditiva)')
  if (!/erp_os_status_check/i.test(sql) || !/'orcamento'/.test(sql)) erro(`${migFile}: status 'orcamento' não entra no CHECK erp_os_status_check`)
  else ok("status 'orcamento' no CHECK de erp_os")
  if (!/function\s+public\.fn_os_criar\([^)]*p_orcamento\s+boolean/i.test(sqlNoSpace.replace(/function public\. fn_os_criar/g, 'function public.fn_os_criar')))
    erro(`${migFile}: fn_os_criar sem o parâmetro p_orcamento boolean`)
  else ok('fn_os_criar(..., p_orcamento boolean)')
  // fn_os_salvar precisa aceitar 'orcamento' na whitelist de status
  const salvar = sql.match(/fn_os_salvar[\s\S]*?v_novo_status NOT IN\s*\(([^)]*)\)/i)
  if (!salvar || !/'orcamento'/.test(salvar[1])) erro(`${migFile}: fn_os_salvar não aceita 'orcamento' na whitelist de status`)
  else ok("fn_os_salvar aceita 'orcamento'")
  // chave de ajuda RD-95
  if (!sql.includes('os.nova.orcamento')) erro(`${migFile}: chave de ajuda os.nova.orcamento ausente (RD-95)`)
  else ok('erp_ajuda_campo: os.nova.orcamento')
}

// 2) Tela de Ordens de Serviço
const OS = 'src/app/dashboard/os/page.tsx'
if (!existsSync(OS)) erro(`${OS} não encontrado`)
else {
  const t = readFileSync(OS, 'utf8')
  if (!/STATUS_CFG[\s\S]*?orcamento:/.test(t)) erro(`${OS}: STATUS_CFG sem 'orcamento'`)
  else ok('os/page: STATUS_CFG tem orcamento')
  if (!/STATUS_ORDER\s*=\s*\[[^\]]*'orcamento'/.test(t)) erro(`${OS}: STATUS_ORDER sem 'orcamento'`)
  else ok('os/page: STATUS_ORDER tem orcamento')
  if (!/p_orcamento:\s*true/.test(t)) erro(`${OS}: fn_os_criar chamada sem p_orcamento (envie p_orcamento: true quando marcado)`)
  else ok('os/page: envia p_orcamento ao fn_os_criar quando marcado')
  if (!/AjudaCampo\s+chave="os\.nova\.orcamento"/.test(t)) erro(`${OS}: toggle "É orçamento?" sem "?" (RD-95)`)
  else ok('os/page: toggle com AjudaCampo os.nova.orcamento')
}

// 3) Ficha da OS (seletor de status)
const CARD = 'src/components/comum/OrdemServicoCard.tsx'
if (!existsSync(CARD)) erro(`${CARD} não encontrado`)
else {
  const t = readFileSync(CARD, 'utf8')
  if (!/value:\s*'orcamento'/.test(t)) erro(`${CARD}: seletor de status sem 'orcamento'`)
  else ok('OrdemServicoCard: status orcamento no seletor')
  // Etapa 2: aviso ao mudar o status de OS nascida de orçamento
  if (!/select\(cols\)/.test(t) || !/const cols = '[^']*nasceu_orcamento/.test(t)) erro(`${CARD}: leitura da OS sem nasceu_orcamento`)
  else ok('OrdemServicoCard: lê nasceu_orcamento')
  if (!/os\.nasceu_orcamento[\s\S]{0,200}verifique o diagnóstico/.test(t)) erro(`${CARD}: aviso "verifique o diagnóstico" ausente ao mudar status`)
  else ok('OrdemServicoCard: aviso ao mudar status de OS nascida de orçamento')
}


// 4) Etapa 3 (#2867): agendar o serviço a partir da OS-orçamento (card → agenda preenchida, com ajuda RD-95).
{
  const card = existsSync('src/components/comum/OrdemServicoCard.tsx') ? readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8') : ''
  const ag = existsSync('src/app/dashboard/oficina/agenda/page.tsx') ? readFileSync('src/app/dashboard/oficina/agenda/page.tsx', 'utf8') : ''
  if (!card.includes('os-agendar-orcamento') || !card.includes("os.status === 'orcamento'")) erro('OrdemServicoCard: botão "Agendar serviço" da OS-orçamento ausente')
  else ok('card: Agendar serviço na OS-orçamento')
  if (!card.includes('os.orcamento.agendar')) erro('OrdemServicoCard: "?" (os.orcamento.agendar) ausente (RD-95)')
  if (!ag.includes("q.get('os')") || !ag.includes('os_orcamento_id')) erro('agenda: não lê ?os= nem grava os_orcamento_id')
  else ok('agenda: abre preenchida a partir da OS-orçamento')
  const mig2 = migs.find((f) => readFileSync(join(DIR, f), 'utf8').includes('os.orcamento.agendar'))
  if (!mig2) erro('migration da ajuda os.orcamento.agendar ausente (RD-95)')
  else ok('erp_ajuda_campo: os.orcamento.agendar')
}


if (falhas) { console.error(`\n${falhas} verificação(ões) do #2867 falharam.`); process.exit(1) }
console.log('✓ #2867: OS como orçamento ligada ponta-a-ponta (banco + tela)')
