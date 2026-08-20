'use client'

// Config da numeração de orçamento por empresa (prefixo, incluir ano, próximo número).
// Lê/grava erp_orcamento_numeracao; a next_orcamento_numero usa esses valores (RD-52).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  companyId: string
  onClose: () => void
}

export default function NumeracaoConfigModal({ companyId, onClose }: Props) {
  const [prefixo, setPrefixo] = useState('ORC')
  const [incluirAno, setIncluirAno] = useState(true)
  const [proximo, setProximo] = useState('1')
  const [padding, setPadding] = useState('4')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase
        .from('erp_orcamento_numeracao')
        .select('prefixo,incluir_ano,proximo_numero,padding')
        .eq('company_id', companyId)
        .maybeSingle()
      if (!alive) return
      if (data) {
        setPrefixo(data.prefixo ?? 'ORC')
        setIncluirAno(data.incluir_ano ?? true)
        setProximo(String(data.proximo_numero ?? 1))
        setPadding(String(data.padding ?? 4))
      }
      setCarregando(false)
    })()
    return () => { alive = false }
  }, [companyId])

  // Preview do próximo número (piso: pode sair maior se já houver número acima no formato).
  useEffect(() => {
    const ano = new Date().getFullYear()
    const pre = `${prefixo || 'ORC'}${incluirAno ? '-' + ano : ''}-`
    const n = Math.max(parseInt(proximo || '1', 10) || 1, 1)
    setPreview(pre + String(n).padStart(Math.max(parseInt(padding || '4', 10) || 4, 1), '0'))
  }, [prefixo, incluirAno, proximo, padding])

  async function salvar() {
    setSalvando(true); setMsg(null)
    const { error } = await supabase.from('erp_orcamento_numeracao').upsert({
      company_id: companyId,
      prefixo: (prefixo || 'ORC').trim(),
      incluir_ano: incluirAno,
      proximo_numero: Math.max(parseInt(proximo || '1', 10) || 1, 1),
      padding: Math.max(parseInt(padding || '4', 10) || 4, 1),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    setSalvando(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    onClose()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 460, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#3D2314' }}>Numeração do orçamento</h3>
        <p style={{ margin: '0 0 14px', fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>
          Define o formato e de qual número a sequência começa. Vale só para esta empresa.
        </p>
        {carregando ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'rgba(61,35,20,0.5)' }}>Carregando…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 11, color: '#3D2314' }}>Prefixo
                <input value={prefixo} onChange={(e) => setPrefixo(e.target.value.slice(0, 10))} style={inp} />
              </label>
              <label style={{ fontSize: 11, color: '#3D2314' }}>Começar do número
                <input type="number" min={1} value={proximo} onChange={(e) => setProximo(e.target.value)} style={inp} />
              </label>
              <label style={{ fontSize: 11, color: '#3D2314' }}>Dígitos (padding)
                <input type="number" min={1} max={8} value={padding} onChange={(e) => setPadding(e.target.value)} style={inp} />
              </label>
              <label style={{ fontSize: 11, color: '#3D2314', display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
                <input type="checkbox" checked={incluirAno} onChange={(e) => setIncluirAno(e.target.checked)} /> Incluir o ano
              </label>
            </div>
            <div style={{ marginTop: 14, padding: '8px 10px', background: '#FAF7F2', borderRadius: 6, fontSize: 12, color: '#3D2314' }}>
              Próximo: <strong style={{ fontFamily: 'monospace' }}>{preview}</strong>
              <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                É um piso: se já existir número maior neste formato, o próximo continua a partir dele (não colide).
              </div>
            </div>
            {msg && <div style={{ marginTop: 10, fontSize: 11, color: '#B91C1C' }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={onClose} disabled={salvando} style={{ ...btn, background: 'transparent', color: '#3D2314', border: '1px solid rgba(61,35,20,0.15)' }}>Cancelar</button>
              <button onClick={salvar} disabled={salvando} style={{ ...btn, background: '#C8941A', color: '#fff', border: 'none' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', marginTop: 4, padding: '7px 9px', fontSize: 13, border: '1px solid rgba(61,35,20,0.15)', borderRadius: 6, outline: 'none' }
const btn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
