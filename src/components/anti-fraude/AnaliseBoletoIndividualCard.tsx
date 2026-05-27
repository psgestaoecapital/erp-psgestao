'use client'

// Anti-Fraude · Análise individual de boleto (Sub-frente 5.2 Onda 5)
// Componente reusável que chama fn_anti_fraude_boleto_analisar.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Resultado {
  score: number
  classificacao: string
  recomendacao: string
  banco_emissor: string | null
  valor_historico_medio_fornecedor: number | null
  alertas: Array<{ tipo: string; semaforo: string; msg: string }>
}

function corPorScore(s: number): string {
  if (s >= 80) return '#3B6D11'
  if (s >= 60) return '#BA7517'
  if (s >= 30) return '#C8941A'
  return '#A32D2D'
}

export default function AnaliseBoletoIndividualCard() {
  const [codigo, setCodigo] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [descricao, setDescricao] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function analisar() {
    setErro(null)
    if (codigo.replace(/\D/g, '').length < 40) {
      setErro('Código de barras precisa ter pelo menos 40 dígitos')
      return
    }
    if (!valor || Number(valor) <= 0) {
      setErro('Informe o valor do boleto')
      return
    }
    setLoading(true)
    setResultado(null)
    const { data, error } = await supabase.rpc('fn_anti_fraude_boleto_analisar', {
      p_codigo_barras: codigo.replace(/\D/g, ''),
      p_valor: Number(valor),
      p_fornecedor_id: null,
      p_data_vencimento: vencimento || null,
      p_descricao: descricao || null,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    setResultado(data as Resultado)
  }

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }}>
            Analisar boleto individual
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', margin: '4px 0 0' }}>
            Cole o código de barras antes de pagar · IA avalia banco emissor, valor histórico, divergências
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 14 }}>
        <Field label="Código de barras (44 dígitos)">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="00190 5000 9 54044 4444 2012 3456 7891 0 00000 1234 500"
            style={input}
            inputMode="numeric"
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <Field label="Valor R$">
            <input
              type="number" step="0.01" min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              style={input}
            />
          </Field>
          <Field label="Vencimento">
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={input} />
          </Field>
          <Field label="Descrição (opcional)">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Aluguel, fornecedor..."
              style={input}
            />
          </Field>
        </div>
      </div>

      <button onClick={analisar} disabled={loading} style={primaryBtn(loading)}>
        {loading ? 'Analisando…' : 'Analisar'}
      </button>

      {erro && (
        <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 12 }}>
          {erro}
        </div>
      )}

      {resultado && (
        <div style={{ marginTop: 16, border: `1px solid ${corPorScore(resultado.score)}`, borderRadius: 8, padding: 16, background: '#FAF7F2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>
                Classificação
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: corPorScore(resultado.score), marginTop: 4 }}>
                {resultado.classificacao}
              </div>
              <div style={{ fontSize: 13, color: '#3D2314', marginTop: 6 }}>
                {resultado.recomendacao}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>
                Score
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: corPorScore(resultado.score), lineHeight: 1, marginTop: 4 }}>
                {resultado.score}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)' }}>/ 100</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
            <Meta label="Banco emissor" valor={resultado.banco_emissor ?? '—'} />
            <Meta
              label="Histórico médio fornecedor"
              valor={resultado.valor_historico_medio_fornecedor != null
                ? `R$ ${resultado.valor_historico_medio_fornecedor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                : '—'}
            />
          </div>

          {resultado.alertas?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
                Alertas ({resultado.alertas.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {resultado.alertas.map((a, i) => (
                  <div key={i} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.08)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#3D2314' }}>
                    <span style={{ marginRight: 6 }}>{a.semaforo}</span>
                    <strong>{a.tipo}:</strong> {a.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

function Meta({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.08)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#3D2314', marginTop: 2, fontWeight: 600 }}>{valor}</div>
    </div>
  )
}

const input: React.CSSProperties = {
  width: '100%', background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6,
  padding: '8px 10px', fontSize: 13, color: '#3D2314',
  fontFamily: 'inherit', boxSizing: 'border-box',
}

function primaryBtn(loading: boolean): React.CSSProperties {
  return {
    background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A',
    color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
  }
}
