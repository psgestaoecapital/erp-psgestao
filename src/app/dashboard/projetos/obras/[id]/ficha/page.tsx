'use client'
// Hub · Gestão de Obras · Ficha da obra — classificação (blueprint vivo tela 314).
// Duas classificações que definem como o financeiro da obra é tratado:
//  • Execução: obra própria × gerenciada para terceiros. [escopo 2]
//  • Modelo de contratação: administração, empreitada global, empreitada por preço unitário, outro.
// Leitura/gravação guardadas por empresa (fn_obra_ficha_ler / fn_obra_ficha_salvar). Aberta pelo cockpit.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/ficha'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const campo = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }

const EXECUCAO = [
  { v: 'propria', l: 'Própria — da própria empresa' },
  { v: 'terceiros', l: 'Para terceiros — gerenciada para o contratante' },
]
const MODELOS = [
  { v: 'administracao', l: 'Administração (taxa sobre o custo)' },
  { v: 'empreitada_global', l: 'Empreitada global (preço fechado)' },
  { v: 'empreitada_preco_unitario', l: 'Empreitada por preço unitário (por item medido)' },
  { v: 'outro', l: 'Outro' },
]

type Ficha = { ok: boolean; numero?: string; nome?: string | null; cliente_nome?: string | null; tipo_execucao?: string | null; modelo_contratacao?: string | null; erro?: string }

export default function FichaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [numero, setNumero] = useState<string | null>(null)
  const [nome, setNome] = useState<string | null>(null)
  const [cliente, setCliente] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [modelo, setModelo] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_ficha_ler', { p_obra_id: id })
    setLoading(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar a ficha da obra.')); return }
    setNumero(j.numero ?? null); setNome(j.nome ?? null); setCliente(j.cliente_nome ?? null)
    setTipo(j.tipo_execucao ?? ''); setModelo(j.modelo_contratacao ?? '')
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const salvar = async () => {
    setBusy(true); setErro(null); setOk(false)
    const { data, error } = await supabase.rpc('fn_obra_ficha_salvar', {
      p_obra_id: id, p_tipo_execucao: tipo || null, p_modelo_contratacao: modelo || null,
    })
    setBusy(false)
    const j = data as Ficha | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar a ficha.')); return }
    setOk(true)
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }} data-testid="hub-obra-ficha">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Ficha da obra</h1>
        {(numero || nome || cliente) && (
          <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>{[numero && `${numero}${nome ? ` — ${nome}` : ''}`, cliente].filter(Boolean).join(' · ')}</div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Execução da obra<AjudaCampo chave="projetos.obra_ficha.tipo_execucao" rota={ROTA} /></span>
                  <select data-testid="ficha-tipo-execucao" style={campo} value={tipo} onChange={(e) => { setTipo(e.target.value); setOk(false) }}>
                    <option value="">Não classificada</option>
                    {EXECUCAO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span>Modelo de contratação<AjudaCampo chave="projetos.obra_ficha.modelo_contratacao" rota={ROTA} /></span>
                  <select data-testid="ficha-modelo-contratacao" style={campo} value={modelo} onChange={(e) => { setModelo(e.target.value); setOk(false) }}>
                    <option value="">Não informado</option>
                    {MODELOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
                <div style={{ fontSize: 11, color: MUT }}>A classificação alimenta o resultado por obra e orienta como medir e faturar. Pode ser ajustada a qualquer momento.</div>
              </div>

              {erro && <div role="alert" data-testid="ficha-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}
              {ok && <div data-testid="ficha-ok" style={{ background: '#EAF6EC', color: VERDE, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }}>Classificação salva.</div>}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button data-testid="ficha-salvar" disabled={busy} onClick={() => void salvar()}
                  style={{ flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? 'Salvando…' : 'Salvar classificação'}
                </button>
                <AjudaCampo chave="projetos.obra_ficha.salvar" rota={ROTA} />
              </div>
            </div>
          )}
      </div>
    </div>
  )
}
