// Gate (Eng. Chefe 14/10): script que copia linhas com id explícito para o banco de testes tem de acertar as sequences
// depois (setval = max(coluna)). Causa: "duplicate key screen_route_features_pkey (id)=(9)" na vaga 1 (#2533).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const acerta = readFileSync('scripts/banco-testes/acertar-sequences.sh', 'utf8')
ok(/setval\(r\.seq, mx, true\)/.test(acerta) && /mx >= coalesce\(r\.last_value, 0\)/.test(acerta), 'acertar-sequences: setval(seq, max) quando max >= last_value')
ok(/horsymhsinqcimflrtjo/.test(acerta), 'acertar-sequences: recusa produção')

for (const f of ['scripts/banco-testes/catalogos.sh', 'scripts/banco-testes/reconciliar-vaga.sh']) {
  ok(/acertar-sequences\.sh/.test(readFileSync(f, 'utf8')), `${f} chama acertar-sequences.sh`)
}
// Outro script que carregue tabela real com \copy ... FROM (tabelas temporárias _x ficam de fora) precisa chamar o acerto.
for (const f of ['semente-demo.sh', 'espelhar-grants.sh', 'ledger.sh', 'vaga-snapshot.sh']) {
  const s = readFileSync(`scripts/banco-testes/${f}`, 'utf8')
  ok(!/\\copy\s+(?!_)(public\.)?[a-z]\w*[^\n]*\bFROM\b/i.test(s) || /acertar-sequences\.sh/.test(s), `${f}: sem \\copy FROM sem acertar sequences`)
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nSequences do banco de testes: ok')
