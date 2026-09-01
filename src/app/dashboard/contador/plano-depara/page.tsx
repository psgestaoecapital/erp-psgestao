'use client'

// Contábil · Fase 1 — Importador de plano de contas do contador (de-para de contas).
// Popula contabil_conta_depara pelo CSV que o contador já exporta, SEM digitação. Casa só o exato
// (código estruturado = código do plano PS); o resto vira PENDENTE nomeado — nunca uma conta padrão
// genérica (RD-51). Numeração por empresa. Pré-requisito do exportador (não gera arquivo antes disto).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { FileSpreadsheet, Link2, AlertTriangle, Check, Search } from 'lucide-react'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318',
}

type Campo = 'ignorar' | 'codigo_externo' | 'codigo_estruturado' | 'descricao_externa' | 'analitica'
const CAMPO_LABEL: Record<Campo, string> = {
  ignorar: '— ignorar —',
  codigo_externo: 'Código do contador (ex. 142)',
  codigo_estruturado: 'Código estruturado do PS (ex. 1.01.01)',
  descricao_externa: 'Descrição',
  analitica: 'Analítica / Sintética (A/S)',
}

type DeparaLinha = {
  id: string; codigo_externo: string; descricao_externa: string | null; analitica: boolean | null
  ativo: boolean; plano_conta_id: string | null; plano_codigo: string | null; plano_descricao: string | null
  pendente: boolean
}
type PlanoHit = { codigo: string; descricao: string; is_totalizador: boolean }

function detectarSeparador(linha: string): string {
  const cands: [string, number][] = [['\t', (linha.match(/\t/g) || []).length], [';', (linha.match(/;/g) || []).length], [',', (linha.match(/,/g) || []).length]]
  cands.sort((a, b) => b[1] - a[1])
  return cands[0][1] > 0 ? cands[0][0] : '\t'
}

