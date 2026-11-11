'use client'

// Hub · Gestão de Obras · Portal do cliente (H9 · Decisão CEO 30/10) — ETAPA (c): a VISÃO DO CLIENTE.
// Aqui o cliente convidado (papel "cliente da obra") faz login e vê a lista das obras liberadas PARA ELE.
// V1 só leitura. A segurança é 100% no banco: fn_obra_portal_minhas_obras() retorna SOMENTE as obras com
// acesso ativo do auth.uid() (JOIN erp_obra_cliente_acesso WHERE user_id = auth.uid() AND revogado_em IS NULL).
// Um cliente NUNCA vê obra de outro, nem custo/margem — só o acompanhamento. Rota autenticada: sem login a
// função não devolve nada (auth.uid() nulo) e a tela manda para /login. Nunca é link público.
// RD-95: "?" nos indicadores. RD-96/RD-100: layout e linguagem próprios. Celular 390px: coluna única.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/portal/obras'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

type Obra = {
  obra_id: string; numero: string | null; nome: string | null; status: string | null
  pct_conclusao: number | null; data_inicio: string | null; data_prevista_fim: string | null
  cidade: string | null; uf: string | null; cliente_nome: string | null
}

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const pct = (v: number | null | undefined) => `${Math.round(Number(v ?? 0))}%`
const rotuloStatus = (s: string | null) => {
  const m: Record<string, string> = { em_andamento: 'Em andamento', planejada: 'Planejada', concluida: 'Concluída', paralisada: 'Paralisada' }
  return s ? (m[s] ?? s) : '—'
}

export default function PortalMinhasObrasPage() {
  const router = useRouter()
  const [obras, setObras] = useState<Obra[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      // Rota autenticada: sem sessão não há portal (a decisão do CEO proíbe link público).
      const { data: auth } = await supabase.auth.getUser()
      if (!auth?.user) { router.replace('/login?next=/portal/obras'); return }

      const { data, error } = await supabase.rpc('fn_obra_portal_minhas_obras')
      if (error) throw error
      setObras((data ?? []) as Obra[])
    } catch (e) {
      setErro(erroAmigavel(e, 'Não foi possível carregar suas obras.'))
    } finally {
      setCarregando(false)
    }
  }, [router])

  useEffect(() => { void carregar() }, [carregar])

  const sair = useCallback(async () => {
    try { await supabase.auth.signOut() } catch { /* nada */ }
    router.replace('/login')
  }, [router])

  const ativas = useMemo(() => obras.filter((o) => o.status !== 'concluida'), [obras])
  const concluidas = useMemo(() => obras.filter((o) => o.status === 'concluida'), [obras])

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }

  const cardObra = (o: Obra) => (
    <Link
      key={o.obra_id}
      href={`/portal/obras/${o.obra_id}`}
      data-testid={`obra-${o.numero ?? o.obra_id}`}
      style={{ ...card, display: 'block', textDecoration: 'none', color: ESP }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: ESP }}>{o.nome || 'Obra'}</span>
        {o.numero && <span style={{ fontSize: 12, color: MUT }}>{o.numero}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: o.status === 'concluida' ? VERDE : GOLD, background: o.status === 'concluida' ? 'rgba(46,125,50,0.1)' : 'rgba(200,148,26,0.12)', padding: '3px 10px', borderRadius: 20 }}>
          {rotuloStatus(o.status)}
        </span>
      </div>
      {(o.cidade || o.uf) && (
        <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{[o.cidade, o.uf].filter(Boolean).join(' · ')}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: GOLD }}>{pct(o.pct_conclusao)}</span>
        <span style={{ fontSize: 12, color: MUT }}>concluído</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: MUT }}>{fmtData(o.data_inicio)} → {fmtData(o.data_prevista_fim)}</span>
      </div>
      <div style={{ height: 8, background: 'rgba(61,35,20,0.08)', borderRadius: 6, marginTop: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(o.pct_conclusao ?? 0)))}%`, background: GOLD }} />
      </div>
      <div style={{ fontSize: 12, color: GOLD, fontWeight: 700, marginTop: 12 }}>Ver acompanhamento →</div>
    </Link>
  )

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Minhas obras</h1>
          <AjudaCampo chave="portal.obras.lista" rota={ROTA} />
          <span style={{ flex: 1 }} />
          <button onClick={() => void sair()} style={{ background: 'transparent', color: MUT, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 40 }} data-testid="portal-sair">
            Sair
          </button>
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Acompanhe, de leitura, o andamento das suas obras: avanço, fotos do diário e medições. Toque numa obra para ver os detalhes.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }} data-testid="erro">{erro}</div>}

        {carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando suas obras…</div>
        ) : obras.length === 0 ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }} data-testid="portal-vazio">
            Você ainda não tem nenhuma obra liberada para acompanhar. Peça à construtora o convite de acesso ao portal — assim que ela liberar, a obra aparece aqui.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }} data-testid="portal-obras">
            {ativas.map(cardObra)}
            {concluidas.length > 0 && (
              <div style={{ fontSize: 12, fontWeight: 700, color: MUT, marginTop: 8 }}>Obras concluídas</div>
            )}
            {concluidas.map(cardObra)}
          </div>
        )}
      </div>
    </div>
  )
}
