'use client'

// #32 · ISS por município — cadastro das alíquotas por (município × item da LC 116), com fonte e
// vigência. É onde o contador informa o número que a emissão vai usar. Sem alíquota cadastrada, o
// serviço marcado "ISS no local da prestação" não emite (a alíquota nunca é chutada).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

type IssRow = {
  id: string
  codigo_ibge: string
  codigo_lc116: string
  aliquota: number
  retido_na_fonte: boolean | null
  fonte: string
  informado_por: string | null
  vigencia_inicio: string
  vigencia_fim: string | null
  observacao: string | null
  company_id: string | null
}
type Municipio = { codigo_ibge: string; nome_municipio: string; uf: string }

const FONTES: Array<[string, string]> = [
  ['contador', 'Contador informou'],
  ['cadastro_empresa', 'Cadastro da empresa'],
  ['acordo_coletivo', 'Acordo coletivo'],
  ['api_nacional', 'API do padrão nacional'],
]
const fonteLabel = (f: string) => FONTES.find(([v]) => v === f)?.[1] ?? f
const fmtData = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const fmtPct = (n: number) => `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`

export default function IssMunicipiosPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [rows, setRows] = useState<IssRow[]>([])
  const [nomes, setNomes] = useState<Record<string, Municipio>>({})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  // formulário de cadastro
  const [buscaMun, setBuscaMun] = useState('')
  const [muns, setMuns] = useState<Municipio[]>([])
  const [munSel, setMunSel] = useState<Municipio | null>(null)
  const [lc116, setLc116] = useState('')
  const [aliq, setAliq] = useState('')
  const [fonte, setFonte] = useState('contador')
  const [informado, setInformado] = useState('')
  const [retido, setRetido] = useState(false)
  const [vigencia, setVigencia] = useState(() => new Date().toISOString().slice(0, 10))
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('fiscal_iss_municipio')
      .select('id,codigo_ibge,codigo_lc116,aliquota,retido_na_fonte,fonte,informado_por,vigencia_inicio,vigencia_fim,observacao,company_id')
      .eq('company_id', companyId)
      .order('vigencia_inicio', { ascending: false })
    const lista = (data ?? []) as IssRow[]
    setRows(lista)
    // resolve nomes dos municípios em bloco
    const ibges = Array.from(new Set(lista.map((r) => r.codigo_ibge)))
    if (ibges.length) {
      const { data: m } = await supabase.from('erp_gov_nfse_municipios')
        .select('codigo_ibge,nome_municipio,uf').in('codigo_ibge', ibges)
      const map: Record<string, Municipio> = {}
      for (const x of (m ?? []) as Municipio[]) map[x.codigo_ibge] = x
      setNomes(map)
    } else {
      setNomes({})
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  // busca de município (debounce simples)
  useEffect(() => {
    const q = buscaMun.trim()
    if (q.length < 2) { setMuns([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      const { data } = await supabase.from('erp_gov_nfse_municipios')
        .select('codigo_ibge,nome_municipio,uf').ilike('nome_municipio', `${q}%`)
        .order('nome_municipio').limit(20)
      if (vivo) setMuns((data ?? []) as Municipio[])
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [buscaMun])

  async function salvar() {
    if (!companyId || !munSel) { setMsg('Erro: escolha o município.'); return }
    if (!lc116.trim()) { setMsg('Erro: informe o código da LC 116 (ex.: 07.02).'); return }
    const a = Number(aliq.replace(',', '.'))
    if (!isFinite(a) || a < 0 || a > 10) { setMsg('Erro: alíquota deve estar entre 0 e 10%.'); return }
    setSalvando(true); setMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_fiscal_iss_cadastrar', {
        p_company_id: companyId, p_codigo_ibge: munSel.codigo_ibge, p_codigo_lc116: lc116.trim(),
        p_aliquota: a, p_fonte: fonte, p_retido_na_fonte: retido,
        p_informado_por: informado.trim() || null, p_vigencia_inicio: vigencia, p_observacao: obs.trim() || null,
      })
      if (error) throw error
      const j = data as { ok?: boolean; erro?: string } | null
      if (!j?.ok) { setMsg('Erro: ' + (j?.erro ?? 'não foi possível cadastrar')); return }
      setMsg(`Alíquota de ${munSel.nome_municipio}/${munSel.uf} · LC ${lc116.trim()} cadastrada.`)
      setMunSel(null); setBuscaMun(''); setLc116(''); setAliq(''); setInformado(''); setObs(''); setRetido(false)
      void carregar()
    } catch (e) {
      setMsg('Erro ao cadastrar: ' + (e as Error).message)
    } finally { setSalvando(false) }
  }

  const vigentes = useMemo(() => rows.filter((r) => !r.vigencia_fim), [rows])

  if (!companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2]">
        <div className="max-w-4xl mx-auto px-4 py-8 text-[14px] text-[#3D2314]/70">
          Selecione uma empresa específica para cadastrar as alíquotas de ISS por município.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <header className="mb-5">
          <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
            Configurações · Fiscal
          </div>
          <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight">ISS por município</h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1.5 max-w-3xl">
            Alíquota de ISS por município da execução × item da LC 116, com vigência e origem do número.
            Serviço com “ISS no local da prestação” usa esta tabela na hora de faturar —
            <b> sem alíquota cadastrada, a nota não é emitida</b> (a alíquota nunca é chutada).
          </p>
        </header>

        {msg && (
          <div className={`mb-4 px-3 py-2 rounded-lg text-[12.5px] border ${msg.startsWith('Erro') ? 'bg-[#FCEBEB] text-[#791F1F] border-[#C94544]/30' : 'bg-[#EAF3DE] text-[#234D08] border-[#3B6D11]/30'}`}>
            {msg}
          </div>
        )}

        {/* cadastro */}
        <div className="bg-white border border-[#E7DECF] rounded-xl p-4 mb-6">
          <div className="text-[13px] font-medium text-[#3D2314] mb-3">Cadastrar alíquota</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="relative">
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Município da execução</label>
              {munSel ? (
                <div className="flex items-center justify-between bg-[#FAF7F2] border border-[#E7DECF] rounded-md px-3 py-2 text-[13px] text-[#3D2314]">
                  <span>{munSel.nome_municipio}/{munSel.uf} <span className="text-[#3D2314]/50">· IBGE {munSel.codigo_ibge}</span></span>
                  <button type="button" className="text-[#3D2314]/50 hover:text-[#3D2314]" onClick={() => { setMunSel(null); setBuscaMun('') }}>trocar</button>
                </div>
              ) : (
                <>
                  <input value={buscaMun} onChange={(e) => setBuscaMun(e.target.value)} placeholder="digite o nome do município…"
                    className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
                  {muns.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-[#E7DECF] rounded-md shadow-lg">
                      {muns.map((m) => (
                        <button key={m.codigo_ibge} type="button" onClick={() => { setMunSel(m); setMuns([]) }}
                          className="block w-full text-left px-3 py-2 text-[13px] text-[#3D2314] hover:bg-[#FAF7F2]">
                          {m.nome_municipio}/{m.uf} <span className="text-[#3D2314]/45">· {m.codigo_ibge}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Código LC 116 (subitem)</label>
              <input value={lc116} onChange={(e) => setLc116(e.target.value)} placeholder="ex.: 07.02"
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
            </div>
            <div>
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Alíquota (%)</label>
              <input value={aliq} onChange={(e) => setAliq(e.target.value)} inputMode="decimal" placeholder="ex.: 3,00"
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
            </div>
            <div>
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Origem do número</label>
              <select value={fonte} onChange={(e) => setFonte(e.target.value)}
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]">
                {FONTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Vigência a partir de</label>
              <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)}
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
            </div>
            <div>
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Quem informou (opcional)</label>
              <input value={informado} onChange={(e) => setInformado(e.target.value)} placeholder="ex.: Ervin (contador)"
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-[#3D2314] sm:col-span-2">
              <input type="checkbox" checked={retido} onChange={(e) => setRetido(e.target.checked)} />
              ISS retido na fonte pelo tomador neste município
            </label>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-[#3D2314]/60 mb-1">Observação (opcional)</label>
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: lei municipal, ofício do contador…"
                className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314]" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button type="button" onClick={salvar} disabled={salvando}
              className="px-4 py-2.5 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Cadastrar alíquota'}
            </button>
          </div>
        </div>

        {/* lista */}
        <div className="bg-white border border-[#E7DECF] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E7DECF] text-[13px] font-medium text-[#3D2314]">
            Cadastradas {loading ? '' : `(${vigentes.length} vigente${vigentes.length === 1 ? '' : 's'}${rows.length > vigentes.length ? ` · ${rows.length - vigentes.length} histórico` : ''})`}
          </div>
          {loading ? (
            <div className="px-4 py-6 text-[13px] text-[#3D2314]/55">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-[#3D2314]/55">
              Nenhuma alíquota cadastrada ainda. Cadastre acima, município a município, conforme a empresa fatura.
            </div>
          ) : (
            <div className="divide-y divide-[#F1EADD]">
              {rows.map((r) => {
                const m = nomes[r.codigo_ibge]
                const vigente = !r.vigencia_fim
                return (
                  <div key={r.id} className={`px-4 py-3 text-[13px] ${vigente ? '' : 'opacity-55'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-medium text-[#3D2314]">{m ? `${m.nome_municipio}/${m.uf}` : r.codigo_ibge}</span>
                        <span className="text-[#3D2314]/55"> · LC {r.codigo_lc116}</span>
                      </div>
                      <span className="font-medium text-[#3D2314] tabular-nums whitespace-nowrap">{fmtPct(r.aliquota)}</span>
                    </div>
                    <div className="text-[11.5px] text-[#3D2314]/55 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-[#F3ECDD] text-[#5C3B0B] mr-2">{fonteLabel(r.fonte)}</span>
                      vigência {fmtData(r.vigencia_inicio)}{r.vigencia_fim ? ` até ${fmtData(r.vigencia_fim)}` : ' (atual)'}
                      {r.informado_por ? ` · ${r.informado_por}` : ''}
                      {r.retido_na_fonte ? ' · retido na fonte' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
