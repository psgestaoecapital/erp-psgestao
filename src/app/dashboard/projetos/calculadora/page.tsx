'use client'

// Hub · HB2 · Calculadora de Obra (fatia 2) — parede simples e forro F530 sobre o motor com regras como dado.
// Só cálculo local, sem gravar. "Ver a conta" em cada item; quantidade a comprar já arredondada por embalagem.
import { useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede } from '@/lib/calculadora/motor'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.6)', VERM = '#B91C1C'
const num = (s: string) => Number(s.replace(',', '.'))
const campo: React.CSSProperties = { width: '100%', padding: '12px 14px', fontSize: 16, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff', color: ESP }
const rotulo: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 6 }

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<'parede' | 'forro'>('parede')
  const [comprimento, setComprimento] = useState('12,5')
  const [peDireito, setPeDireito] = useState('2,8')
  const [vaos, setVaos] = useState('1,68')
  const [largura, setLargura] = useState('3')
  const [aberto, setAberto] = useState<string | null>(null)

  const res = useMemo(() => sistema === 'parede'
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: num(comprimento), peDireito: num(peDireito), vaos: vaos.trim() ? num(vaos) : 0 })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: num(largura), comprimento: num(comprimento) }),
  [sistema, comprimento, peDireito, vaos, largura])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px', color: ESP }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Calculadora de Obra</h1>
        <p style={{ color: MUT, margin: '6px 0 20px' }}>Informe as medidas e veja o que comprar. Cada quantidade tem a conta aberta.</p>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }}>
          <label>
            <span style={rotulo}>Sistema <AjudaCampo chave="hub.calculadora.sistema" /></span>
            <select aria-label="Sistema" style={campo} value={sistema} onChange={e => setSistema(e.target.value as 'parede' | 'forro')}>
              <option value="parede">Parede simples</option>
              <option value="forro">Forro F530</option>
            </select>
          </label>
          <label>
            <span style={rotulo}>Comprimento (m) <AjudaCampo chave="hub.calculadora.comprimento" /></span>
            <input aria-label="Comprimento" inputMode="decimal" style={campo} value={comprimento} onChange={e => setComprimento(e.target.value)} />
          </label>
          {sistema === 'parede' ? (<>
            <label>
              <span style={rotulo}>Pé-direito (m) <AjudaCampo chave="hub.calculadora.pe_direito" /></span>
              <input aria-label="Pé-direito" inputMode="decimal" style={campo} value={peDireito} onChange={e => setPeDireito(e.target.value)} />
            </label>
            <label>
              <span style={rotulo}>Vãos a descontar (m²) <AjudaCampo chave="hub.calculadora.vaos" /></span>
              <input aria-label="Vãos" inputMode="decimal" style={campo} value={vaos} onChange={e => setVaos(e.target.value)} />
            </label>
          </>) : (
            <label>
              <span style={rotulo}>Largura (m) <AjudaCampo chave="hub.calculadora.largura" /></span>
              <input aria-label="Largura" inputMode="decimal" style={campo} value={largura} onChange={e => setLargura(e.target.value)} />
            </label>
          )}
        </div>

        <h2 style={{ fontSize: 17, margin: '24px 0 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
          Lista de materiais <AjudaCampo chave="hub.calculadora.resultado" />
        </h2>
        {!res.ok ? (
          <div role="alert" style={{ color: VERM, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>{res.erro}</div>
        ) : (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', color: MUT, fontSize: 13, borderBottom: `1px solid ${LINE}` }}>Área calculada: <b style={{ color: ESP }}>{res.area.toLocaleString('pt-BR')} m²</b></div>
            {res.itens.map(i => (
              <div key={i.chave} style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15 }}>{i.descricao}</span>
                  <span style={{ fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' }}>{i.quantidade} <small style={{ color: MUT, fontWeight: 400 }}>{i.unidadeCompra}</small></span>
                </div>
                <button type="button" onClick={() => setAberto(aberto === i.chave ? null : i.chave)}
                  style={{ background: 'none', border: 0, padding: '6px 0 0', color: MUT, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  {aberto === i.chave ? 'esconder a conta' : 'ver a conta'}
                </button>
                {aberto === i.chave && <div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>{i.conta} = {i.quantidadeBruta.toLocaleString('pt-BR')} → comprar {i.quantidade}</div>}
              </div>
            ))}
          </div>
        )}
        <p style={{ color: MUT, fontSize: 12, marginTop: 14 }}>Coeficientes são referência de mercado a validar com o fabricante de cada empresa.</p>
      </div>
    </div>
  )
}
