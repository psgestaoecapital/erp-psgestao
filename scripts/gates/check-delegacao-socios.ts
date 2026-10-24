// Gate (CEO 14/10 16:00) — DELEGAÇÃO aos sócios Jordana e Rodrigo: merge da própria carteira + autor da resposta de
// chamado em nome do sócio. Garante que a regra está documentada no AGENTS.md e que as duas migrations de
// reconciliação/lógica existem com o conteúdo esperado (RD-52: o repositório não pode divergir da produção).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const MIGR = join(__dirname, '..', '..', 'supabase', 'migrations')
const arquivos = readdirSync(MIGR)
const ler = (frag: string): string => {
  const f = arquivos.find((x) => x.includes(frag))
  return f ? readFileSync(join(MIGR, f), 'utf8') : ''
}

// ── AGENTS.md: a regra de delegação precisa estar escrita (não pode sumir sem ninguém ver) ──
const ag = readFileSync(join(__dirname, '..', '..', 'AGENTS.md'), 'utf8')
ok(/Delegação aos sócios Jordana e Rodrigo/i.test(ag), 'AGENTS.md: seção de delegação presente')
ok(/revisao-eng-chefe/.test(ag) && /carteira de um sócio/i.test(ag) && /pr[óo]prio sócio dono/i.test(ag) && /MERGE AUTORIZADO/.test(ag),
  'AGENTS.md: sócio dono mergeia a sensível da própria carteira após o MERGE AUTORIZADO do revisor')
ok(/EXCLUSIVA do CEO/i.test(ag) && /n[úu]cleo\/compartilhado/i.test(ag) && /esteira/i.test(ag) && /DRE/.test(ag)
   && /Wealth\/CVM/.test(ag) && /segredos/i.test(ag) && /planos/i.test(ag),
  'AGENTS.md: núcleo/esteira/DRE/Wealth-CVM/segredos/planos continuam exclusivos do CEO')

// ── Migration 1: reconciliação da constraint ampliada + view do dono por carteira ──
const m1 = ler('20261015170030_delegacao_reconciliar_constraint_view')
ok(m1 !== '', 'migration de reconciliação (constraint + view) existe no repositório')
ok(/DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso/.test(m1)
   && /ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso CHECK/.test(m1),
  'constraint reconciliada de forma idempotente (DROP IF EXISTS + ADD)')
ok(/'jordana-code'::text/.test(m1) && /'rodrigo-code'::text/.test(m1),
  'constraint ampliada inclui jordana-code e rodrigo-code (aceitam tarefa do eng_chefe)')
ok(/CREATE OR REPLACE VIEW public\.v_chamado_code_responsavel/.test(m1)
   && /security_invoker = true/.test(m1)
   && /GRANT SELECT ON public\.v_chamado_code_responsavel TO authenticated, service_role/.test(m1),
  'view v_chamado_code_responsavel versionada (security_invoker + grants como na produção)')

// ── Migration 2: resposta de chamado em nome do sócio dono (erp_agente_dono), com as travas de identidade ──
const m2 = ler('20261015180030_delegacao_chamado_autor_dono')
ok(m2 !== '', 'migration do autor da resposta por dono existe no repositório')
ok(/CREATE OR REPLACE FUNCTION public\.fn_agente_chamado_responder\(p_mensagem_agente uuid, p_sugestao_id uuid, p_texto text, p_novo_status text DEFAULT NULL::text, p_hash_aprovado text DEFAULT NULL::text\)/.test(m2),
  'fn_agente_chamado_responder: MESMA assinatura (CREATE OR REPLACE, sem overload)')
ok(/FROM erp_agente_dono d JOIN users u ON u\.id = d\.user_id\s+WHERE d\.agente = m\.para AND d\.ativo/.test(m2),
  'autor resolvido pelo dono ATIVO do agente destinatário (erp_agente_dono), não por parâmetro')
ok(/chamado_autor_email/.test(m2) && /autor_nao_identificado/.test(m2),
  'fallback para a conta PS padrão (chamado_autor_email) quando não há dono')
ok((m2.match(/system_role IN \('PS_ADMIN','PS_ADMIN_CVM'\)/g) || []).length >= 2,
  'autor (dono ou padrão) tem de ser conta PS de verdade (PS_ADMIN/PS_ADMIN_CVM) nas duas vias')

if (falhas) { console.error(`\ncheck-delegacao-socios: ${falhas} falha(s)`); process.exit(1) }
console.log('\nDelegação aos sócios: ok')
