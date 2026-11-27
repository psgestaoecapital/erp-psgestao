// Gate (Saneamento Fase 3, 27/11) — orçamento e disparo do "Atualizar a vertical" contam as MESMAS telas que a auditoria
// (dev_vertical.areas_telas; NULL = {slug}; vertical fora de dev_vertical = CASE antigo). Antes: Industrial 24 × 35.
// A migration é achada pelo sufixo do nome (a fila pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_dev_vertical_orcamento_areas_telas.sql'))
ok(arq.length === 1, `uma migration *_dev_vertical_orcamento_areas_telas.sql (achei ${arq.length})`)
const mig = arq.length ? readFileSync(`supabase/migrations/${arq[0]}`, 'utf8') : ''
const corpo = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento'))
ok(/COALESCE\(d\.areas_telas,\s*ARRAY\[d\.slug\]\)/.test(corpo), 'orçamento: áreas = COALESCE(areas_telas, {slug})')
ok(/s\.area\s*=\s*ANY\(dv\.areas\)/.test(corpo), 'orçamento: system_screens.area = ANY(áreas da vertical)')
ok(/ELSE CASE s\.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s\.area END = p_vertical/.test(corpo),
  'orçamento: vertical fora de dev_vertical mantém o CASE antigo (fallback)')
ok(/'areas',\s*to_jsonb\(t\.areas\)/.test(corpo), "orçamento devolve 'areas' para a rota usar")
for (const k of ['telas', 'custo_estimado', 'tempo_min', 'gasto_dia', 'gasto_mes', 'cap_dia', 'cap_mes', 'pode', 'motivo'])
  ok(corpo.includes(`'${k}'`), `orçamento mantém a chave '${k}'`)
ok(/auth\.role\(\) = 'service_role' OR public\.fn_eh_ps_admin\(\)/.test(corpo), 'mesma guarda (service_role ou PS admin)')
ok(/REVOKE ALL ON FUNCTION public\.fn_dev_vertical_orcamento\(text\) FROM PUBLIC, anon/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_dev_vertical_orcamento\(text\) TO authenticated, service_role/.test(mig), 'mesmos grants')
ok(!/\bDROP\s|TRUNCATE|DELETE\s+FROM|UPDATE\s+public\./i.test(mig), 'aditiva: sem DROP/TRUNCATE/DELETE/UPDATE')

const rota = readFileSync('src/app/api/dev/atualizar-vertical/route.ts', 'utf8')
ok(/Array\.isArray\(orc\.areas\)/.test(rota) && /\.in\('area',\s*areas\)/.test(rota), "rota escolhe as telas pelas 'areas' do orçamento")

process.exit(falhas ? (console.error(`check-dev-vertical-orcamento-areas: ${falhas} falha(s)`), 1) : (console.log('check-dev-vertical-orcamento-areas: ok'), 0))
