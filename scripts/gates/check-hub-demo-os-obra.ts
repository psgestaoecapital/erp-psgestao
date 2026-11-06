// Gate (HB0 · HBF-0.3, empresa DEMO irrigada) — a Construtora DEMO tem Ordens de Serviço de obra. Sem nenhuma OS no
// banco a tela /dashboard/projetos/obras/os abria vazia e o auditor dava funcional 20. A semente grava 8 OS nas 4 obras
// DEMO, com etapa e serviço da própria obra e os 4 status da tela. Sem rede: lê a migration e a tela.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024170000_hb0_demo_os_obra.sql', 'utf8')
const corpo = mig.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
const base = readFileSync('supabase/migrations/20261023180535_hub_os_obra.sql', 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/obras/os/page.tsx', 'utf8')

// as 8 OS da semente: número, obra, status
const linhas = [...corpo.matchAll(/\('(OSO-\d{4})', '(DEMO-OB-00\d)', (\d), '[^']+', '[^']+',\s*'[^']+', '[^']+', -?\d+, '(\w+)', '(\w+)'/g)]
ok(linhas.length === 8, `8 OS na semente (achou ${linhas.length})`)
ok(new Set(linhas.map(l => l[1])).size === 8, 'números OSO sem repetição')
ok(new Set(linhas.map(l => l[2])).size === 4, 'as 4 obras DEMO têm OS')
const status = new Set(linhas.map(l => l[5]))
for (const s of ['aberta', 'em_execucao', 'concluida', 'cancelada']) ok(status.has(s), `status '${s}' aparece na demo`)
const statusValidos = base.match(/status IN \(([^)]+)\)/)?.[1] ?? ''
const prioValidas = base.match(/prioridade IN \(([^)]+)\)/)?.[1] ?? ''
ok(linhas.every(l => statusValidos.includes(`'${l[5]}'`)), 'status dentro do CHECK da tabela')
ok(linhas.every(l => prioValidas.includes(`'${l[4]}'`)), 'prioridade dentro do CHECK da tabela')
ok(linhas.every(l => +l[3] >= 1 && +l[3] <= 4), 'etapa pela ordem 1..4 do cronograma DEMO')
ok(/'OSO-' \|\| lpad/.test(base) && linhas.every(l => /^OSO-\d{4}$/.test(l[1])), 'número no formato do fn_obra_os_salvar (OSO-0001)')

// datas coerentes com o status: concluída tem início e fim; em execução só início; aberta/cancelada nenhum
const datas = [...corpo.matchAll(/'(aberta|em_execucao|concluida|cancelada)', (NULL|-?\d+), (NULL|-?\d+), -?\d+\)/g)]
ok(datas.length === 8, 'cada OS tem início/fim declarados')
ok(datas.every(([, s, ini, fim]) =>
  s === 'concluida' ? ini !== 'NULL' && fim !== 'NULL' && +ini <= +fim
    : s === 'em_execucao' ? ini !== 'NULL' && fim === 'NULL'
      : ini === 'NULL' && fim === 'NULL'), 'datas de início/fim batem com o status')

// etapa e serviço da PRÓPRIA obra; idempotente; só a DEMO 006
ok(/t\.obra_id = o\.id AND t\.ordem = s\.etapa/.test(corpo) && /i\.obra_id = o\.id AND i\.descricao = s\.servico/.test(corpo), 'etapa e serviço buscados na própria obra')
ok(corpo.includes('ON CONFLICT (company_id, numero) DO NOTHING'), 'idempotente: rodar de novo não duplica nem sobrescreve')
ok(corpo.includes("c constant uuid := 'b0700000-0000-4000-a000-000000000006'") && corpo.includes('is_demo IS TRUE'), 'só a empresa demo 006 (is_demo)')
ok(!/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(corpo), 'sem DELETE/TRUNCATE/DROP/UPDATE (a limpeza já existe na semente)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_os\(uuid\) FROM PUBLIC, anon, authenticated/.test(corpo), 'semente sem acesso de usuário')
ok(corpo.includes("IF v_def ~ 'fn_demo_seed_construtora_os' THEN RETURN; END IF;") && (corpo.match(/RAISE EXCEPTION/g) ?? []).length === 2, 'patch por âncora idempotente e que aborta sem a âncora')

// a tela lista exatamente o que a semente grava
ok(tela.includes("rpc('fn_obra_os_listar'"), 'tela lê pelo fn_obra_os_listar')

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-demo-os-obra`); process.exit(1) }
console.log('\ncheck-hub-demo-os-obra: verde')
