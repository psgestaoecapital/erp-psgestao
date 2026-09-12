'use client'
// DVI público (client) — o cliente vê o diagnóstico com semáforo (severidade), fotos por item, e
// aprova item a item. Envia por fn_os_publico_aprovar (anon, pelo token). Sem R$ escondido: o cliente
// vê o preço de cada item e o total do que aprovou. Mobile-first (abre pelo WhatsApp).
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type ItemPub = { id: string; tipo?: string | null; descricao: string | null; severidade: string | null; quantidade?: number | null; preco?: number | null; aprovado?: boolean | null }
export type FotoPub = { item_id: string | null; url: string | null }

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D', AMBER = '#B45309', GREEN = '#166534'
const brl = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

const SEV = [
  { k: 'critico', dot: '🔴', label: 'CRÍTICO — precisa agora', cor: RED },
  { k: 'recomendado', dot: '🟡', label: 'RECOMENDADO', cor: AMBER },
  { k: 'futuro', dot: '🟢', label: 'FUTURO', cor: GREEN },
] as const

export default function DviPublico({ oficina, os, itens, fotos, token }: {
  oficina: string
  os: { numero?: string | null; placa?: string | null; marca?: string | null; modelo?: string | null; km?: number | null }
  itens: ItemPub[]
  fotos: FotoPub[]
  token: string
}) {
  // pré-seleciona o que já estava aprovado (se o cliente reabrir o link)
  const [sel, setSel] = useState<Set<string>>(() => new Set(itens.filter((i) => i.aprovado === true).map((i) => i.id)))
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState<{ valor: number; itens: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)

  const fotosPorItem = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const f of fotos) { if (f.item_id && f.url) { const a = m.get(f.item_id) ?? []; a.push(f.url); m.set(f.item_id, a) } }
    return m
  }, [fotos])

  const total = useMemo(() => itens.filter((i) => sel.has(i.id)).reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.quantidade) || 1), 0), [itens, sel])
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const confirmar = async () => {
    if (enviando) return
    setEnviando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_os_publico_aprovar', { p_token: token, p_itens_aprovados: Array.from(sel) })
    setEnviando(false)
    const r = data as { ok?: boolean; erro?: string; itens_aprovados?: number; valor?: number } | null
    if (error || !r?.ok) { setErro(r?.erro === 'link_invalido_ou_expirado' ? 'Este link expirou. Peça um novo à oficina.' : 'Não deu pra registrar agora. Tente de novo em instantes.'); return }
    setFeito({ valor: Number(r.valor) || 0, itens: r.itens_aprovados ?? 0 })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const veiculo = [os.marca, os.modelo].filter(Boolean).join(' ')

  return (
    <div style={{ minHeight: '100vh', background: BG, color: ESP, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 120px' }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 800 }}>{oficina}</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '2px 0 2px' }}>
          {os.placa || 'Veículo'}{veiculo ? ` · ${veiculo}` : ''}
        </h1>
        <div style={{ fontSize: 13, color: ESP60, marginBottom: 14 }}>
          {os.numero ? `OS ${os.numero}` : ''}{os.km != null ? ` · ${Number(os.km).toLocaleString('pt-BR')} km` : ''}
        </div>

        {feito ? (
          <div style={{ background: '#fff', border: `1px solid ${GREEN}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '8px 0 4px', color: GREEN }}>Obrigado! A oficina foi avisada.</h2>
            <p style={{ fontSize: 14, color: ESP60 }}>
              {feito.itens > 0 ? <>Você aprovou <b style={{ color: ESP }}>{feito.itens} item(ns)</b> · <b style={{ color: ESP }}>{brl(feito.valor)}</b>.</> : 'Você não aprovou nenhum item por enquanto.'}
              <br />Qualquer dúvida, fale com a oficina.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: ESP60, marginBottom: 14 }}>Veja o que encontramos e escolha o que autorizar. Toque nas fotos para ampliar.</p>
            {SEV.map((g) => {
              const doGrupo = itens.filter((i) => (i.severidade ?? 'futuro') === g.k)
              if (doGrupo.length === 0) return null
              return (
                <div key={g.k} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: g.cor, marginBottom: 8 }}>{g.dot} {g.label}</div>
                  {doGrupo.map((it) => {
                    const fs = fotosPorItem.get(it.id) ?? []
                    const on = sel.has(it.id)
                    return (
                      <div key={it.id} style={{ background: '#fff', border: `1px solid ${on ? g.cor : LINE}`, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{it.descricao}</div>
                        {fs.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            {fs.map((u, k) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={k} src={u} alt="foto do item" referrerPolicy="no-referrer" onClick={() => setZoom(u)}
                                style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in' }} />
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10 }}>
                          <span style={{ fontSize: 16, fontWeight: 800 }}>{it.preco != null ? brl((Number(it.preco) || 0) * (Number(it.quantidade) || 1)) : 'a combinar'}</span>
                          <button onClick={() => toggle(it.id)}
                            style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'pointer',
                              border: `1px solid ${on ? GREEN : LINE}`, background: on ? GREEN : '#fff', color: on ? '#fff' : ESP }}>
                            {on ? '✓ Aprovado' : 'Aprovar'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {itens.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhum item no diagnóstico ainda.</div>}
            {erro && <div style={{ fontSize: 13, color: RED, fontWeight: 700, margin: '8px 0' }}>{erro}</div>}
          </>
        )}
      </div>

      {!feito && itens.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '12px 14px' }}>
          <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: ESP60 }}>Aprovados</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>{brl(total)}</div>
            </div>
            <button onClick={() => void confirmar()} disabled={enviando}
              style={{ minHeight: 52, padding: '0 22px', borderRadius: 12, fontSize: 16, fontWeight: 800, border: 'none', background: GOLD, color: '#3D2314', cursor: enviando ? 'wait' : 'pointer' }}>
              {enviando ? 'Enviando…' : 'Confirmar aprovação'}
            </button>
          </div>
        </div>
      )}

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="foto ampliada" referrerPolicy="no-referrer" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
