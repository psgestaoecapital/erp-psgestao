import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { registrarTentativaFiscal } from '@/lib/fiscal/tentativaLog'

// Guarda de pertencimento à empresa para rotas server-side que usam supabaseAdmin (ignora RLS).
// As rotas /api/** autenticam o Bearer (withAuth) mas o service_role NÃO aplica RLS: sem esta guarda,
// qualquer usuário logado que conheça o id de OUTRA empresa/nota agiria sobre ela (acesso cruzado, IDOR).
// get_user_company_ids()/is_admin() dependem de auth.uid() e são inúteis sob service_role — aqui a
// verificação é explícita por userId, contra user_companies (vínculo) e users.role (PS_ADMIN global).

export type PapelMinimo = 'membro' | 'gerente'

// Papéis de dono/gerência (mínimo p/ certificado A1, provider-config e webhook-config).
const ROLES_GERENCIA = new Set(['owner', 'socio', 'adm', 'admin', 'acesso_total', 'diretor', 'diretor_area', 'gerente'])

export interface AcessoResultado {
  ok: boolean
  psAdmin: boolean
  role: string | null
  motivo?: 'sem_vinculo' | 'papel_insuficiente' | 'parametros'
}

// Verificação pura (sem HTTP): o userId tem acesso à companyId com o papel mínimo?
export async function verificarAcessoEmpresa(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  papelMinimo: PapelMinimo = 'membro'
): Promise<AcessoResultado> {
  if (!userId || !companyId) return { ok: false, psAdmin: false, role: null, motivo: 'parametros' }

  // PS_ADMIN global (users.role) — espelha is_admin(); acesso a qualquer empresa/papel.
  const { data: u } = await supabaseAdmin.from('users').select('role').eq('id', userId).limit(1)
  const roleGlobal = (u as { role?: string }[] | null)?.[0]?.role
  if (roleGlobal === 'adm' || roleGlobal === 'acesso_total') return { ok: true, psAdmin: true, role: 'ps_admin' }

  // Vínculo com a empresa.
  const { data: uc } = await supabaseAdmin
    .from('user_companies').select('role').eq('user_id', userId).eq('company_id', companyId).limit(1)
  const vinculo = (uc as { role?: string }[] | null)?.[0]
  if (!vinculo) return { ok: false, psAdmin: false, role: null, motivo: 'sem_vinculo' }

  if (papelMinimo === 'gerente' && !ROLES_GERENCIA.has(String(vinculo.role ?? ''))) {
    return { ok: false, psAdmin: false, role: String(vinculo.role ?? ''), motivo: 'papel_insuficiente' }
  }
  return { ok: true, psAdmin: false, role: String(vinculo.role ?? '') }
}

export interface GuardaFiscalOpts {
  userId: string | null | undefined
  companyId: string | null | undefined     // SEMPRE a empresa REAL (resolvida do registro quando houver)
  papelMinimo?: PapelMinimo
  // Registra a NEGAÇÃO no log de tentativas fiscais (#1662) — nada de bloqueio silencioso.
  log?: { notaTipo: 'nfse' | 'nfe' | 'nfce'; notaId?: string | null; operacao: string; endpoint?: string }
}

// Guarda para rota: devolve null quando LIBERADO; um NextResponse 403 (e loga a negação) quando NEGADO.
export async function guardaEmpresaFiscal(opts: GuardaFiscalOpts): Promise<NextResponse | null> {
  const r = await verificarAcessoEmpresa(opts.userId, opts.companyId, opts.papelMinimo ?? 'membro')
  if (r.ok) return null
  if (opts.log && opts.companyId) {
    await registrarTentativaFiscal({
      companyId: opts.companyId, notaTipo: opts.log.notaTipo, notaId: opts.log.notaId ?? null,
      operacao: opts.log.operacao, endpoint: opts.log.endpoint ?? 'guarda_acesso', httpStatus: 403,
      providerCodigo: 'ACESSO_NEGADO',
      providerMensagem: r.motivo === 'papel_insuficiente' ? 'Papel insuficiente para esta operação na empresa.' : 'Usuário sem vínculo com esta empresa.',
      resultado: 'erro', usuarioId: opts.userId ?? null,
    })
  }
  return NextResponse.json({ ok: false, mensagem: 'Sem acesso a esta empresa.' }, { status: 403 })
}
