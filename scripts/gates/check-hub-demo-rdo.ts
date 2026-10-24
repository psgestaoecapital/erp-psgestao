// Gate (HB0 · HBF-0.5, empresa DEMO irrigada) — a Construtora DEMO tem diário de obra (RDO) e o reset da demo não quebra
// quando alguém lança um RDO. projetos_obra_rdo aponta para a OS e a obra com ON DELETE NO ACTION: a semente precisa
// apagar o RDO da demo ANTES das OS. A semente grava 10 diários nas OS que já começaram, dentro da janela da OS, com
// chuva e dias parados (pluviometria do cronograma). Sem rede: lê as migrations.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261025120000_hb0_demo_rdo_semente.sql', 'utf8')
const corpo = mig.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
const tabela = readFileSync('supabase/migrations/20261024190000_hb0_os_obra_rdo.sql', 'utf8')
const os = readFileSync('supabase/migrations/20261024170000_hb0_demo_os_obra.sql', 'utf8')

// os diários da semente: OS, dia relativo, clima, praticável, efetivo, atividades, ocorrências
const linhas = [...corpo.matchAll(/\('(OSO-\d{4})', (-?\d+), '(\w+)', (true|false), (\d+), (NULL|'[^']*'), (NULL|'[^']*')\)/g)]
ok(linhas.length === 10, `10 diários na semente (achou ${linhas.length})`)
const climas = tabela.match(/clima IN \(([^)]+)\)/)?.[1] ?? ''
ok(linhas.every(l => climas.includes(`'${l[3]}'`)), 'clima dentro do CHECK da tabela')
ok(new Set(linhas.map(l => l[3])).size === 4, 'os 4 climas aparecem (sol, nublado, chuva, chuva forte)')
ok(linhas.filter(l => l[4] === 'false').length === 2, '2 dias em que não deu para trabalhar')
ok(linhas.every(l => l[6] !== 'NULL' || l[7] !== 'NULL'), 'todo diário conta o que foi feito ou o que aconteceu (regra do fn_obra_rdo_salvar)')
ok(linhas.every(l => +l[2] <= 0), 'nenhum diário no futuro')
ok(new Set(linhas.map(l => `${l[1]}|${l[2]}`)).size === linhas.length, 'um diário por OS e por dia')

// cada diário cai dentro da janela início..fim da OS da semente de OS (dias relativos a hoje)
const janela = new Map([...os.matchAll(/\('(OSO-\d{4})', 'DEMO-OB-00\d',[\s\S]*?'(aberta|em_execucao|concluida|cancelada)', (NULL|-?\d+), (NULL|-?\d+), -?\d+\)/g)]
  .map(m => [m[1], { st: m[2], ini: m[3], fim: m[4] }]))
ok(linhas.every(l => {
  const j = janela.get(l[1]); if (!j || j.ini === 'NULL') return false
  return +l[2] >= +j.ini && (j.fim === 'NULL' || +l[2] <= +j.fim)
}), 'diário só em OS iniciada e dentro da janela início..fim')
ok(corpo.includes('(os.iniciada_em IS NULL OR v_hoje + r.dia >= os.iniciada_em::date)')
  && corpo.includes('(os.concluida_em IS NULL OR v_hoje + r.dia <= os.concluida_em::date)'), 'a função confere a janela na hora (OS mudada na tela não recebe diário fora dela)')

// idempotente, só a 006, sem acesso de usuário
ok(/NOT EXISTS \(SELECT 1 FROM projetos_obra_rdo x\s+WHERE x\.os_id = os\.id AND x\.data = v_hoje \+ r\.dia AND x\.excluido_em IS NULL\)/.test(corpo), 'idempotente: não duplica nem sobrescreve diário feito na tela')
ok(corpo.includes("c constant uuid := 'b0700000-0000-4000-a000-000000000006'") && corpo.includes('is_demo IS TRUE'), 'só a empresa demo 006 (is_demo)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_construtora_rdo\(uuid\) FROM PUBLIC, anon, authenticated/.test(corpo)
  && !/GRANT EXECUTE[^;]*(authenticated|anon)/.test(corpo), 'semente sem acesso de usuário')

// reset: apaga o RDO da demo antes das OS, por âncora (aborta se sumir), e semeia o RDO depois das OS
ok(corpo.includes("E'  DELETE FROM projetos_obra_rdo WHERE company_id = c;\\n  DELETE FROM projetos_obra_os WHERE company_id = c;'"), 'RDO da demo apagado ANTES das OS (FK sem cascata)')
ok(corpo.includes("E'  PERFORM fn_demo_seed_construtora_os(c);\\n  PERFORM fn_demo_seed_construtora_rdo(c);'"), 'semente do RDO logo depois da semente de OS')
ok(corpo.includes("IF v_def ~ 'fn_demo_seed_construtora_rdo' THEN RETURN; END IF;") && (corpo.match(/RAISE EXCEPTION/g) ?? []).length === 2, 'patch por âncora idempotente e que aborta sem a âncora')
ok(/REFERENCES public\.projetos_obra_os\(id\)\s*,/.test(tabela), 'FK do RDO para a OS segue sem cascata (por isso a limpeza explícita)')
// fora das strings do patch, a migration não apaga nem altera nada
const semPatch = corpo.replace(/E'[^']*(''[^']*)*'/g, '')
ok(!/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(semPatch), 'sem DELETE/TRUNCATE/DROP/UPDATE fora do patch da semente')

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-demo-rdo`); process.exit(1) }
console.log('\ncheck-hub-demo-rdo: verde')
