// src/app/dashboard/ehs/sst/fap-rat/page.tsx
// EHS-F slice-c1 (Parte F.2 do PS EHS V11) — Simulador FAP/RAT. Calculadora pura de contribuição SAT/RAT ajustada
// pelo FAP: funciona SEM o adicional financeiro (nenhuma leitura de dado financeiro/GE). O usuário informa a base da
// folha, o grau de risco (RAT 1/2/3%) e o FAP (0,5000–2,0000); vê a alíquota efetiva, a contribuição mensal e a
// economia/acréscimo projetada no ano. RD-95: "?" em todo campo e indicador. Celular primeiro. A IA calcula, o humano
// decide. Nenhum nome de sistema de terceiros (RD-100).
'use client'

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Calculator, TrendingDown, TrendingUp, Minus, ShieldCheck } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  gray: '#6b6b6b', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0',
  blue: '#1f4e79', blueBg: '#e8f0f8', red: '#a02020', redBg: '#fce8e8',
}

type Resultado = {
  ok: boolean; erro?: string
  base_folha?: number; rat_grau?: number; rat_nominal_pct?: number; fap?: number; rat_efetivo_pct?: number
  contrib_nominal_mes?: number; contrib_efetiva_mes?: number; economia_mes?: number; economia_ano?: number
  sentido?: 'economia' | 'acrescimo' | 'neutro'
}

const brl = (n: number | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | undefined) =>
  `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`

