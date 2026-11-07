'use client'

// Hub · Gestão de Obras · Portal do cliente (H9) — ETAPA (b): a EQUIPE convida/revoga o acesso do cliente.
// Decisão CEO 30/10: o cliente da obra acompanha avanço, fotos, medições e faturas pelo portal (só leitura).
// Aqui a equipe liga o login de um cliente a ESTA obra. A segurança é no banco: as RPCs
// (fn_obra_cliente_acesso_listar/_conceder/_revogar, #PR deste código) são SECURITY DEFINER com guarda de empresa —
// só agem sobre obra de uma empresa do próprio usuário. Um cliente convidado passa a ver só esta obra, nunca outra
// (fn_obra_portal_minhas_obras filtra por auth.uid()). RD-95: "?" em todo campo/ação. RD-96/RD-100: layout e
// linguagem próprios. Celular 390px: coluna única, alvos de toque confortáveis.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/projetos/obras/[id]/portal-cliente'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

// A camada de dados pode chegar à produção depois desta tela; enquanto não chegar, PostgREST responde
// "function/relation does not exist". RD-98: degrada para aviso de "recurso sendo liberado".
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) return true
  return /does not exist|not found|schema cache/.test(msg)
}

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

type Obra = { id: string; nome: string | null; numero: string | null }
type Acesso = {
  id: string; user_id: string; email: string; nome: string; papel: string
  ativo: boolean; criado_em: string; convidado_por_nome: string | null
  revogado_em: string | null; revogado_motivo: string | null
}

