'use client'

// Folha de pagamento — importar planilha do Domínio (.xls/.xlsx) e extrair
// custo/verbas por competência. LGPD: dado sensível (salário) — escopo por
// empresa (RLS) + tela operacional de RH. O BI final expõe só agregado por setor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', GOLD_D = '#A57A15'
const LINE = '#E7DECF', CREAM = '#F2EBDF', MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D', RED_BG = '#FCEBEB', GREEN = '#166534', GREEN_BG = '#DCFCE7'

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtComp = (d: string) => { const [y, m] = d.split('-'); return `${m}/${y}` }

type CompRow = { matricula: number; nome: string | null; competencia: string; total_geral: number; remuneracao: number; secoes: string | null }
type VerbaRow = { codigo_verba: string; descricao: string | null; valor: number; tipo: string | null }
type Preview = { competencia: string; cnpj: string | null; funcionarios: number; total_geral: number; secoes?: string[]; via?: string }

export default function FolhaPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [rows, setRows] = useState<CompRow[]>([])
  const [compSel, setCompSel] = useState<string | null>(null)
  const [verbas, setVerbas] = useState<VerbaRow[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [fileSel, setFileSel] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const { data } = await supabase.from('folha_competencia')
      .select('matricula, nome, competencia, total_geral, remuneracao, secoes')
      .eq('company_id', empresaUnica).order('competencia', { ascending: false })
    setRows((data ?? []) as CompRow[])
  }, [empresaUnica])
  useEffect(() => { void carregar() }, [carregar])

  const competencias = useMemo(() => {
    const m = new Map<string, { n: number; total: number; secoes: string | null }>()
    for (const r of rows) { const e = m.get(r.competencia) ?? { n: 0, total: 0, secoes: r.secoes }; e.n++; e.total += Number(r.total_geral) || 0; if (r.secoes) e.secoes = r.secoes; m.set(r.competencia, e) }
    return [...m.entries()].map(([competencia, v]) => ({ competencia, ...v })).sort((a, b) => b.competencia.localeCompare(a.competencia))
  }, [rows])

  useEffect(() => {
    if (!compSel || !empresaUnica) { setVerbas([]); return }
    let alive = true
    void supabase.from('folha_verba').select('codigo_verba, descricao, valor, tipo')
      .eq('company_id', empresaUnica).eq('competencia', compSel)
      .then(({ data }) => { if (alive) setVerbas((data ?? []) as VerbaRow[]) })
    return () => { alive = false }
  }, [compSel, empresaUnica])

  const verbasResumo = useMemo(() => {
    const m = new Map<string, { descricao: string; valor: number; tipo: string }>()
    for (const v of verbas) { const e = m.get(v.codigo_verba) ?? { descricao: v.descricao ?? v.codigo_verba, valor: 0, tipo: v.tipo ?? '' }; e.valor += Number(v.valor) || 0; m.set(v.codigo_verba, e) }
    return [...m.entries()].map(([codigo, v]) => ({ codigo, ...v })).sort((a, b) => b.valor - a.valor)
  }, [verbas])

  const compRowsSel = useMemo(() => rows.filter((r) => r.competencia === compSel), [rows, compSel])
  const totalSel = compRowsSel.reduce((s, r) => s + (Number(r.total_geral) || 0), 0)

  async function enviar(confirmar: boolean) {
    if (!empresaUnica || !fileSel) { setErro('Selecione o arquivo da folha.'); return }
    setBusy(true); setErro(null); setOk(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setErro('Sessão expirada.'); return }
      const fd = new FormData()
      fd.append('company_id', empresaUnica); fd.append('file', fileSel); fd.append('confirmar', confirmar ? 'true' : 'false')
      const r = await fetch('/api/industrial/folha/upload', { method: 'POST', credentials: 'include', headers: { authorization: `Bearer ${session.access_token}` }, body: fd })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErro(j.erro || `HTTP ${r.status}`); return }
      if (j.preview) { setPreview({ competencia: j.competencia, cnpj: j.cnpj, funcionarios: j.funcionarios, total_geral: j.total_geral, secoes: j.secoes, via: j.via }) }
      else {
        setOk(`IMPORTOU folha ${fmtComp(j.competencia)} · ${j.funcionarios} funcionários · ${brl(j.total_geral)} · ${j.verbas} verbas.`)
        setPreview(null); setFileSel(null); if (fileRef.current) fileRef.current.value = ''
        await carregar(); setCompSel(j.competencia)
      }
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  if (!empresaUnica) {
    return <Casca><Box><b style={{ color: ESP }}>Selecione uma empresa</b><div style={{ color: MUT, fontSize: 13, marginTop: 6 }}>A folha é por empresa. Escolha uma empresa específica no topo.</div></Box></Casca>
  }

  return (
    <Casca>
      {erro && <div style={aviso(RED, RED_BG)}>{erro}</div>}
      {ok && <div style={aviso(GREEN, GREEN_BG)}>✓ {ok}</div>}

      {/* Upload */}
      <section style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: ESP, marginBottom: 8 }}>📤 Subir folha de pagamento</div>
        <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>Planilha "Encargos da Empresa" (Domínio) — .xls ou .xlsx. Uma competência por arquivo (re-upload regrava).</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={(e) => { setFileSel(e.target.files?.[0] ?? null); setPreview(null) }} style={{ fontSize: 12 }} />
          <button onClick={() => enviar(false)} disabled={busy || !fileSel} style={{ ...btnOutline, opacity: busy || !fileSel ? 0.5 : 1 }}>{busy ? 'Lendo…' : 'Pré-visualizar'}</button>
        </div>
        {preview && (
          <div style={{ marginTop: 12, background: CREAM, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, color: ESP }}>
              Competência <b>{fmtComp(preview.competencia)}</b> · <b>{preview.funcionarios}</b> funcionários · total <b>{brl(preview.total_geral)}</b>{preview.cnpj ? ` · CNPJ ${preview.cnpj}` : ''}
              {preview.secoes && preview.secoes.length > 0 && <> · seções: <b>{preview.secoes.join(' + ')}</b></>}
              {preview.via === 'reparado' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#854F0B', background: '#FAEEDA', padding: '1px 6px', borderRadius: 5 }}>arquivo reparado</span>}
            </div>
            <button onClick={() => enviar(true)} disabled={busy} style={{ ...btnGold, marginTop: 10, opacity: busy ? 0.6 : 1 }}>{busy ? 'Importando…' : '✓ Confirmar importação'}</button>
          </div>
        )}
      </section>

      {/* Competências importadas */}
      <section style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: ESP, marginBottom: 10 }}>Competências importadas</div>
        {competencias.length === 0 ? (
          <div style={{ fontSize: 12, color: MUT }}>Nenhuma folha importada ainda.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {competencias.map((c) => (
              <button key={c.competencia} onClick={() => setCompSel(compSel === c.competencia ? null : c.competencia)}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', border: `1px solid ${compSel === c.competencia ? GOLD : LINE}`, background: compSel === c.competencia ? 'rgba(200,148,26,0.10)' : '#FFF' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{fmtComp(c.competencia)}</div>
                <div style={{ fontSize: 11, color: MUT }}>{c.n} func · {brl(c.total)}</div>
                {c.secoes && <div style={{ fontSize: 10, color: c.secoes.includes('13') ? '#854F0B' : MUT, fontWeight: c.secoes.includes('13') ? 700 : 400, marginTop: 2 }}>{c.secoes}</div>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Detalhe da competência selecionada */}
      {compSel && (
        <section style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: ESP, marginBottom: 2 }}>Folha {fmtComp(compSel)}</div>
          <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>🔒 Dado sensível (RH). O BI de Gente expõe só agregado por setor, sem salário individual.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Kpi t="Funcionários" v={String(compRowsSel.length)} />
            <Kpi t="Custo total" v={brl(totalSel)} destaque />
            <Kpi t="Custo médio/func" v={brl(compRowsSel.length ? totalSel / compRowsSel.length : 0)} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6 }}>Por verba</div>
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead style={{ background: BG }}><tr><Th>Verba</Th><Th>Tipo</Th><Th>Total</Th></tr></thead>
              <tbody>
                {verbasResumo.map((v) => (
                  <tr key={v.codigo} style={{ borderTop: `0.5px solid ${LINE}` }}>
                    <Td><b>{v.descricao}</b></Td>
                    <Td style={{ color: MUT }}>{v.tipo}</Td>
                    <Td style={{ fontWeight: 700, color: v.tipo === 'desconto' ? RED : ESP }}>{brl(v.valor)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Casca>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Industrial · RH</p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 0' }}>Folha de Pagamento</h1>
        </header>
        {children}
      </div>
    </div>
  )
}
function Box({ children }: { children: React.ReactNode }) { return <div style={{ ...card, textAlign: 'center', padding: 28 }}>{children}</div> }
function Kpi({ t, v, destaque }: { t: string; v: string; destaque?: boolean }) {
  return <div style={{ background: destaque ? 'rgba(200,148,26,0.08)' : BG, border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>{t}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: destaque ? GOLD_D : ESP, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) { return <td style={{ padding: '10px 14px', color: ESP, fontVariantNumeric: 'tabular-nums', ...style }}>{children}</td> }
const card: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const aviso = (fg: string, bg: string): React.CSSProperties => ({ background: bg, color: fg, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 })
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
