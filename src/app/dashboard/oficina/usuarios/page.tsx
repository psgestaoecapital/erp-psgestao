'use client'

// B.3 · Usuários da Oficina — o OFICINA_DONO convida e desativa MECÂNICO.
// SPEC "Oficina · Papeis do dono e do mecanico" §4. Regra do CEO: o PAPEL do usuário logado
// decide o que a tela OFERECE, não o que ela esconde depois. Aqui o formulário só oferece
// "convidar mecânico" — a opção de criar dono NÃO EXISTE no form (não é opção desabilitada).
// Enforcement real no backend: fn_acessos_pode_gerir + escopo do dono (só concede OFICINA_MECANICO).
// Reusa as fn_acessos_* (RD-26): contexto (listar), convidar_pessoa (mecânico), remover_pessoa (inativar).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { useAcesso } from '@/hooks/useAcesso'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#EAF3DE', red: '#B91C1C', redBg: '#FCEBEB', muted: 'rgba(61,35,20,0.55)',
}

interface Pessoa {
  user_id: string
  email: string | null
  nome: string | null
  papel_gestao: string | null
  is_active: boolean | null
  situacao: string | null
}
interface Contexto { pessoas?: Pessoa[] }

const PAPEL_LABEL: Record<string, string> = {
  OFICINA_DONO: 'Dono', OFICINA_MECANICO: 'Mecânico',
  CLIENT_OWNER: 'Master', CLIENT_MANAGER: 'Gerente', CLIENT_OPERATOR: 'Operacional', CLIENT_VIEWER: 'Leitura',
}
const SITUACAO_LABEL: Record<string, string> = {
  ATIVO: 'Ativo', INATIVO_7DIAS: 'Inativo 7d', INATIVO_30DIAS: 'Inativo 30d', NUNCA_LOGOU: 'Nunca entrou',
}

const inp: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px', border: `1px solid ${C.border}`,
  borderRadius: 8, fontSize: 14, color: C.espresso, background: C.white, outline: 'none',
}

export const dynamic = 'force-dynamic'

