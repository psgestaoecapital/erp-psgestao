// Gate (CEO 25/11; alinhado CEO 27/11 por gilberto-esteira — RD-105 caso 6) — Indústria · Folha › Encargos.
// A tela foi movida de /dashboard/industrial/rh/folha para /dashboard/industrial/folha e o editor virou o campo
// ÚNICO "% de encargos sobre a folha" (EncargosTab, redesign CEO/Eng. Chefe 25/11): ajusta o INSS patronal e
// MANTÉM as demais chaves do detalhamento vindas do vigente. O gate antigo apontava para o caminho e o componente
// antigos (EncargosFolha) — contrato superado. Trava no estático o que não pode regredir na entrega:
//   1) a tela /dashboard/industrial/folha existe, tem <h1>, usa AbasRH e renderiza a aba "Encargos" (EncargosTab);
//   2) o editor lê/grava pelos RPCs certos (fn_mao_obra_encargos_vigentes / fn_mao_obra_encargos_salvar);
//   3) o salvar PRESERVA as demais chaves do detalhamento vindas do vigente (round-trip de vig.*) — senão o
//      INSERT…ON CONFLICT com defaults as zeraria (RD-97);
//   4) os campos/ações têm "?" apontando para a rota da ajuda publicada (RD-95).
// Só leitura estática; sem rede, banco ou variável.  npm run gates -- rh-folha-encargos
import { readFileSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const pagina = ler('src/app/dashboard/industrial/folha/page.tsx')
const editor = ler('src/app/dashboard/industrial/folha/EncargosTab.tsx')

// 1) a tela
ok(!!pagina, 'página src/app/dashboard/industrial/folha/page.tsx existe')
ok(/<h1\b/.test(pagina), 'página tem <h1> (RD-26)')
ok(/\bAbasRH\b/.test(pagina) && /EncargosTab/.test(pagina), 'página usa AbasRH e renderiza EncargosTab')
ok(/chave:\s*'encargos'/.test(pagina), 'aba "encargos" declarada')

// 2) os RPCs certos
ok(!!editor, 'componente src/app/dashboard/industrial/folha/EncargosTab.tsx existe')
ok(/fn_mao_obra_encargos_vigentes/.test(editor), 'EncargosTab lê por fn_mao_obra_encargos_vigentes')
ok(/fn_mao_obra_encargos_salvar/.test(editor), 'EncargosTab grava por fn_mao_obra_encargos_salvar')

// 3) round-trip das demais chaves do detalhamento (RD-97): o salvar reenvia as chaves vigentes, ajustando só o INSS
for (const campo of ['regime', 'rat_pct', 'fap', 'terceiros_pct', 'fgts_pct', 'prov_13_pct', 'prov_ferias_pct', 'prov_rescisao_pct']) {
  ok(new RegExp(`${campo}\\s*[:,]`).test(editor), `salvar preserva a chave do detalhamento: ${campo}`)
}
ok(/\bvig\.(rat_pct|fgts_pct|prov_13_pct)/.test(editor), 'salvar parte dos valores vigentes (round-trip), não de defaults')

// 4) caminho real + ajuda (RD-95): os campos têm "?" apontando para a rota publicada
ok(/AjudaCampo/.test(editor) && /rota=\{ROTA\}/.test(editor), 'campos têm "?" apontando para a rota da ajuda publicada (RD-95)')

if (falhas > 0) { console.error(`\n[check-rh-folha-encargos] ${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\n[check-rh-folha-encargos] OK')