export default function PortalClienteObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [acessos, setAcessos] = useState<Acesso[]>([])
  const [carregando, setCarregando] = useState(true)
  const [emLiberacao, setEmLiberacao] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [email, setEmail] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const { data: od } = await supabase
        .from('projetos_obras').select('id,nome,numero').eq('id', id).maybeSingle()
      if (od) setObra(od as Obra)

      const { data, error } = await supabase.rpc('fn_obra_cliente_acesso_listar', { p_obra_id: id })
      if (error) {
        if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
        throw error
      }
      setAcessos((data ?? []) as Acesso[])
    } catch (e) {
      setErro(erroAmigavel(e, 'Não foi possível carregar os acessos do portal.'))
    } finally {
      setCarregando(false)
    }
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  const convidar = useCallback(async () => {
    const alvo = email.trim()
    if (!alvo) { setErro('Informe o e-mail do cliente.'); return }
    setSalvando(true); setErro(''); setAviso('')
    try {
      const { error } = await supabase.rpc('fn_obra_cliente_acesso_conceder', { p_obra_id: id, p_email: alvo })
      if (error) throw error
      setEmail(''); setAviso(`Convite enviado para ${alvo}. O cliente já vê esta obra no portal.`)
      await carregar()
    } catch (e) {
      setErro(erroAmigavel(e, 'Não foi possível convidar o cliente.'))
    } finally {
      setSalvando(false)
    }
  }, [email, id, carregar])

  const revogar = useCallback(async (a: Acesso) => {
    const motivo = typeof window !== 'undefined'
      ? window.prompt(`Revogar o acesso de ${a.nome} a esta obra?\nMotivo (opcional):`, '')
      : ''
    if (motivo === null) return // cancelou
    setErro(''); setAviso('')
    try {
      const { error } = await supabase.rpc('fn_obra_cliente_acesso_revogar', { p_acesso_id: a.id, p_motivo: motivo || null })
      if (error) throw error
      setAviso(`Acesso de ${a.nome} revogado.`)
      await carregar()
    } catch (e) {
      setErro(erroAmigavel(e, 'Não foi possível revogar o acesso.'))
    }
  }, [carregar])

  const ativos = useMemo(() => acessos.filter((a) => a.ativo), [acessos])
  const revogados = useMemo(() => acessos.filter((a) => !a.ativo), [acessos])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4 }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, color: ESP, background: BG, width: '100%' }
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', minHeight: 44 })

  const linhaAcesso = (a: Acesso) => (
    <div key={a.id} style={{ ...card, padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} data-testid={`acesso-${a.email}`}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: ESP, fontSize: 14 }}>{a.nome}</div>
        <div style={{ fontSize: 12, color: MUT, overflowWrap: 'anywhere' }}>{a.email}</div>
        <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>
          {a.ativo
            ? `Convidado em ${fmtData(a.criado_em)}${a.convidado_por_nome ? ` por ${a.convidado_por_nome}` : ''}`
            : `Revogado em ${fmtData(a.revogado_em)}${a.revogado_motivo ? ` — ${a.revogado_motivo}` : ''}`}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: a.ativo ? VERDE : MUT, background: a.ativo ? 'rgba(46,125,50,0.1)' : 'rgba(61,35,20,0.06)', padding: '4px 10px', borderRadius: 20 }}>
        {a.ativo ? 'Com acesso' : 'Revogado'}
      </span>
      {a.ativo && (
        <button onClick={() => void revogar(a)} style={{ ...btn('transparent', VERM), border: `1px solid ${VERM}`, padding: '8px 14px' }} data-testid={`revogar-${a.email}`}>
          Revogar
        </button>
      )}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Portal do cliente</h1>
          {obra?.nome && <span style={{ fontSize: 14, color: MUT }}>{obra.numero ? `${obra.numero} · ` : ''}{obra.nome}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Convide o cliente desta obra para acompanhar, só de leitura, o avanço, as fotos do diário, as medições e as faturas — e aprovar revisões. Cada cliente vê apenas esta obra; nunca custo, margem ou obra de outro cliente.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }} data-testid="erro">{erro}</div>}
        {aviso && <div style={{ ...card, borderColor: VERDE, color: VERDE, marginTop: 14, fontSize: 13 }} data-testid="aviso">{aviso}</div>}

        {emLiberacao ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Portal do cliente sendo liberado para esta empresa. Atualize em instantes.</div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : (
          <>
            {/* Convidar */}
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ ...lbl, marginBottom: 8 }}>Convidar cliente <AjudaCampo chave="obra.portal.email_cliente" rota={ROTA} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="email" inputMode="email" autoComplete="off" placeholder="e-mail do cliente"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void convidar() }}
                  style={{ ...inp, flex: '1 1 260px' }} data-testid="portal-email"
                />
                <button onClick={() => void convidar()} disabled={salvando || !email.trim()} style={{ ...btn(GOLD, ESP), opacity: salvando || !email.trim() ? 0.6 : 1 }} data-testid="portal-convidar">
                  {salvando ? 'Convidando…' : 'Convidar'}
                </button>
                <AjudaCampo chave="obra.portal.convidar_acao" rota={ROTA} />
              </div>
              <div style={{ fontSize: 12, color: MUT, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                Papel: Cliente da obra (leitura + aprovação de revisão) <AjudaCampo chave="obra.portal.papel" rota={ROTA} />
              </div>
              <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>
                O cliente precisa já ter um login no sistema. Se ainda não tiver, crie o acesso dele antes de convidar.
              </div>
            </div>

            {/* Lista */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: ESP, margin: 0 }}>Clientes com acesso</h2>
              <AjudaCampo chave="obra.portal.lista_acessos" rota={ROTA} />
              <span style={{ fontSize: 12, color: MUT }}>({ativos.length} ativo{ativos.length === 1 ? '' : 's'})</span>
              <span style={{ flex: 1 }} />
              <AjudaCampo chave="obra.portal.revogar_acao" rota={ROTA} alinhar="fim" />
            </div>

            {ativos.length === 0 && revogados.length === 0 ? (
              <div style={{ ...card, marginTop: 12, color: MUT, fontSize: 13 }}>
                Nenhum cliente tem acesso ao portal desta obra ainda. Convide o cliente pelo e-mail acima para ele começar a acompanhar.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                {ativos.map(linhaAcesso)}
                {revogados.length > 0 && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: MUT, marginTop: 8 }}>Acessos revogados (histórico)</div>
                )}
                {revogados.map(linhaAcesso)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
