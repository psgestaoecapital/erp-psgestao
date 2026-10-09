'use client'

// HB2 · Calculadora de Obra (fatia 2) — tela sobre o motor src/lib/calculadora/motor.ts. Parede simples e forro F530.
// Cada item mostra "ver a conta". As regras são de referência de mercado (a validar com o fabricante de cada empresa).
import { useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  calcularForroF530, calcularParede, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, type Resultado,
} from '@/lib/calculadora/motor'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.6)'
const num = (s: string) => Number(s.replace(',', '.')) || 0
const rot = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: ESP, marginBottom: 6 } as const
const inp = { width: '100%', padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 16, background: '#fff', color: ESP } as const

type Sistema = 'parede' | 'forro'

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>('parede')
  const [comprimento, setComprimento] = useState('12,5')
  const [peDireito, setPeDireito] = useState('2,8')
  const [vaos, setVaos] = useState('1,68')
  const [largura, setLargura] = useState('4')
  const [aberta, setAberta] = useState<string | null>(null)

  const r: Resultado = useMemo(() => sistema === 'parede'
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: num(comprimento), peDireito: num(peDireito), vaos: num(vaos) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: num(largura), comprimento: num(comprimento) }),
  [sistema, comprimento, peDireito, vaos, largura])

  return (
    <main style={{ background: BG, minHeight: '100vh', padding: '16px', color: ESP }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '4px 0' }}>Calculadora de obra <AjudaCampo chave="hub.calculadora.tela" /></h1>
        <p style={{ color: MUT, margin: '0 0 16px' }}>Digite as medidas e veja o que comprar. Toque em “Ver a conta” para conferir cada número.</p>

        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {([['parede', 'Parede simples'], ['forro', 'Forro F530']] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={sistema === k} onClick={() => setSistema(k)}
              style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${sistema === k ? GOLD : LINE}`, background: sistema === k ? ESP : '#fff', color: sistema === k ? '#fff' : ESP, fontWeight: 600, minHeight: 44 }}>
              {t}
            </button>
          ))}
        </div>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16 }}>
          <label><span style={rot}>{sistema === 'parede' ? 'Comprimento (m)' : 'Comprimento do ambiente (m)'} <AjudaCampo chave="hub.calculadora.comprimento" /></span>
            <input style={inp} inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} /></label>
          {sistema === 'parede' ? (<>
            <label><span style={rot}>Pé-direito (m) <AjudaCampo chave="hub.calculadora.pe_direito" /></span>
              <input style={inp} inputMode="decimal" value={peDireito} onChange={(e) => setPeDireito(e.target.value)} /></label>
            <label><span style={rot}>Vãos a descontar (m²) <AjudaCampo chave="hub.calculadora.vaos" /></span>
              <input style={inp} inputMode="decimal" value={vaos} onChange={(e) => setVaos(e.target.value)} /></label>
          </>) : (
            <label><span style={rot}>Largura do ambiente (m) <AjudaCampo chave="hub.calculadora.largura" /></span>
              <input style={inp} inputMode="decimal" value={largura} onChange={(e) => setLargura(e.target.value)} /></label>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          {!r.ok ? (
            <p role="alert" style={{ color: '#B91C1C', background: '#FEF2F2', padding: 12, borderRadius: 10 }}>{r.erro}</p>
          ) : (<>
            <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>O que comprar para {String(r.area).replace('.', ',')} m² <AjudaCampo chave="hub.calculadora.resultado" /></h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {r.itens.map((i) => (
                <li key={i.chave} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{i.descricao}</span>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{i.quantidade} <small style={{ fontWeight: 400, color: MUT }}>{i.unidadeCompra}</small></span>
                  </div>
                  <button onClick={() => setAberta(aberta === i.chave ? null : i.chave)} aria-expanded={aberta === i.chave}
                    style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 600, padding: '6px 0', minHeight: 32 }}>
                    {aberta === i.chave ? 'Esconder a conta' : 'Ver a conta'}
                  </button>
                  {aberta === i.chave && <p style={{ margin: 0, color: MUT, fontSize: 14 }}>{i.conta} = {String(i.quantidadeBruta).replace('.', ',')} → compra {i.quantidade}</p>}
                </li>
              ))}
            </ul>
            <p style={{ color: MUT, fontSize: 13, marginTop: 12 }}>Coeficientes de referência de mercado, a validar com o fabricante da sua empresa.</p>
          </>)}
        </section>
      </div>
    </main>
  )
}