export default function PlanoDeParaPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds.length === 1 ? companyIds[0] : null

  const [texto, setTexto] = useState('')
  const [temCabecalho, setTemCabecalho] = useState(true)
  const [mapa, setMapa] = useState<Record<number, Campo>>({})
  const [importando, setImportando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [linhasDepara, setLinhasDepara] = useState<DeparaLinha[]>([])
  const [totais, setTotais] = useState<{ total: number; pendentes: number; casadas: number } | null>(null)
  const [soPendentes, setSoPendentes] = useState(false)

  // ── parse do texto colado ──
  const parsed = useMemo(() => {
    const linhas = texto.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0)
    if (linhas.length === 0) return { headers: [] as string[], rows: [] as string[][], sep: '\t' }
    const sep = detectarSeparador(linhas[0])
    const matrix = linhas.map((l) => l.split(sep))
    const headers = temCabecalho ? matrix[0] : matrix[0].map((_, i) => `Coluna ${i + 1}`)
    const rows = temCabecalho ? matrix.slice(1) : matrix
    return { headers, rows, sep }
  }, [texto, temCabecalho])

  // sugere mapeamento inicial pelo nome do cabeçalho
  useEffect(() => {
    if (parsed.headers.length === 0) return
    const m: Record<number, Campo> = {}
    parsed.headers.forEach((h, i) => {
      const t = (h || '').toLowerCase()
      if (/reduz|contador|externo|c[oó]d\.?red|^cod$/.test(t)) m[i] = 'codigo_externo'
      else if (/estrut|classific|cont[aá]bil|c[oó]digo/.test(t)) m[i] = 'codigo_estruturado'
      else if (/descr|nome|conta/.test(t)) m[i] = 'descricao_externa'
      else if (/anal|sint|tipo/.test(t)) m[i] = 'analitica'
      else m[i] = 'ignorar'
    })
    setMapa(m)
  }, [parsed.headers.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const temCodExterno = Object.values(mapa).includes('codigo_externo')

  const carregarDepara = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase.rpc('fn_contabil_depara_listar', { p_company_id: companyId, p_somente_pendentes: soPendentes })
    const r = data as { ok?: boolean; erro?: string; linhas?: DeparaLinha[]; totais?: { total: number; pendentes: number; casadas: number } } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao listar de-para'); return }
    setLinhasDepara(r.linhas ?? []); setTotais(r.totais ?? null)
  }, [companyId, soPendentes])

  useEffect(() => { void carregarDepara() }, [carregarDepara])

  async function importar() {
    if (!companyId || !temCodExterno) return
    setImportando(true); setErro(null); setMsg(null)
    const rows = parsed.rows.map((cols) => {
      const obj: Record<string, string> = {}
      Object.entries(mapa).forEach(([idx, campo]) => {
        if (campo === 'ignorar') return
        obj[campo] = (cols[Number(idx)] ?? '').trim()
      })
      return obj
    }).filter((o) => (o.codigo_externo ?? '').length > 0)
    const { data, error } = await supabase.rpc('fn_contabil_depara_importar', { p_company_id: companyId, p_escritorio_id: null, p_rows: rows })
    setImportando(false)
    const r = data as { ok?: boolean; erro?: string; importadas?: number; casadas_exato?: number; pendentes?: number } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao importar'); return }
    setMsg(`✅ ${r.importadas ?? 0} conta(s) importada(s) · ${r.casadas_exato ?? 0} casada(s) automaticamente · ${r.pendentes ?? 0} pendente(s) para vincular.`)
    setTexto('')
    await carregarDepara()
  }

  if (!companyId) {
    return <div style={{ padding: 24, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo — o de-para de contas é por empresa (o 142 de um cliente não é o de outro).</div>
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 14px 44px', maxWidth: 1000, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>📒 Contábil</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <FileSpreadsheet size={22} color={C.gold} /> Plano de contas do contador
      </h1>
      <p style={{ color: C.espM, fontSize: 13, marginTop: 6, marginBottom: 16 }}>
        Cole o plano que o contador exporta. O sistema casa cada conta ao plano do PS quando o código bate exatamente;
        o que não casar fica <strong>pendente</strong>, nomeado, para você vincular — nunca uma conta padrão inventada.
      </p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{msg}</div>}
      {erro && <div style={{ background: '#FCEBEB', color: C.red, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {/* ── Importar ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>1 · Colar o plano exportado</div>
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={'Cole aqui as linhas do plano (TAB, ; ou , são detectados automaticamente).\nEx.:\n142\t1.01.01\tClientes Diversos\tA\n2860\t\tJuros Recebidos\tA'}
          rows={6}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, color: C.esp, boxSizing: 'border-box', resize: 'vertical' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.espM, marginTop: 8 }}>
          <input type="checkbox" checked={temCabecalho} onChange={(e) => setTemCabecalho(e.target.checked)} /> a primeira linha é cabeçalho
        </label>

        {parsed.headers.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }}>2 · Dizer o que é cada coluna</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {parsed.headers.map((h, i) => (
                <label key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.espM }}>
                  <span style={{ fontFamily: 'monospace', color: C.esp }}>{h || `Coluna ${i + 1}`}</span>
                  <select value={mapa[i] ?? 'ignorar'} onChange={(e) => setMapa((m) => ({ ...m, [i]: e.target.value as Campo }))}
                    style={{ padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, background: C.white, color: C.esp, minWidth: 190 }}>
                    {(Object.keys(CAMPO_LABEL) as Campo[]).map((c) => <option key={c} value={c}>{CAMPO_LABEL[c]}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {/* prévia */}
            <div style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }}>3 · Prévia ({parsed.rows.length} linha(s))</div>
            <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: C.cream }}>
                  <tr><Th>Código contador</Th><Th>Código estruturado</Th><Th>Descrição</Th><Th>A/S</Th></tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((cols, ri) => {
                    const get = (campo: Campo) => { const idx = Object.entries(mapa).find(([, c]) => c === campo)?.[0]; return idx != null ? (cols[Number(idx)] ?? '').trim() : '' }
                    return (
                      <tr key={ri} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td mono>{get('codigo_externo') || '—'}</Td><Td mono>{get('codigo_estruturado') || '—'}</Td>
                        <Td>{get('descricao_externa') || '—'}</Td><Td>{get('analitica') || '—'}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!temCodExterno && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.amber, fontSize: 12, marginTop: 8 }}>
                <AlertTriangle size={14} /> Marque qual coluna é o <strong>código do contador</strong> — é obrigatório.
              </div>
            )}
            <button type="button" disabled={!temCodExterno || importando || parsed.rows.length === 0} onClick={() => void importar()}
              style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: 'none', background: (!temCodExterno || importando) ? C.espL : C.gold, color: C.white, fontWeight: 700, fontSize: 13, cursor: (!temCodExterno || importando) ? 'not-allowed' : 'pointer' }}>
              {importando ? 'Importando…' : `Importar ${parsed.rows.length} conta(s)`}
            </button>
          </>
        )}
      </div>

      {/* ── De-para atual ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>De-para atual</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {totais && (
            <div style={{ fontSize: 12, color: C.espM }}>
              {totais.total} conta(s) · <span style={{ color: C.green, fontWeight: 700 }}>{totais.casadas} casada(s)</span>
              {totais.pendentes > 0 && <> · <span style={{ color: C.amber, fontWeight: 700 }}>{totais.pendentes} pendente(s)</span></>}
            </div>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.espM }}>
            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> só pendentes
          </label>
        </div>
      </div>

      {linhasDepara.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '24px 16px', textAlign: 'center', color: C.espM, fontSize: 13 }}>
          Nenhuma conta no de-para {soPendentes ? 'pendente' : 'ainda'}. Importe o plano do contador acima.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {linhasDepara.map((l) => (
            <DeparaRow key={l.id} companyId={companyId} linha={l} onChange={carregarDepara} onErro={setErro} />
          ))}
        </div>
      )}
    </div>
  )
}

// linha do de-para: mostra a conta do contador + o vínculo (ou busca pra vincular)
function DeparaRow({ companyId, linha, onChange, onErro }: { companyId: string; linha: DeparaLinha; onChange: () => void; onErro: (m: string) => void }) {
  const [abrirBusca, setAbrirBusca] = useState(false)
  const [termo, setTermo] = useState('')
  const [hits, setHits] = useState<PlanoHit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!abrirBusca) return
    const h = window.setTimeout(async () => {
      const { data } = await supabase.rpc('fn_plano_contas_buscar', { p_company_id: companyId, p_termo: termo || null, p_aplicacao: null })
      setHits(((data as PlanoHit[]) ?? []).filter((x) => !x.is_totalizador).slice(0, 20)) // só analítica aceita lançamento
    }, 250)
    return () => window.clearTimeout(h)
  }, [termo, abrirBusca, companyId])

  async function vincular(codigo: string | null) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_contabil_depara_vincular', { p_depara_id: linha.id, p_plano_codigo: codigo })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { onErro(error?.message || r?.erro || 'Falha ao vincular'); return }
    setAbrirBusca(false); setTermo(''); setHits([])
    onChange()
  }

  return (
    <div style={{ background: C.white, border: `1px solid ${linha.pendente ? C.amber + '66' : C.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 90 }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{linha.codigo_externo}</div>
          {linha.analitica === false && <span style={{ fontSize: 9.5, color: C.espL }}>sintética</span>}
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: 13, color: C.esp, overflow: 'hidden', textOverflow: 'ellipsis' }}>{linha.descricao_externa || '—'}</div>
        </div>
        {linha.pendente ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.amber, background: C.amberBg, padding: '3px 8px', borderRadius: 999, fontWeight: 700 }}>
            <AlertTriangle size={12} /> pendente
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.green }}>
            <Check size={14} /> <span style={{ fontFamily: 'monospace' }}>{linha.plano_codigo}</span> {linha.plano_descricao}
          </span>
        )}
        <button type="button" onClick={() => setAbrirBusca((v) => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.esp, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          <Link2 size={13} /> {linha.pendente ? 'Vincular' : 'Trocar'}
        </button>
      </div>

      {abrirBusca && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, padding: '0 10px' }}>
            <Search size={14} color={C.espL} />
            <input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar conta do PS por código ou nome…"
              style={{ flex: 1, border: 'none', padding: '8px 0', fontSize: 13, color: C.esp, outline: 'none', background: 'transparent' }} />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6 }}>
            {hits.map((p) => (
              <button key={p.codigo} type="button" disabled={busy} onClick={() => void vincular(p.codigo)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', border: 'none', background: 'none', borderBottom: `1px solid ${C.border}55`, cursor: 'pointer', fontSize: 12, color: C.esp }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.codigo}</span> {p.descricao}
              </button>
            ))}
            {termo.length >= 1 && hits.length === 0 && <div style={{ fontSize: 12, color: C.espL, padding: '7px 8px' }}>Nenhuma conta analítica encontrada.</div>}
          </div>
          {!linha.pendente && (
            <button type="button" disabled={busy} onClick={() => void vincular(null)} style={{ fontSize: 11, color: C.red, background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}>
              desvincular (volta a pendente)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, fontWeight: 700 }}>{children}</th>
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td style={{ padding: '7px 10px', fontFamily: mono ? 'monospace' : undefined, color: C.esp }}>{children}</td>
}
