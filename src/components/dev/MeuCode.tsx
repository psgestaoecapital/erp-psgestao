'use client'
// Canal PS (CEO 07/10 16:20) · painel "Meu Code" na aba Codes: o sócio dono de um Code pede direto ao SEU Code (sem passar
// pelo CEO nem pelo Eng. Chefe) e acompanha as respostas. Usa a MESMA fn_agente_pedido_enviar da Claude do sócio (Canal PS)
// e a fn_agente_pedidos_meus; a lista se atualiza sozinha pelo Realtime da caixa (erp_agente_mensagem, RLS da equipe PS).
// Quem não é dono de Code não vê nada aqui.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { quando } from '@/lib/dev/painelCodes'

const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const REPO = 'https://github.com/psgestaoecapital/erp-psgestao/pull/'

type Pedido = {
  id: string; assunto: string; status: string; pr_numero: number | null; resposta: string | null
  requer_ok_ceo: boolean; ok_ceo_em: string | null; chamado_numero: number | null; empresa_id: string | null
  acionamento: string | null; acionou: boolean | null; criado_em: string; atualizado_em: string | null
}
type Meus = { ok: boolean; tem_code: boolean; agente?: string; ativo?: boolean; remetente?: string
  carteira?: { company_id: string; nome: string }[]; pedidos: Pedido[] }

const STATUS: Record<string, string> = { nova: 'na fila', recebida: 'recebido', em_andamento: 'em andamento', concluida: 'concluído', recusada: 'recusado' }

export default function MeuCode() {
  const [meus, setMeus] = useState<Meus | null>(null)
  const [assunto, setAssunto] = useState('')
  const [texto, setTexto] = useState('')
  const [chamado, setChamado] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [nucleo, setNucleo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [agora, setAgora] = useState(() => new Date())

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_agente_pedidos_meus', { p_limite: 30 })
    if (!error && data) { setMeus(data as Meus); setAgora(new Date()) }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const agendar = (ms = 500) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void carregar() }, ms) }
    agendar(0)
    const ch = supabase.channel('dev-meu-code')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_mensagem' }, () => agendar())
      .subscribe()
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [carregar])

  if (!meus?.tem_code) return null

  const enviar = async () => {
    setEnviando(true); setAviso(null)
    const n = chamado.trim() ? Number(chamado.trim().replace(/^#/, '')) : null
    const { data, error } = await supabase.rpc('fn_agente_pedido_enviar', {
      p_assunto: assunto, p_corpo: texto, p_chamado_numero: Number.isFinite(n) ? n : null,
      p_empresa_id: empresa || null, p_nucleo: nucleo,
    })
    const r = data as { ok?: boolean; mensagem?: string } | null
    if (error || !r?.ok) setAviso({ ok: false, texto: r?.mensagem || error?.message || 'Não consegui enviar.' })
    else { setAviso({ ok: true, texto: r.mensagem || 'Pedido enviado.' }); setAssunto(''); setTexto(''); setChamado(''); setEmpresa(''); setNucleo(false) }
    setEnviando(false)
    void carregar()
  }

  const campo = { border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 10px', color: ESP, background: OFF, fontFamily: 'inherit', fontSize: 13, width: '100%' } as const

  return (
    <div data-testid="meu-code" style={{ background: BRANCO, border: `2px solid ${DOU}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Meu Code · {meus.agente}</span>
        {!meus.ativo && <span style={{ fontSize: 11, color: TXM }}>ainda não ativo no Canal PS (peça ao CEO)</span>}
      </div>

      {meus.ativo && (
        <div data-testid="meu-code-form" style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TXM, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pedir ao meu Code</div>
          <input data-testid="meu-code-assunto" placeholder="Assunto" value={assunto} maxLength={200} onChange={(e) => setAssunto(e.target.value)} style={campo} />
          <textarea data-testid="meu-code-texto" placeholder="O que o Code deve fazer" value={texto} rows={4} onChange={(e) => setTexto(e.target.value)} style={{ ...campo, resize: 'vertical' }} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input data-testid="meu-code-chamado" placeholder="Chamado nº (opcional)" inputMode="numeric" value={chamado} onChange={(e) => setChamado(e.target.value)} style={campo} />
            <select data-testid="meu-code-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={campo}>
              <option value="">Empresa da carteira (opcional)</option>
              {(meus.carteira ?? []).map((c) => <option key={c.company_id} value={c.company_id}>{c.nome}</option>)}
            </select>
          </div>
          <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input data-testid="meu-code-nucleo" type="checkbox" checked={nucleo} onChange={(e) => setNucleo(e.target.checked)} />
            Mexe no núcleo (permissão, RLS, fiscal…): espera o OK do CEO antes de ir ao Code
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button data-testid="meu-code-enviar" disabled={enviando || !assunto.trim() || !texto.trim()} onClick={() => void enviar()}
              style={{ background: ESP, color: OFF, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Enviando…' : 'Enviar ao meu Code'}
            </button>
            {aviso && <span data-testid="meu-code-aviso" data-ok={aviso.ok ? 'sim' : 'nao'} style={{ fontSize: 13, color: aviso.ok ? ESP : '#B91C1C' }}>{aviso.texto}</span>}
          </div>
        </div>
      )}

      <div data-testid="meu-code-pedidos" style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: TXM, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Meus pedidos</div>
        {meus.pedidos.length === 0 ? <div style={{ fontSize: 12, color: TXM }}>nenhum pedido ainda</div> : meus.pedidos.map((p) => (
          <div key={p.id} data-testid={`meu-pedido-${p.id}`} style={{ borderTop: `1px solid ${BD}`, padding: '8px 0', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span style={{ color: TXM }}>{quando(p.criado_em, agora)}</span>
              <b>{p.assunto}</b>
              <span style={{ fontSize: 11, border: `1px solid ${BD}`, borderRadius: 999, padding: '1px 8px' }}>
                {p.requer_ok_ceo && !p.ok_ceo_em ? 'esperando OK do CEO' : STATUS[p.status] ?? p.status}
              </span>
              {p.chamado_numero && <span style={{ color: TXM }}>chamado #{p.chamado_numero}</span>}
              {p.pr_numero && <a href={`${REPO}${p.pr_numero}`} target="_blank" rel="noreferrer" style={{ color: DOU, fontWeight: 700 }}>PR #{p.pr_numero}</a>}
            </div>
            {p.resposta && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: ESP }}>{p.resposta}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
