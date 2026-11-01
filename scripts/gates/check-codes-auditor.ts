// Gate (CEO 16/10) — cartão "Code-Auditor" do Painel de Codes: o identificador interno segue eng-chefe-auto, só o rótulo muda;
// "Dormindo" só sem sessão em 24 h; dado ruim do banco não derruba o cartão; a leitura passa pela função guardada.
import { readFileSync } from 'node:fs'
import { AUDITOR_CODE, AUDITOR_NOME, estadoAuditor, lerAuditor } from '../../src/lib/dev/painelCodes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const agora = new Date('2026-10-16T21:00:00Z')
const lease = (ini: string, ren: string) => ({ agente: AUDITOR_CODE, sessao_ref: null, iniciada_em: ini, renovada_em: ren })

ok(AUDITOR_CODE === 'eng-chefe-auto' && AUDITOR_NOME === 'Code-Auditor', 'identificador interno intacto, rótulo Code-Auditor')
ok(estadoAuditor(undefined, agora).estado === 'dormindo', 'sem sessão registrada = dormindo')
ok(estadoAuditor(lease('2026-10-16T20:55:00Z', '2026-10-16T20:58:00Z'), agora).estado === 'trabalhando', 'lease recente = auditando agora')
ok(estadoAuditor(lease('2026-10-16T18:00:00Z', '2026-10-16T18:30:00Z'), agora).estado === 'plantao', 'sessão há 2,5 h = em plantão (não dorme)')
ok(estadoAuditor(lease('2026-10-14T18:00:00Z', '2026-10-14T18:30:00Z'), agora).estado === 'dormindo', 'sem sessão há > 24 h = dormindo')
ok(lerAuditor(null) === null && lerAuditor({ ok: false }) === null, 'resposta sem acesso/nula vira null')
const r = lerAuditor({ ok: true, prs_hoje: 'x', telas_hoje: 3, vereditos: { OURO: 2, X: 'ruim' }, ultimo: { quando: 5 } })
ok(!!r && r.prs_hoje === 0 && r.telas_hoje === 3 && r.vereditos.OURO === 2 && r.vereditos.X === 0 && r.ultimo === null, 'dado malformado vira zeros, sem exceção')

const painel = readFileSync('src/components/dev/PainelCodes.tsx', 'utf8')
ok(/rpc\('fn_dev_auditor_resumo'\)/.test(painel), 'tela lê pela função guardada fn_dev_auditor_resumo')
ok(/c === AUDITOR_CODE\s*\?\s*<BlocoSeguro[^>]*><CartaoAuditor/.test(painel), 'cartão do auditor sob BlocoSeguro')
const mig = readFileSync('supabase/migrations/20261017190000_dev_auditor_resumo.sql', 'utf8')
ok(/fn_dev_painel_pode_ver\(\)/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_dev_auditor_resumo\(\) FROM PUBLIC, anon/.test(mig), 'função guardada pela equipe PS e sem anon')
ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b(?! FUNCTION public\.fn_dev_auditor_resumo)/.test(mig.replace(/--.*$/gm, '')), 'migration aditiva')
process.exit(falhas ? 1 : 0)
