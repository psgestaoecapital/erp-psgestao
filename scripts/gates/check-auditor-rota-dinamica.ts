// Gate (Hub PDCA 24/10) — o robô do auditor NÃO fotografa o "[id]" literal de rota dinâmica.
// Antes: /dashboard/projetos/obras/[id]/cronograma era visitada como "%5Bid%5D" → erro cru de uuid na tela →
// reprovação falsa (funcional 5/90). Agora src/lib/gold/rotaConcreta.ts troca o [id] por um registro REAL da
// empresa DEMO do pedido; sem registro, não fotografa. Sem rede: cliente Supabase simulado.
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rotaConcreta, temSegmentoDinamico, resolvedorDa, aplicarId } from '../../src/lib/gold/rotaConcreta'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const DEMO = 'b0700000-0000-4000-a000-000000000006'
const OUTRA = 'aaaaaaaa-0000-4000-a000-000000000001'
const OBRA_COM_TAREFA = '11111111-1111-4111-8111-111111111111'
const OBRA_SEM_TAREFA = '22222222-2222-4222-8222-222222222222'
const SERVICO = '33333333-3333-4333-8333-333333333333'

type Linha = Record<string, unknown>
// Cliente simulado: aplica eq/is/limit sobre as linhas da tabela; guarda os filtros pedidos.
function simulado(tabelas: Record<string, Linha[]>, filtros: string[] = []) {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])]
      const q = {
        select() { return q },
        eq(c: string, v: unknown) { filtros.push(`${tabela}.${c}=${String(v)}`); linhas = linhas.filter((l) => l[c] === v); return q },
        is(c: string, v: unknown) { filtros.push(`${tabela}.${c} is ${String(v)}`); linhas = linhas.filter((l) => (l[c] ?? null) === v); return q },
        limit(n: number) { return Promise.resolve({ data: linhas.slice(0, n), error: null }) },
      }
      return q
    },
  } as unknown as SupabaseClient
}

const banco = {
  projetos_obras: [{ id: OBRA_SEM_TAREFA, company_id: DEMO }, { id: OBRA_COM_TAREFA, company_id: DEMO }, { id: 'x', company_id: OUTRA }],
  projetos_obra_tarefa: [
    { obra_id: 'tarefa-excluida', company_id: DEMO, excluido_em: '2026-10-01' },
    { obra_id: OBRA_COM_TAREFA, company_id: DEMO, excluido_em: null },
  ],
  projetos_servicos: [{ id: 'inativo', company_id: DEMO, ativo: false }, { id: SERVICO, company_id: DEMO, ativo: true }],
}

async function main() {
  // ── regras puras ──
  ok(temSegmentoDinamico('/dashboard/projetos/obras/[id]/cronograma') && !temSegmentoDinamico('/dashboard/projetos/obras'),
    'detecta segmento dinâmico só quando há [..]')
  const r = resolvedorDa('/dashboard/projetos/obras/[id]/cronograma')
  ok(r?.tabela === 'projetos_obras', 'obras/[id]/cronograma usa o resolvedor de obras')
  ok(resolvedorDa('/dashboard/projetos/obras/[id]') === r, 'a própria obras/[id] usa o mesmo resolvedor')
  ok(resolvedorDa('/dashboard/projetos/obras/[idx]') === null, 'prefixo parecido não casa')
  ok(r !== null && aplicarId('/dashboard/projetos/obras/[id]/cronograma', r, OBRA_COM_TAREFA) === `/dashboard/projetos/obras/${OBRA_COM_TAREFA}/cronograma`,
    'troca só o [id] e mantém o resto da rota')

  // ── resolução contra o banco simulado ──
  const filtros: string[] = []
  const a = await rotaConcreta(simulado(banco, filtros), `/dashboard/projetos/obras/[id]/cronograma?company_id=${DEMO}`, DEMO)
  ok(a.tipo === 'resolvida' && a.rota === `/dashboard/projetos/obras/${OBRA_COM_TAREFA}/cronograma?company_id=${DEMO}`,
    'cronograma: prefere obra DEMO com tarefa viva e preserva a query')
  ok(filtros.includes(`projetos_obra_tarefa.company_id=${DEMO}`) && filtros.includes('projetos_obra_tarefa.excluido_em is null'),
    'consulta filtrada pela empresa do pedido e sem tarefa excluída (nunca registro de outra empresa)')

  const b = await rotaConcreta(simulado({ ...banco, projetos_obra_tarefa: [] }), '/dashboard/projetos/obras/[id]/cockpit', DEMO)
  ok(b.tipo === 'resolvida' && b.rota === `/dashboard/projetos/obras/${OBRA_SEM_TAREFA}/cockpit`, 'sem tarefa: cai para qualquer obra da empresa')

  const c = await rotaConcreta(simulado(banco), '/dashboard/projetos/catalogo/[id]', DEMO)
  ok(c.tipo === 'resolvida' && c.rota === `/dashboard/projetos/catalogo/${SERVICO}`, 'catálogo: só serviço ativo')

  const d = await rotaConcreta(simulado(banco), '/dashboard/projetos/obras/[id]/cronograma', 'cccccccc-0000-4000-a000-00000000000c')
  ok(d.tipo === 'sem_registro', 'empresa sem obra: sem_registro (não fotografa o [id] literal)')

  const e = await rotaConcreta(simulado(banco), '/dashboard/projetos/obras', DEMO)
  ok(e.tipo === 'estatica' && e.rota === '/dashboard/projetos/obras', 'rota estática passa igual')
  const f = await rotaConcreta(simulado(banco), '/dashboard/bpo/foco/[company_id]', DEMO)
  ok(f.tipo === 'sem_resolvedor' && f.rota === '/dashboard/bpo/foco/[company_id]', 'rota dinâmica fora da lista: comportamento antigo')

  // ── a captura usa o resolvedor ──
  const cap = readFileSync('src/app/api/screen-watcher/playwright/route.ts', 'utf8')
  ok(/import \{ rotaConcreta \} from '@\/lib\/gold\/rotaConcreta'/.test(cap), 'captura importa o resolvedor')
  ok(/const alvo = await rotaConcreta\(supabase, rotaCompleta, empresaId\)/.test(cap) && /const urlAlvo = `\$\{SAAS_BASE_URL\}\$\{rotaVisita\}`/.test(cap),
    'captura visita a rota concreta da empresa do pedido')
  ok(/alvo\.tipo === 'sem_registro'\) throw/.test(cap), 'captura não fotografa rota dinâmica sem registro')
  ok(/const pedidoPath = rotaVisita\.split/.test(cap), 'conferência da URL final usa a rota concreta')

  if (falhas) { console.error(`\n${falhas} falha(s) — check-auditor-rota-dinamica`); process.exit(1) }
  console.log('\ncheck-auditor-rota-dinamica OK')
}
void main()
