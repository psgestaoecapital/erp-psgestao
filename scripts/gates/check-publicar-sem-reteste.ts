// Gate (CEO 19/10) — publicar sem re-teste só quando as 4 condições valem e a aceitação da main está verde.
import { decidirSemReteste, type EntradaSemReteste } from '../merge/publicar-sem-reteste'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const base: EntradaSemReteste = {
  arquivosPr: ['src/app/dashboard/obras/page.tsx'],
  arquivosMain: ['src/app/dashboard/rh/page.tsx'],
  testeVerdeEm: '2026-10-19T10:00:00Z',
  agora: '2026-10-19T11:00:00Z',
  mainVerde: true,
}
const d = (o: Partial<EntradaSemReteste>) => decidirSemReteste({ ...base, ...o }).dispensa

ok(d({}), 'caso feliz: sem relação, sem migration, sem núcleo, 1 h, main verde → dispensa')
ok(!d({ arquivosMain: ['src/app/dashboard/obras/page.tsx'] }), '(1) arquivo em comum → re-testa')
ok(!d({ arquivosPr: ['supabase/migrations/20261019120030_x.sql'] }), '(2) migration na PR → re-testa')
ok(!d({ arquivosMain: ['supabase/migrations/20261019120030_x.sql'] }), '(2) migration na main → re-testa')
for (const n of ['src/middleware.ts', 'src/lib/auth/sessao.ts', 'supabase/functions/x/index.ts', 'scripts/merge/fila-merge.sh', 'scripts/banco-testes/a.sh', '.github/workflows/a.yml'])
  ok(!d({ arquivosPr: [n] }), `(3) núcleo ${n} → re-testa`)
ok(d({ testeVerdeEm: '2026-10-19T09:00:00Z' }), '(4) teste com exatamente 2 h → dispensa')
ok(!d({ testeVerdeEm: '2026-10-19T08:59:59Z' }), '(4) teste com mais de 2 h → re-testa')
ok(!d({ mainVerde: false }), 'PROTEÇÃO: aceitação da main vermelha → desliga')
ok(!d({ mainVerde: null }), 'PROTEÇÃO: aceitação da main desconhecida → desliga (fail-closed)')
ok(d({ mainVerde: true }), 'main volta a verde → religa sozinha')
ok(!d({ testeVerdeEm: null }), 'sem teste verde → re-testa')
ok(!d({ arquivosMain: [] }), 'lista da main vazia (dado ausente) → re-testa')
ok(!d({ testeVerdeEm: 'lixo' }), 'horário ilegível → re-testa')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nPublicar sem re-teste: ok')
