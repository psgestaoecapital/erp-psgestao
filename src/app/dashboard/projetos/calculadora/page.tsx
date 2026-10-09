'use client'
// HB2 · Calculadora de Obra PS (Hub, blueprint V24 Parte O) — fatia 2: tela da parede simples e do forro F530.
// Usa o motor src/lib/calculadora/motor.ts (regras como dado; valores de referência "a validar" com o fabricante).
// Cada item mostra "ver a conta"; unidade de compra + quantidade real. De-para com o estoque e envio ao orçamento: próximas fatias.
import { useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, calcularForroF530, calcularParede, type Resultado,
} from '@/lib/calculadora/motor'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
type Sistema = 'parede' | 'forro'
const n = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0 }
const inp: React.CSSProperties = { padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, width: '100%' }
const lbl: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: MUT }

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>('parede')
  const [comp, setComp] = useState('12,5')
  const [pd, setPd] = useState('2,8')
  const [vaos, setVaos] = useState('1,68')
  const [larg, setLarg] = useState('3')
  const [forroComp, setForroComp] = useState('4')
  const [aberto, setAberto] = useState<string | null>(null)

  const res: Resultado = useMemo(() => sistema === 'parede'
    ? calcularParede(REGRAS_PAREDE_SIMPLES_ST, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos) })
    : calcularForroF530(REGRAS_FORRO_F530, { largura: n(larg), comprimento: n(forroComp) }),
  [sistema, comp, pd, vaos, larg, forroComp])

  return (
    <div style={{ background: BG, minHeight: '100%', padding: '24px 16px', color: ESP }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 20 }}>
        <header>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Calculadora de obra</h1>
          <p style={{ margin: '4px 0 0', color: MUT, fontSize: 14 }}>Digite as medidas e veja o que comprar, por unidade de compra, com a conta aberta.</p>
        </header>

        <div role="tablist" style={{ display: 'flex', gap: 8 }}>
          {([['parede', 'Parede simples'], ['forro', 'Forro F530']] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={sistema === k} onClick={() => { setSistema(k); setAberto(null) }}
              style={{ padding: '10px 16px', borderRadius: 999, border: `1px solid ${sistema === k ? GOLD : LINE}`, background: sistema === k ? GOLD : '#fff', color: sistema === k ? '#fff' : ESP, fontSize: 14, cursor: 'pointer' }}>{t}</button>
          ))}
        </div>

        <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {sistema === 'parede' ? (<>
            <label style={lbl}><span>Comprimento da parede (m)<AjudaCampo chave="projetos.calculadora.comprimento" /></span>
              <input style={inp} inputMode="decimal" value={comp} onChange={e => setComp(e.target.value)} /></label>
            <label style={lbl}><span>Pé-direito (m)<AjudaCampo chave="projetos.calculadora.pe_direito" /></span>
              <input style={inp} inputMode="decimal" value={pd} onChange={e => setPd(e.target.value)} /></label>
            <label style={lbl}><span>Vãos a descontar (m²)<AjudaCampo chave="projetos.calculadora.vaos" /></span>
              <input style={inp} inputMode="decimal" value={vaos} onChange={e => setVaos(e.target.value)} /></label>
          </>) : (<>
            <label style={lbl}><span>Largura do ambiente (m)<AjudaCampo chave="projetos.calculadora.largura" /></span>
              <input style={inp} inputMode="decimal" value={larg} onChange={e => setLarg(e.target.value)} /></label>
            <label style={lbl}><span>Comprimento do ambiente (m)<AjudaCampo chave="projetos.calculadora.comprimento_forro" /></span>
              <input style={inp} inputMode="decimal" value={forroComp} onChange={e => setForroComp(e.target.value)} /></label>
          </>)}
        </section>

        {!res.ok ? (
          <div role="alert" style={{ color: VERM, background: '#fff', border: `1px solid ${VERM}`, borderRadius: 12, padding: 16, fontSize: 14 }}>{res.erro}</div>
        ) : (
          <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, color: MUT, marginBottom: 8 }}>Área considerada: <b style={{ color: ESP }}>{res.area.toLocaleString('pt-BR')} m²</b></div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {res.itens.map(i => (
                <li key={i.chave} style={{ borderTop: `1px solid ${LINE}`, padding: '12px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15 }}>{i.descricao}</span>
                    <span style={{ fontSize: 18, fontWeight: 600 }}>{i.quantidade} <span style={{ fontSize: 13, fontWeight: 400, color: MUT }}>{i.unidadeCompra}</span></span>
                  </div>
                  <button onClick={() => setAberto(aberto === i.chave ? null : i.chave)} aria-expanded={aberto === i.chave}
                    style={{ background: 'none', border: 0, padding: 0, color: GOLD, fontSize: 12, cursor: 'pointer' }}>
                    {aberto === i.chave ? 'Ocultar a conta' : 'Ver a conta'}
                  </button>
                  {aberto === i.chave && <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>{i.conta} = {i.quantidadeBruta.toLocaleString('pt-BR')} → comprar {i.quantidade}</div>}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 11, color: MUT, margin: '12px 0 0' }}>Coeficientes de referência de mercado, a validar com o fabricante da sua obra. Enviar ao orçamento e ligar ao estoque da empresa: próximas entregas.</p>
          </section>
        )}
      </div>
    </div>
  )
}
