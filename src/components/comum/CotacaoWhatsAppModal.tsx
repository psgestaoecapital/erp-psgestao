'use client'

// FEAT-FORNECEDOR-VENDEDORES-WHATSAPP-v1
// Modal que abre wa.me deep-links pra cada vendedor dos fornecedores
// convidados na cotacao. Custo zero · sem API · open(wa.me/...) em
// nova aba.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, MessageCircle, AlertTriangle } from 'lucide-react'

interface Contato {
  nome: string
  telefone: string
  principal: boolean
  mensagem: string
}
interface FornecedorBloco {
  fornecedor_id: string
  fornecedor_nome: string
  tem_contato: boolean
  contatos: Contato[]
}
interface Dados {
  ok: boolean
  erro?: string
  numero?: string
  fornecedores?: FornecedorBloco[]
}

interface Props {
  cotacaoId: string
  numero: string | null
  onClose: () => void
}

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F',
  white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', goldBg: '#FDF7E8',
  green: '#10B981', greenBg: '#ECFDF5',
  amber: '#C88A1A', amberBg: '#FFF8E1',
  red: '#EF4444',
}

const WA_GREEN = '#25D366'

function abrirWhatsApp(telefone: string, mensagem: string) {
  const url = `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function CotacaoWhatsAppModal({ cotacaoId, numero, onClose }: Props) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error } = await supabase.rpc('fn_cotacao_whatsapp_links', { p_cotacao_id: cotacaoId })
      if (!alive) return
      if (error) { setDados({ ok: false, erro: error.message }); setLoading(false); return }
      setDados(data as Dados)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [cotacaoId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.cream, borderRadius: 12, padding: 22,
          width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
          border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 14, gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>
              Cotação {numero ?? '—'}
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: C.espresso }}>
              Enviar por WhatsApp
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: C.espressoM }}>
              Toque no contato pra abrir o WhatsApp com a mensagem pronta.
            </p>
          </div>
          <button
            onClick={onClose}
            data-testid="cot-wa-fechar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Carregando…</p>
        ) : dados?.ok === false ? (
          <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {dados?.erro ?? 'Falha ao carregar'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(dados?.fornecedores ?? []).map((f) => (
              <div key={f.fornecedor_id} style={{
                background: C.white, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: 12,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.espresso, marginBottom: 8 }}>
                  {f.fornecedor_nome}
                </div>
                {!f.tem_contato ? (
                  <div style={{
                    padding: 10, background: C.amberBg, color: C.amber, borderRadius: 6,
                    fontSize: 12, display: 'flex', gap: 6, alignItems: 'start',
                  }}>
                    <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>Cadastre um vendedor com WhatsApp neste fornecedor.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {f.contatos.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => abrirWhatsApp(c.telefone, c.mensagem)}
                        data-testid="cot-wa-link"
                        style={{
                          minHeight: 44, padding: '10px 14px', borderRadius: 8,
                          border: `1px solid ${WA_GREEN}`, background: '#fff',
                          color: C.espresso, fontSize: 13, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                        }}
                      >
                        <MessageCircle size={18} color={WA_GREEN} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {c.nome}
                            {c.principal && (
                              <span style={{
                                fontSize: 9, padding: '1px 6px', borderRadius: 4,
                                background: C.goldBg, color: C.gold, fontWeight: 700, letterSpacing: 0.5,
                              }}>PRINCIPAL</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: C.espressoM }}>+{c.telefone}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(dados?.fornecedores ?? []).length === 0 && (
              <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>Nenhum fornecedor convidado ainda.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
