// Gate (Saneamento Fase 3, 27/11) — barras Construído/Auditado da Central de Dev contam as telas pelas áreas da vertical
// (dev_vertical.areas_telas; NULL = {slug}; área sem vertical = CASE antigo), igual à auditoria (#6409) e ao orçamento
// (#6411). Barra de Uso intacta. A migration é achada pelo sufixo do nome (a fila pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_dev_central_barras_areas_telas.sql'))
ok(arq.length === 1, `uma migration *_dev_central_barras_areas_telas.sql (achei ${arq.length})`)
const mig = arq.length ? readFileSync(`supabase/migrations/${arq[0]}`, 'utf8') : ''
const corpo = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_dev_central_barras'))
ok(/COALESCE\(d\.areas_telas,\s*ARRAY\[d\.slug\]\)/.test(corpo), 'áreas da vertical = COALESCE(areas_telas, {slug})')
ok(/JOIN dv ON s\.area = ANY\(dv\.areas\)/.test(corpo), 'tela entra na vertical cujas áreas a incluem')
ok(/WHERE NOT EXISTS \(SELECT 1 FROM dv WHERE s\.area = ANY\(dv\.areas\)\)/.test(corpo)
  && /CASE s\.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s\.area END/.test(corpo),
  'área sem vertical em dev_vertical mantém o CASE antigo (fallback)')
ok(/FROM tela_vert tv GROUP BY 1/.test(corpo), 'Construído/Auditado agrupados pela vertical da tela')
ok(/FROM public\.dev_area_tabela_uso m LOOP/.test(corpo) && /WHERE u\.papel='fluxo'/.test(corpo) && /WHERE u\.papel='automacao'/.test(corpo),
  'barra de Uso continua lendo dev_area_tabela_uso (fluxo e automação)')
ok(/RETURNS TABLE\(area_slug text, status_comercial text, telas integer, construido_pct numeric/.test(corpo), 'mesma assinatura de retorno')
ok(/IF NOT \(auth\.role\(\) = 'service_role' OR public\.fn_eh_ps_admin\(\)\) THEN RETURN; END IF;/.test(corpo), 'mesma guarda (service_role ou PS admin)')
ok(/REVOKE ALL ON FUNCTION public\.fn_dev_central_barras\(\) FROM PUBLIC, anon/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_dev_central_barras\(\) TO authenticated, service_role/.test(mig), 'mesmos grants')
ok(!/\bDROP\s|TRUNCATE|DELETE\s+FROM|UPDATE\s+public\./i.test(mig), 'aditiva: sem DROP/TRUNCATE/DELETE/UPDATE')

process.exit(falhas ? (console.error(`check-dev-central-barras-areas: ${falhas} falha(s)`), 1) : (console.log('check-dev-central-barras-areas: ok'), 0))