export default function UsuariosOficinaPage() {
  const { sel } = useCompanyIds()
  const companyId = useMemo<string | null>(
    () => (!sel || sel === 'consolidado' || sel.startsWith('group_') ? null : sel),
    [sel],
  )
  const { isDono, isGerencial, carregando: carregandoPapel } = useAcesso(companyId)
  const podeGerir = isDono || isGerencial // dono da oficina ou master/gerente da empresa

  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [convidando, setConvidando] = useState(false)
  const [removendoId, setRemovendoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setPessoas([]); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_acessos_empresa_contexto', { p_company_id: companyId })
    if (error) { setErro(error.message); setPessoas([]); setLoading(false); return }
    const c = data as Contexto | null
    setPessoas((c?.pessoas ?? []) as Pessoa[])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  async function convidarMecanico() {
    if (!companyId) return
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) { setErro('Informe um e-mail válido.'); return }
    setConvidando(true); setErro(null); setOk(null)
    // Papel FIXO: OFICINA_MECANICO. A tela não oferece outro papel.
    const { data, error } = await supabase.rpc('fn_acessos_convidar_pessoa', {
      p_company_id: companyId, p_email: e, p_papel_gestao: 'OFICINA_MECANICO',
      p_role: 'operacional', p_base_url: typeof window !== 'undefined' ? window.location.origin : null,
    })
    setConvidando(false)
    const r = data as { ok?: boolean; erro?: string; acao?: string } | null
    if (error || r?.ok === false) { setErro(error?.message || r?.erro || 'Falha ao convidar.'); return }
    setOk(r?.acao === 'vinculado' ? 'Mecânico vinculado.' : 'Convite enviado ao mecânico.')
    setEmail('')
    void carregar()
  }

  async function desativar(p: Pessoa) {
    if (!companyId) return
    setRemovendoId(p.user_id); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('fn_acessos_remover_pessoa', {
      p_company_id: companyId, p_user_id: p.user_id, p_modo: 'inativar',
    })
    setRemovendoId(null)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || r?.ok === false) { setErro(error?.message || r?.erro || 'Falha ao desativar.'); return }
    setOk('Acesso do mecânico desativado.')
    void carregar()
  }

  if (!companyId) {
    return <div style={{ padding: 24, color: C.espressoM, background: C.bg, minHeight: '100vh' }}>
      Selecione uma empresa para ver os usuários da oficina.
    </div>
  }
  if (!carregandoPapel && !podeGerir) {
    return <div style={{ padding: 24, color: C.espressoM, background: C.bg, minHeight: '100vh' }}>
      Esta tela é do dono da oficina.
    </div>
  }

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: '4px 0 2px', fontSize: 20, fontWeight: 700, color: C.espresso }}>Usuários da Oficina</h1>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: C.espressoM }}>
        Convide um mecânico por e-mail. Ele entra sem ver valores, margem nem comissão dos outros.
      </p>

      {/* convidar mecânico — o form oferece SÓ isto (regra do CEO) */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: C.espressoM, fontWeight: 600, marginBottom: 6 }}>
          Convidar mecânico
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="email@do-mecanico.com" style={{ ...inp, flex: 1, minWidth: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') void convidarMecanico() }}
          />
          <button
            type="button" onClick={() => void convidarMecanico()} disabled={convidando}
            style={{ minHeight: 44, padding: '10px 18px', borderRadius: 8, border: 'none',
              background: C.gold, color: C.espresso, fontWeight: 700, fontSize: 14,
              cursor: convidando ? 'default' : 'pointer', opacity: convidando ? 0.6 : 1 }}
          >
            {convidando ? 'Convidando…' : '+ Convidar mecânico'}
          </button>
        </div>
      </div>

      {erro && <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8,
        background: C.redBg, color: C.red, fontSize: 13, borderLeft: `3px solid ${C.red}` }}>{erro}</div>}
      {ok && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8,
        background: C.greenBg, color: C.green, fontSize: 13, borderLeft: `3px solid ${C.green}` }}>{ok}</div>}

      {/* quem tem acesso */}
      <div style={{ fontSize: 12, color: C.espressoM, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, margin: '4px 0 8px' }}>
        Quem tem acesso
      </div>
      {loading ? (
        <div style={{ color: C.espressoM, fontSize: 13 }}>Carregando…</div>
      ) : pessoas.length === 0 ? (
        <div style={{ color: C.espressoM, fontSize: 13 }}>Ninguém ainda.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pessoas.map((p) => {
            const ehMecanico = p.papel_gestao === 'OFICINA_MECANICO' && (p.is_active ?? true)
            return (
              <div key={p.user_id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.espresso }}>{p.nome || p.email || '—'}</div>
                  <div style={{ fontSize: 12, color: C.espressoM }}>{p.email}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                  background: C.cream, color: C.espresso }}>
                  {p.papel_gestao ? (PAPEL_LABEL[p.papel_gestao] ?? p.papel_gestao) : '—'}
                </span>
                <span style={{ fontSize: 11, color: (p.is_active ?? true) ? C.green : C.red }}>
                  {(p.is_active ?? true) ? (SITUACAO_LABEL[p.situacao ?? ''] ?? 'Ativo') : 'Desativado'}
                </span>
                {/* Desativar SÓ aparece para mecânico ativo — o dono só age sobre mecânico (regra do CEO). */}
                {ehMecanico && (
                  <button
                    type="button" onClick={() => void desativar(p)} disabled={removendoId === p.user_id}
                    style={{ minHeight: 36, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                      background: C.white, color: C.red, fontSize: 12, fontWeight: 600,
                      cursor: removendoId === p.user_id ? 'default' : 'pointer' }}
                  >
                    {removendoId === p.user_id ? 'Desativando…' : 'Desativar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
