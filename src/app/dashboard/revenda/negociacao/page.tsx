'use client'

// Revenda · R5b — Negociação (Tela 9). Lista as negociações por estado e abre uma para compor.
// "Nova negociação" nasce de um veículo do pátio (disponível/reservado). A composição, o simulador,
// a alçada e o COAF vivem na tela [id] — aqui é só a fila. Paleta PS; sem cálculo na tela (RD-65).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null) => v == null ? '—' : (v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''

type Neg = {
  id: string; veiculo_id: string; cliente_nome: string | null; vendedor_nome: string | null
  estado: string; validade: string | null; preco_pedido: number | null; desconto: number
  motivo_perda: string | null; venda_id: string | null; created_at: string
  marca?: string | null; modelo?: string | null; chassi?: string | null
}
type Veic = { id: string; marca: string | null; modelo: string | null; chassi: string; situacao: string; preco_venda: number | null }

const ESTADO_LABEL: Record<string, string> = { aberta: 'Abertas', fechada: 'Fechadas', perdida: 'Perdidas' }
const ESTADO_COR: Record<string, { fg: string; bg: string }> = {
  aberta: { fg: C.amber, bg: C.amberBg }, fechada: { fg: C.green, bg: C.greenBg }, perdida: { fg: C.red, bg: C.redBg },
}

export default function NegociacaoListaPage() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Neg[]>([])
  const [loading, setLoading] = useState(true)
  const [novoOpen, setNovoOpen] = useState(false)
  const [veiculos, setVeiculos] = useState<Veic[]>([])
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('veic_negociacao')
      .select('id, veiculo_id, cliente_nome, vendedor_nome, estado, validade, preco_pedido, desconto, motivo_perda, venda_id, created_at, veic_veiculo(marca, modelo, chassi)')
      .eq('company_id', companyId).order('created_at', { ascending: false })
    const norm: Neg[] = (data ?? []).map((r: Record<string, unknown>) => {
      const v = (r.veic_veiculo ?? {}) as { marca?: string; modelo?: string; chassi?: string }
      return { ...(r as unknown as Neg), marca: v.marca ?? null, modelo: v.modelo ?? null, chassi: v.chassi ?? null }
    })
    setRows(norm); setLoading(false)
  }, [companyId])
  useEffect(() => { void load() }, [load])

  async function abrirNovo() {
    if (!companyId) return
    setErro(null)
    const { data } = await supabase.from('veic_veiculo')
      .select('id, marca, modelo, chassi, situacao, preco_venda')
      .eq('company_id', companyId).eq('ativo', true).in('situacao', ['disponivel', 'reservado'])
      .order('created_at', { ascending: false })
    setVeiculos((data ?? []) as Veic[]); setNovoOpen(true)
  }

  async function criar(veic: Veic) {
    if (!companyId || criando) return
    setCriando(true); setErro(null)
    const { data, error } = await supabase.from('veic_negociacao')
      .insert({ company_id: companyId, veiculo_id: veic.id, estado: 'aberta', preco_pedido: veic.preco_venda })
      .select('id').single()
    setCriando(false)
    if (error || !data) { setErro('Não foi possível abrir a negociação.'); return }
    router.push(`/dashboard/revenda/negociacao/${data.id}`)
  }

  const grupos = useMemo(() => {
    const g: Record<string, Neg[]> = { aberta: [], fechada: [], perdida: [] }
    for (const r of rows) (g[r.estado] ??= []).push(r)
    return g
  }, [rows])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.esp, margin: 0 }}>Negociação</h1>
          <button onClick={abrirNovo} style={{ padding: '10px 16px', background: C.gold, color: C.white, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Nova negociação</button>
        </div>
        <p style={{ color: C.espM, fontSize: 13, margin: '2px 0 18px' }}>Componha o negócio, veja o lucro real ao vivo e feche gerando a venda na GE.</p>
        {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {loading ? <div style={{ color: C.espM }}>Carregando…</div> :
          (['aberta', 'fechada', 'perdida'] as const).map(est => (
            <section key={est} style={{ marginBottom: 22 }}>
              <h2 style={{ fontSize: 13, fontWeight: 800, color: C.espM, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 8px' }}>
                {ESTADO_LABEL[est]} <span style={{ color: C.espL }}>({grupos[est].length})</span>
              </h2>
              {grupos[est].length === 0 ? <div style={{ color: C.espL, fontSize: 13 }}>Nenhuma.</div> :
                <div style={{ display: 'grid', gap: 8 }}>
                  {grupos[est].map(n => (
                    <button key={n.id} onClick={() => router.push(`/dashboard/revenda/negociacao/${n.id}`)}
                      style={{ textAlign: 'left', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: C.esp, fontSize: 14 }}>{[n.marca, n.modelo].filter(Boolean).join(' ') || 'Veículo'}</div>
                        <div style={{ color: C.espM, fontSize: 12, marginTop: 2 }}>
                          {n.cliente_nome || 'Sem cliente'}{n.vendedor_nome ? ` · ${n.vendedor_nome}` : ''}
                          {est === 'aberta' && n.validade ? ` · vale até ${brDate(n.validade)}` : ''}
                          {est === 'perdida' && n.motivo_perda ? ` · ${n.motivo_perda}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: C.esp, fontSize: 14 }}>{brl(n.preco_pedido != null ? Number(n.preco_pedido) - Number(n.desconto || 0) : null)}</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: ESTADO_COR[est].fg, background: ESTADO_COR[est].bg, padding: '2px 8px', borderRadius: 20 }}>{est}</span>
                      </div>
                    </button>
                  ))}
                </div>}
            </section>
          ))}
      </div>

      {novoOpen && (
        <div onClick={() => setNovoOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 620, maxHeight: '80vh', overflow: 'auto', padding: 20 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: C.esp, margin: '0 0 4px' }}>Nova negociação</h2>
            <p style={{ color: C.espM, fontSize: 13, margin: '0 0 14px' }}>Escolha o veículo do pátio para começar.</p>
            {veiculos.length === 0 ? <div style={{ color: C.espL, fontSize: 13 }}>Nenhum veículo disponível/reservado no pátio.</div> :
              <div style={{ display: 'grid', gap: 8 }}>
                {veiculos.map(v => (
                  <button key={v.id} disabled={criando} onClick={() => criar(v)}
                    style={{ textAlign: 'left', background: C.cream, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: C.esp, fontWeight: 600, fontSize: 13 }}>{[v.marca, v.modelo].filter(Boolean).join(' ') || v.chassi}</span>
                    <span style={{ color: C.espM, fontSize: 13 }}>{brl(v.preco_venda)}</span>
                  </button>
                ))}
              </div>}
            <button onClick={() => setNovoOpen(false)} style={{ marginTop: 16, padding: '9px 16px', background: C.cream, color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}
