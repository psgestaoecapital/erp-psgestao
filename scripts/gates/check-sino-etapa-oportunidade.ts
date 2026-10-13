// Gate (chamado #120 · Tryo · CEO 01/10): aviso no sino quando a oportunidade/orçamento muda de etapa, para o
// responsável e o vendedor. Roda no build, sem rede — lê a migration e o TopNav:
//  - o aviso nasce no banco (gatilho AFTER UPDATE OF etapa), então vale para kanban, formulário e qualquer porta;
//  - destinatários = responsável + vendedor do orçamento (sem orçamento: quem criou), nunca quem mudou, só quem tem
//    acesso à empresa; oportunidade excluída não avisa;
//  - cada pessoa só lê/marca o PRÓPRIO aviso (RLS por auth.uid()); o cliente não insere nem reescreve o texto;
//  - o sino mostra a seção "Para você" e marca como lido ao abrir.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001150000_notificacao_usuario_etapa_oportunidade.sql', 'utf8')
const nav = readFileSync('src/components/layout/TopNav.tsx', 'utf8')

ok(/CREATE TABLE IF NOT EXISTS public\.erp_notificacao_usuario/.test(mig) && /destinatario_id uuid NOT NULL REFERENCES public\.users/.test(mig),
  'tabela de aviso por pessoa (erp_notificacao_usuario, destinatário = usuário)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /FOR SELECT TO authenticated USING \(destinatario_id = auth\.uid\(\)\)/.test(mig),
  'RLS: cada pessoa lê só o próprio aviso')
ok(/REVOKE ALL ON public\.erp_notificacao_usuario FROM PUBLIC, anon, authenticated/.test(mig)
  && /GRANT SELECT ON public\.erp_notificacao_usuario TO authenticated/.test(mig)
  && /GRANT UPDATE \(lida, lida_em\) ON public\.erp_notificacao_usuario TO authenticated/.test(mig)
  && !/GRANT (INSERT|DELETE|ALL)[^;]*erp_notificacao_usuario/.test(mig),
  'cliente só lê e marca "lida" — não insere, não apaga, não reescreve')
ok(/AFTER UPDATE OF etapa ON public\.erp_crm_oportunidade/.test(mig), 'gatilho no banco na mudança de etapa (vale para qualquer porta)')
ok(/NEW\.etapa IS NOT DISTINCT FROM OLD\.etapa OR NEW\.deleted_at IS NOT NULL/.test(mig), 'sem mudança de etapa ou oportunidade excluída: não avisa')
ok(/ARRAY\[NEW\.responsavel_id, v_vendedor\]/.test(mig) && /v_vendedor := COALESCE\(v_vendedor, NEW\.created_by\)/.test(mig)
  && /o\.vendedor_id INTO v_vendedor FROM public\.erp_orcamentos/.test(mig),
  'destinatários: responsável + vendedor do orçamento (sem orçamento: quem criou)')
ok(/d IS DISTINCT FROM v_autor/.test(mig), 'quem fez a mudança não recebe aviso de si mesmo')
ok(/public\.user_companies uc WHERE uc\.user_id = d AND uc\.company_id = NEW\.company_id/.test(mig), 'só avisa quem tem acesso à empresa')
ok(/REVOKE ALL ON FUNCTION public\.fn_crm_oport_notificar_etapa\(\) FROM PUBLIC, anon, authenticated/.test(mig), 'função do gatilho fechada ao cliente')
ok(/WHEN 'proposta_enviada' THEN 'Proposta Enviada'/.test(mig), 'aviso em linguagem humana (rótulo da etapa, nunca o código)')
ok(/from\('erp_notificacao_usuario'\)/.test(nav) && /Para você/.test(nav) && /data-testid="notif-usuario"/.test(nav),
  'sino mostra a seção "Para você"')
ok(/notifsUsuario\.some\(\(n\) => !n\.lida\)/.test(nav), 'ponto vermelho acende com aviso não lido')
ok(/from\('erp_notificacao_usuario'\)\.update\(\{ lida: true/.test(nav), 'abrir o aviso marca como lido')

if (falhas) { console.error(`\n${falhas} falha(s) no aviso de etapa (#120)`); process.exit(1) }
console.log('\nSino na mudança de etapa (#120): ok')