export default function EhsFapRatPage() {
  const [folha, setFolha] = useState<string>('')
  const [grau, setGrau] = useState<number>(2)
  const [fap, setFap] = useState<string>('1,0000')
  const [res, setRes] = useState<Resultado | null>(null)
  const [erro, setErro] = useState('')
  const [calculando, setCalculando] = useState(false)

  const parseNum = (s: string) => {
    const v = Number(String(s).replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(v) ? v : NaN
  }

  const podeSimular = useMemo(() => {
    const f = parseNum(folha); const p = parseNum(fap)
    return Number.isFinite(f) && f > 0 && Number.isFinite(p)
  }, [folha, fap])

  const simular = async () => {
    setErro(''); setRes(null)
    const f = parseNum(folha); const p = parseNum(fap)
    if (!Number.isFinite(f) || f <= 0) { setErro('Informe a base da folha (R$/mês) maior que zero.'); return }
    if (!Number.isFinite(p)) { setErro('Informe o FAP como fator decimal (ex.: 0,7500).'); return }
    setCalculando(true)
    try {
      const { data, error } = await supabase.rpc('fn_ehs_fap_rat_simular', {
        p_base_folha: f, p_rat_grau: grau, p_fap: p,
      })
      if (error) throw error
      const r = data as Resultado
      if (!r?.ok) { setErro(r?.erro || 'Não foi possível simular.'); return }
      setRes(r)
    } catch (e) { setErro((e as Error).message) } finally { setCalculando(false) }
  }

  const fieldLabel: React.CSSProperties = { display: 'block' }
  const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: C.espresso, marginBottom: 6 }
  const inputStyle: React.CSSProperties = { width: '100%', padding: '11px 12px', borderRadius: 10, border: `1px solid ${C.borderLt}`, fontSize: 15, background: '#fff', color: C.espresso, boxSizing: 'border-box' }
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 14, padding: 16 }

  const sentidoCor = res?.sentido === 'economia' ? { fg: C.green, bg: C.greenBg, Icon: TrendingDown, titulo: 'Economia com o FAP' }
    : res?.sentido === 'acrescimo' ? { fg: C.red, bg: C.redBg, Icon: TrendingUp, titulo: 'Acréscimo com o FAP' }
    : { fg: C.gray, bg: C.beigeLt, Icon: Minus, titulo: 'FAP neutro' }

  return (
    <div style={{ background: C.offwhite, minHeight: '100%', padding: '18px 16px 48px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: C.espresso, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Calculator size={21} color={C.gold} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.espresso }}>Simulador FAP/RAT</h1>
          <div style={{ fontSize: 12.5, color: C.gray }}>Quanto a prevenção vale em R$ na contribuição de SST</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: C.gray, lineHeight: 1.5, margin: '10px 2px 18px' }}>
        A contribuição de SST sobre a folha é o RAT (1%, 2% ou 3% pelo grau de risco) multiplicado pelo FAP, que vai de
        0,5000 a 2,0000. Abaixo de 1,0000 a prevenção reduz o custo; acima, os acidentes aumentam. Esta é uma simulação —
        funciona sem o módulo financeiro.
      </p>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <label style={fieldLabel}>
            <span style={labelStyle}>Base da folha (R$/mês) <AjudaCampo chave="ehs.fap_rat.base_folha" /></span>
            <input style={inputStyle} inputMode="decimal" placeholder="Ex.: 120.000,00" value={folha}
              onChange={(e) => setFolha(e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={fieldLabel}>
              <span style={labelStyle}>Grau de risco (RAT) <AjudaCampo chave="ehs.fap_rat.rat_grau" /></span>
              <select style={inputStyle} value={grau} onChange={(e) => setGrau(Number(e.target.value))}>
                <option value={1}>1 — Leve (1%)</option>
                <option value={2}>2 — Médio (2%)</option>
                <option value={3}>3 — Grave (3%)</option>
              </select>
            </label>
            <label style={fieldLabel}>
              <span style={labelStyle}>FAP <AjudaCampo chave="ehs.fap_rat.fap" /></span>
              <input style={inputStyle} inputMode="decimal" placeholder="Ex.: 0,7500" value={fap}
                onChange={(e) => setFap(e.target.value)} />
            </label>
          </div>
        </div>

        <button onClick={simular} disabled={!podeSimular || calculando}
          style={{ marginTop: 16, width: '100%', padding: '12px 16px', borderRadius: 11, border: 'none',
            background: podeSimular && !calculando ? C.espresso : C.borderLt, color: podeSimular && !calculando ? C.gold : C.gray,
            fontSize: 15, fontWeight: 700, cursor: podeSimular && !calculando ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Calculator size={17} /> {calculando ? 'Calculando…' : 'Simular'}
        </button>

        {erro && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: C.redBg, color: C.red, fontSize: 13 }}>
            {erro}
          </div>
        )}
      </div>

      {res?.ok && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <div style={{ ...card, background: C.espresso, border: 'none', color: C.offwhite }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: C.gold, fontWeight: 600 }}>
              Alíquota efetiva (RAT × FAP) <AjudaCampo chave="ehs.fap_rat.rat_efetivo" />
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 2px' }}>{pct(res.rat_efetivo_pct)}</div>
            <div style={{ fontSize: 12.5, color: '#d8ccb8' }}>
              RAT nominal {pct(res.rat_nominal_pct)} × FAP {(res.fap ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: 12, color: C.gray, fontWeight: 600 }}>Contribuição com FAP neutro</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.espresso, marginTop: 4 }}>{brl(res.contrib_nominal_mes)}</div>
              <div style={{ fontSize: 11.5, color: C.gray }}>por mês (FAP 1,0000)</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, color: C.gray, fontWeight: 600 }}>Contribuição com o seu FAP</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.espresso, marginTop: 4 }}>{brl(res.contrib_efetiva_mes)}</div>
              <div style={{ fontSize: 11.5, color: C.gray }}>por mês</div>
            </div>
          </div>

          <div style={{ ...card, background: sentidoCor.bg, border: `1px solid ${sentidoCor.fg}22` }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: sentidoCor.fg, fontWeight: 700 }}>
              <sentidoCor.Icon size={15} /> {sentidoCor.titulo} <AjudaCampo chave="ehs.fap_rat.economia" />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: sentidoCor.fg, margin: '6px 0 2px' }}>
              {brl(Math.abs(res.economia_mes ?? 0))}<span style={{ fontSize: 14, fontWeight: 600 }}> /mês</span>
            </div>
            <div style={{ fontSize: 13, color: sentidoCor.fg }}>
              {brl(Math.abs(res.economia_ano ?? 0))} no ano
              {res.sentido === 'economia' ? ' economizados pela prevenção' : res.sentido === 'acrescimo' ? ' a mais por sinistralidade' : ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: C.gray, padding: '2px 4px' }}>
            <ShieldCheck size={15} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Simulação de apoio à decisão — o recolhimento oficial segue o FAP e o enquadramento vigentes da empresa. A assinatura do responsável técnico é sempre humana.</span>
          </div>
        </div>
      )}
    </div>
  )
}
