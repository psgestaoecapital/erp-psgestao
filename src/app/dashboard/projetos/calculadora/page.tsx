'use client'
// HB2 · Calculadora de Obra PS — tela da fatia 2 (parede simples e forro F530), sobre o motor src/lib/calculadora/motor.ts.
// Entradas curtas, "ver a conta" em cada item, unidade de compra + quantidade real. Regras = dado (referência a validar).
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from '@/lib/calculadora/motor'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const campo = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const num = (s: string) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? n : 0 }

type Sistema = 'parede' | 'forro'

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>('parede')
  const [comp, setComp] = useState('12,5')
  const [pd, setPd] = useState('2,8')
  const [vaoL, setVaoL] = useState('0,8')
  const [vaoA, setVaoA] = useState('2,1')
  const [larg, setLarg] = useState('3')
  const [compF, setCompF] = useState('4')

  const res: Resultado = useMemo(() => sistema === 'parede'
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: num(comp), peDireito: num(pd), vaos: num(vaoL) * num(vaoA) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: num(larg), comprimento: num(compF) }),
  [sistema, comp, pd, vaoL, vaoA, larg, compF])

  const lbl = { display: 'grid', gap: 4, fontSize: 12, color: MUT } as const
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }} data-testid="calculadora-obra">
        <Link href="/dashboard/projetos?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Hub</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Orçamento</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Calculadora de obra</h1>

        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {([['parede', 'Parede simples'], ['forro', 'Forro F530']] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={sistema === k} data-testid={`calc-sistema-${k}`} onClick={() => setSistema(k)}
              style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${sistema === k ? GOLD : LINE}`, background: sistema === k ? GOLD : '#fff', color: sistema === k ? '#fff' : ESP, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {sistema === 'parede' ? (<>
            <label style={lbl}><span>Comprimento (m)<AjudaCampo chave="projetos.calculadora.comprimento" /></span>
              <input data-testid="calc-comprimento" inputMode="decimal" style={campo} value={comp} onChange={(e) => setComp(e.target.value)} /></label>
            <label style={lbl}><span>Pé-direito (m)<AjudaCampo chave="projetos.calculadora.pe_direito" /></span>
              <input data-testid="calc-pe-direito" inputMode="decimal" style={campo} value={pd} onChange={(e) => setPd(e.target.value)} /></label>
            <label style={lbl}><span>Vão: largura (m)<AjudaCampo chave="projetos.calculadora.vao_largura" /></span>
              <input data-testid="calc-vao-largura" inputMode="decimal" style={campo} value={vaoL} onChange={(e) => setVaoL(e.target.value)} /></label>
            <label style={lbl}><span>Vão: altura (m)<AjudaCampo chave="projetos.calculadora.vao_altura" /></span>
              <input data-testid="calc-vao-altura" inputMode="decimal" style={campo} value={vaoA} onChange={(e) => setVaoA(e.target.value)} /></label>
          </>) : (<>
            <label style={lbl}><span>Largura (m)<AjudaCampo chave="projetos.calculadora.largura" /></span>
              <input data-testid="calc-largura" inputMode="decimal" style={campo} value={larg} onChange={(e) => setLarg(e.target.value)} /></label>
            <label style={lbl}><span>Comprimento (m)<AjudaCampo chave="projetos.calculadora.comprimento_forro" /></span>
              <input data-testid="calc-comprimento-forro" inputMode="decimal" style={campo} value={compF} onChange={(e) => setCompF(e.target.value)} /></label>
          </>)}
        </div>

        {!res.ok ? (
          <div role="alert" data-testid="calc-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginTop: 14 }}>{res.erro}</div>
        ) : (
          <div style={{ marginTop: 16 }} data-testid="calc-resultado">
            <div style={{ fontSize: 13, color: MUT, marginBottom: 8 }}>Área considerada: <b style={{ color: ESP }} data-testid="calc-area">{res.area.toString().replace('.', ',')} m²</b>
              <AjudaCampo chave="projetos.calculadora.area" /></div>
            <div style={{ display: 'grid', gap: 8 }}>
              {res.itens.map((i) => (
                <details key={i.chave} data-testid={`calc-item-${i.chave}`} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
                  <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 8, cursor: 'pointer', color: ESP, fontSize: 14 }}>
                    <span>{i.descricao}</span>
                    <b data-testid={`calc-qtd-${i.chave}`}>{i.quantidade} <span style={{ fontWeight: 400, color: MUT }}>{i.unidadeCompra}</span></b>
                  </summary>
                  <div style={{ fontSize: 12, color: MUT, marginTop: 6 }}>Ver a conta: {i.conta} = {i.quantidadeBruta.toString().replace('.', ',')} → compra {i.quantidade}</div>
                </details>
              ))}
            </div>
            <p style={{ fontSize: 11, color: MUT, marginTop: 10 }}>Coeficientes de referência de mercado, a validar com o fabricante da sua empresa.</p>
          </div>
        )}
      </div>
    </div>
  )
}
