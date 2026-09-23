'use client'

// Relatório Plano Gerencial × Contábil (SPEC CEO 22/09). Expande F.cadastros.plano_contas_v2.
// Lê fn_plano_contas_relatorio(company). Exporta Excel (2 abas) e PDF (window.print, sem dep nova —
// package.json não tem jspdf/pdfmake; pdf-lib é baixo nível). Paleta PS (psgc-tokens).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'

export const dynamic = 'force-dynamic'

interface LinhaRelatorio {
  origem: 'gerencial' | 'contabil_sem_vinculo'
  ger_codigo: string | null
  ger_descricao: string | null
  ger_grupo: string | null
  ger_tipo: string | null
  ger_nivel: number | null
  ger_is_totalizador: boolean | null
  cont_codigo: string | null
  cont_descricao: string | null
  cont_nivel: number | null
  cont_analitica: boolean | null
  cont_codigo_antigo: string | null
  vinculo_observacao: string | null
}

type Filtro = 'todas' | 'vinculadas' | 'sem_vinculo'

const C = PSGC_COLORS
const hoje = () => new Date().toISOString().slice(0, 10)

export default function Page() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [linhas, setLinhas] = useState<LinhaRelatorio[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [empresaNome, setEmpresaNome] = useState('')
  const [empresaCnpj, setEmpresaCnpj] = useState('')
  // Vincular (adendo B): opções gerenciais + mapa código-contábil→id + estado por linha órfã.
  const [gerenciais, setGerenciais] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [contabilId, setContabilId] = useState<Record<string, string>>({})
  const [vincSel, setVincSel] = useState<Record<string, string>>({})
  const [vincBusy, setVincBusy] = useState<string | null>(null)
  const [vincMsg, setVincMsg] = useState<string | null>(null)
  // Importar validação do contador (adendo C).
  const [impBusy, setImpBusy] = useState(false)
  const [impMsg, setImpMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [{ data, error }, emp, ger, cont] = await Promise.all([
      supabase.rpc('fn_plano_contas_relatorio', { p_company_id: empresaUnica }),
      supabase.from('companies').select('razao_social, cnpj').eq('id', empresaUnica).maybeSingle(),
      supabase.from('erp_plano_contas').select('id, codigo, descricao, is_totalizador').eq('company_id', empresaUnica).eq('ativo', true).order('codigo'),
      supabase.from('erp_conta_contabil').select('id, codigo').eq('company_id', empresaUnica).eq('ativo', true),
    ])
    if (error) { setErro(error.message); setLinhas([]) }
    else setLinhas((data ?? []) as LinhaRelatorio[])
    setEmpresaNome((emp.data?.razao_social as string) ?? '')
    setEmpresaCnpj((emp.data?.cnpj as string) ?? '')
    setGerenciais(((ger.data ?? []) as { id: string; codigo: string; descricao: string; is_totalizador: boolean }[])
      .filter((g) => !g.is_totalizador).map((g) => ({ id: g.id, codigo: g.codigo, descricao: g.descricao })))
    const map: Record<string, string> = {}
    for (const c of (cont.data ?? []) as { id: string; codigo: string }[]) map[c.codigo] = c.id
    setContabilId(map)
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { let vivo = true; if (vivo) void carregar(); return () => { vivo = false } }, [carregar])

  async function vincular(contCodigo: string | null) {
    if (!empresaUnica || !contCodigo) return
    const planoId = vincSel[contCodigo]
    const contId = contabilId[contCodigo]
    if (!planoId) { setVincMsg('Escolha a conta gerencial para vincular.'); return }
    if (!contId) { setVincMsg('Conta contábil não encontrada para vincular.'); return }
    if (!window.confirm('Depois de gravado este vínculo não pode ser alterado. Confirma?')) return
    setVincBusy(contCodigo); setVincMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_conta_contabil_vincular', {
        p_company_id: empresaUnica, p_plano_conta_id: planoId, p_conta_contabil_id: contId, p_observacao: null,
      })
      if (error) { setVincMsg(error.message); return }
      const r = (data ?? {}) as { ok?: boolean; erro?: string; mensagem?: string }
      if (r.ok) { setVincMsg(null); await carregar() }
      else if (r.erro === 'vinculo_imutavel') { setVincMsg(r.mensagem ?? 'Vínculo imutável — crie uma nova conta gerencial.') }
      else if (r.erro === 'contabil_sintetica_nao_vinculavel') { setVincMsg('Esta conta é sintética — vincule as contas filhas (analíticas).') }
      else if (r.erro === 'sem_acesso') { setVincMsg('Sem acesso a esta empresa.') }
      else { setVincMsg(r.mensagem ?? 'Não foi possível vincular.') }
    } finally { setVincBusy(null) }
  }

  async function importarValidacao(file: File) {
    if (!empresaUnica) return
    setImpBusy(true); setImpMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      const payload = rows.map((row) => {
        const entradas = Object.entries(row)
        const get = (alvo: string) => { const e = entradas.find(([k]) => norm(k) === alvo); return e ? String(e[1] ?? '').trim() : '' }
        return { codigo_externo: get('conta contabil'), codigo_estruturado: get('validacao') }
      }).filter((r) => r.codigo_externo)
      if (payload.length === 0) { setImpMsg('Planilha sem a coluna "Conta contabil" preenchida.'); return }
      const { data, error } = await supabase.rpc('fn_contabil_depara_importar', {
        p_company_id: empresaUnica, p_escritorio_id: null, p_rows: payload,
      })
      if (error) { setImpMsg(error.message); return }
      const r = (data ?? {}) as { ok?: boolean; erro?: string; importadas?: number; casadas_exato?: number; pendentes?: number }
      if (r.ok === false) { setImpMsg(r.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r.erro ?? 'Falha ao importar.')); return }
      setImpMsg(`Importadas ${r.importadas ?? 0} · casadas ${r.casadas_exato ?? 0} · pendentes ${r.pendentes ?? 0}.`)
    } catch (e) { setImpMsg(e instanceof Error ? e.message : 'Falha ao ler a planilha.') }
    finally { setImpBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const kpis = useMemo(() => {
    const gerenciais = linhas.filter((l) => l.origem === 'gerencial').length
    const vinculadas = linhas.filter((l) => l.origem === 'gerencial' && l.cont_codigo).length
    const orfas = linhas.filter((l) => l.origem === 'contabil_sem_vinculo').length
    return { gerenciais, vinculadas, orfas, contabeis: vinculadas + orfas }
  }, [linhas])

  const linhasFiltradas = useMemo(() => {
    if (filtro === 'vinculadas') return linhas.filter((l) => l.origem === 'gerencial' && l.cont_codigo)
    if (filtro === 'sem_vinculo') return linhas.filter((l) => l.origem === 'contabil_sem_vinculo')
    return linhas
  }, [linhas, filtro])

  function baixarExcel() {
    const nomeArq = (empresaNome || 'empresa').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)
    const linhaExcel = (l: LinhaRelatorio) => ({
      'Gerencial': l.ger_codigo ?? '',
      'Descrição gerencial': l.ger_descricao ?? '',
      'Grupo': l.ger_grupo ?? '',
      'Conta contábil': l.cont_codigo ?? '',
      'Descrição contábil': l.cont_descricao ?? '',
      'Cód. antigo': l.cont_codigo_antigo ?? '',
      'Situação': l.origem === 'contabil_sem_vinculo' ? 'Contábil sem gerencial'
        : (l.cont_codigo ? 'Vinculada' : 'Sem vínculo'),
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.map(linhaExcel)), 'Gerencial x Contabil')
    const orfas = linhas.filter((l) => l.origem === 'contabil_sem_vinculo').map((l) => ({
      'Conta contábil': l.cont_codigo ?? '', 'Descrição contábil': l.cont_descricao ?? '', 'Cód. antigo': l.cont_codigo_antigo ?? '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orfas.length ? orfas : [{ 'Conta contábil': '', 'Descrição contábil': 'Nenhuma pendência', 'Cód. antigo': '' }]), 'Sem vinculo')
    XLSX.writeFile(wb, `PlanoContas_${nomeArq}_${hoje()}.xlsx`)
  }

  if (!empresaUnica) {
    return <div style={{ padding: 32, color: C.alta, background: C.offWhite, minHeight: '100vh' }}>Selecione uma empresa específica para ver o relatório do plano de contas.</div>
  }

  return (
    <div style={{ background: C.offWhite, minHeight: '100vh', padding: '24px 16px 64px' }}>
      <style>{`@media print { .no-print{display:none!important} .only-print{display:block!important} body{background:#fff} } .only-print{display:none}`}</style>

      {/* Cabeçalho de impressão (só no PDF) */}
      <div className="only-print" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#000' }}>{empresaNome || 'Empresa'}</div>
        <div style={{ fontSize: 12, color: '#333' }}>CNPJ: {empresaCnpj || '—'} · Emitido em {new Date().toLocaleDateString('pt-BR')}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Plano de Contas · Gerencial × Contábil</div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <button type="button" onClick={() => router.push('/dashboard/cadastros/plano-contas')}
              style={{ background: 'transparent', color: C.espresso, border: 'none', padding: 0, fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>← Plano de Contas</button>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: C.espresso, margin: 0, fontWeight: 400 }}>Plano de Contas · Gerencial × Contábil</h1>
            <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 620 }}>
              Confira como cada conta gerencial se conecta à conta contábil. Exporte para a contabilidade validar.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={impBusy || loading || !!erro}
              style={{ background: 'transparent', color: C.espresso, border: '0.5px solid rgba(61,35,20,0.3)', padding: '10px 16px', borderRadius: PSGC_RADIUS.md, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{impBusy ? 'Importando…' : '⬆ Importar validação do contador'}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarValidacao(f) }} />
            <button type="button" onClick={baixarExcel} disabled={loading || !!erro}
              style={{ background: 'transparent', color: C.dourado, border: `0.5px solid ${C.dourado}`, padding: '10px 16px', borderRadius: PSGC_RADIUS.md, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⬇ Excel</button>
            <button type="button" onClick={() => window.print()} disabled={loading || !!erro}
              style={{ background: C.espresso, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: PSGC_RADIUS.md, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⬇ PDF</button>
          </div>
        </div>
        {impMsg && <div className="no-print" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: PSGC_RADIUS.md, background: C.verdeSoft, color: '#234D08', fontSize: 12.5 }}>{impMsg}</div>}
        {vincMsg && <div className="no-print" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: PSGC_RADIUS.md, background: C.amareloSoft, color: '#5C3B0B', fontSize: 12.5 }}>{vincMsg}</div>}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.6)' }}>Carregando…</div>
        ) : erro ? (
          <div style={{ padding: 16, borderRadius: PSGC_RADIUS.md, background: C.vermelhoSoft, color: C.alta }}>Não foi possível carregar o relatório: {erro}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
              <PSGCMetric label="Contas gerenciais" valor={kpis.gerenciais} cor={C.espresso} />
              <PSGCMetric label="Contas contábeis analíticas" valor={kpis.contabeis} cor={C.espresso} />
              <PSGCMetric label="Vinculadas" valor={kpis.vinculadas} cor={C.baixa} />
              <PSGCMetric label="Sem vínculo" valor={kpis.orfas} cor={kpis.orfas > 0 ? C.alta : C.baixa} destaque={kpis.orfas > 0} />
            </div>

            <div className="no-print" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {([['todas', 'Todas'], ['vinculadas', 'Só vinculadas'], ['sem_vinculo', 'Sem vínculo']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFiltro(k)}
                  style={{ padding: '7px 14px', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${filtro === k ? C.dourado : 'rgba(61,35,20,0.2)'}`,
                    background: filtro === k ? C.dourado : 'transparent', color: filtro === k ? '#3D2314' : C.espresso }}>{label}</button>
              ))}
            </div>

            {filtro === 'sem_vinculo' ? (
              <div style={{ border: '1px solid rgba(61,35,20,0.12)', borderRadius: PSGC_RADIUS.lg, background: '#fff', overflow: 'hidden' }}>
                {linhasFiltradas.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }}>Nenhuma conta contábil pendente de vínculo. 🎉</div>
                ) : linhasFiltradas.map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderTop: i ? '1px solid rgba(61,35,20,0.07)' : 'none' }}>
                    <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.espresso }}>{l.cont_codigo}</div>
                      <div style={{ fontSize: 11.5, color: 'rgba(61,35,20,0.7)' }}>{l.cont_descricao}{l.cont_codigo_antigo ? ` · antigo ${l.cont_codigo_antigo}` : ''}</div>
                    </div>
                    <select value={vincSel[l.cont_codigo ?? ''] ?? ''} onChange={(e) => setVincSel((p) => ({ ...p, [l.cont_codigo ?? '']: e.target.value }))}
                      style={{ flex: '1 1 240px', background: '#fff', border: '1px solid rgba(61,35,20,0.2)', borderRadius: PSGC_RADIUS.sm, padding: '8px 10px', fontSize: 12.5, color: C.espresso }}>
                      <option value="">— escolher conta gerencial —</option>
                      {gerenciais.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.descricao}</option>)}
                    </select>
                    <button type="button" onClick={() => void vincular(l.cont_codigo)} disabled={vincBusy === l.cont_codigo || !vincSel[l.cont_codigo ?? '']}
                      style={{ background: C.dourado, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: (vincBusy === l.cont_codigo || !vincSel[l.cont_codigo ?? '']) ? 0.5 : 1 }}>
                      {vincBusy === l.cont_codigo ? 'Vinculando…' : 'Vincular'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
            <div style={{ overflowX: 'auto', border: '1px solid rgba(61,35,20,0.12)', borderRadius: PSGC_RADIUS.lg, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: C.offWhiteDark, color: C.espresso, textAlign: 'left' }}>
                    <th style={th}>Gerencial</th><th style={th}>Descrição</th><th style={th}>Grupo</th>
                    <th style={{ ...th, textAlign: 'center' }}>→</th>
                    <th style={th}>Conta contábil</th><th style={th}>Descrição contábil</th><th style={th}>Cód. antigo</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }}>Nenhuma conta neste filtro.</td></tr>
                  ) : linhasFiltradas.map((l, i) => {
                    const orfa = l.origem === 'contabil_sem_vinculo'
                    const semVinculo = l.origem === 'gerencial' && !l.cont_codigo
                    const bold = !!l.ger_is_totalizador
                    const indent = orfa ? 0 : ((l.ger_nivel ?? 1) - 1) * 16
                    return (
                      <tr key={i} style={{ borderTop: '1px solid rgba(61,35,20,0.07)' }}>
                        <td style={{ ...td, fontWeight: bold ? 700 : 400, paddingLeft: 12 + indent }}>{l.ger_codigo ?? (orfa ? '' : '—')}</td>
                        <td style={{ ...td, fontWeight: bold ? 700 : 400 }}>
                          {orfa ? <span style={{ fontSize: 11, color: C.laranjaAlerta, fontWeight: 600 }}>conta contábil sem conta gerencial</span> : (l.ger_descricao ?? '')}
                        </td>
                        <td style={{ ...td, color: 'rgba(61,35,20,0.6)' }}>{l.ger_grupo ?? ''}</td>
                        <td style={{ ...td, textAlign: 'center', color: 'rgba(61,35,20,0.4)' }}>→</td>
                        <td style={td}>{l.cont_codigo ?? (semVinculo ? <span style={{ color: 'rgba(61,35,20,0.45)' }}>— sem vínculo —</span> : '')}</td>
                        <td style={{ ...td, color: 'rgba(61,35,20,0.75)' }}>{l.cont_descricao ?? ''}</td>
                        <td style={{ ...td, color: 'rgba(61,35,20,0.5)' }}>{l.cont_codigo_antigo ?? ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 12px', color: '#3D2314', verticalAlign: 'top' }
