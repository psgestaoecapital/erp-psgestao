'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const RED = '#C44536'

type Conta = {
  codigo: string
  nome: string
  pai: string | null
  natureza: string
  dre_grupo: string
  dre_ordem: number | null
  custom: boolean
  id: string | null // só custom
  descricao: string | null
}

// rótulos amigáveis dos grupos DRE (dre_grupo é TEXT livre em psgc_contas)
const GRUPO_LABEL: Record<string, string> = {
  NEUTRO: 'Neutro (transferências/estornos)', ROB: 'Receita Operacional Bruta',
  DEDUCOES: 'Deduções da Receita', IMPOSTOS_VENDA: 'Impostos sobre Vendas',
  CMV: 'Custo (CMV/CPV)', DESP_VARIAVEL: 'Despesas Variáveis', DESP_FIXA: 'Despesas Fixas',
  DEPREC_AMORT: 'Depreciação/Amortização', RESULT_FIN: 'Resultado Financeiro',
  NAO_OPER: 'Não Operacional', IR_CSLL: 'IR/CSLL',
}

function useEmpresa(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      return !v || v === 'consolidado' || v.startsWith('group_') ? null : v
    }
    setId(read())
    const t = setInterval(() => setId((p) => { const v = read(); return p === v ? p : v }), 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function PlanoContasPage() {
  const companyId = useEmpresa()
  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [criarSob, setCriarSob] = useState<Conta | null>(null)
  const [editar, setEditar] = useState<Conta | null>(null)
  const [nome, setNome] = useState('')
  const [desc, setDesc] = useState('')

  const carregar = useCallback(async () => {
    const [padraoRes, customRes] = await Promise.all([
      supabase.from('psgc_contas').select('codigo,nome,pai_codigo,natureza,dre_grupo,dre_ordem,descricao').eq('ativo', true),
      companyId
        ? supabase.from('psgc_contas_custom').select('id,codigo,nome,pai_psgc_codigo,natureza,dre_grupo,dre_ordem,descricao').eq('company_id', companyId).eq('ativo', true)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (padraoRes.error) { setErro(padraoRes.error.message); setLoading(false); return }
    setErro(null)
    const padrao: Conta[] = (padraoRes.data ?? []).map((c) => ({
      codigo: c.codigo, nome: c.nome, pai: c.pai_codigo, natureza: c.natureza, dre_grupo: c.dre_grupo, dre_ordem: c.dre_ordem, custom: false, id: null, descricao: c.descricao,
    }))
    const custom: Conta[] = (((customRes as { data: unknown[] | null }).data) ?? []).map((raw) => {
      const c = raw as { id: string; codigo: string; nome: string; pai_psgc_codigo: string; natureza: string; dre_grupo: string; dre_ordem: number | null; descricao: string | null }
      return { codigo: c.codigo, nome: c.nome, pai: c.pai_psgc_codigo, natureza: c.natureza, dre_grupo: c.dre_grupo, dre_ordem: c.dre_ordem, custom: true, id: c.id, descricao: c.descricao }
    })
    setContas([...padrao, ...custom])
    setLoading(false)
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  // ordena por dre_ordem depois codigo; indent = nº de segmentos do codigo - 1
  const ordenadas = useMemo(() =>
    [...contas].sort((a, b) => (a.dre_ordem ?? 9999) - (b.dre_ordem ?? 9999) || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })),
  [contas])

  async function salvarCriar() {
    if (!companyId || !criarSob || !nome.trim()) return
    setBusy(true); setErro(null)
    const { error } = await supabase.rpc('fn_psgc_contas_custom_criar', {
      p_company_id: companyId, p_pai_psgc_codigo: criarSob.codigo, p_nome: nome.trim(), p_descricao: desc.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setOk(`CRIOU subconta "${nome.trim()}" sob ${criarSob.nome}`); setCriarSob(null); setNome(''); setDesc(''); void carregar()
  }
  async function salvarEditar() {
    if (!companyId || !editar?.id || !nome.trim()) return
    setBusy(true); setErro(null)
    const { error } = await supabase.rpc('fn_psgc_contas_custom_editar', {
      p_id: editar.id, p_company_id: companyId, p_nome: nome.trim(), p_descricao: desc.trim() || null,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setOk(`ALTEROU "${nome.trim()}"`); setEditar(null); setNome(''); setDesc(''); void carregar()
  }
  async function excluir(c: Conta) {
    if (!companyId || !c.id) return
    if (!window.confirm(`Remover a conta custom "${c.nome}"? (some da árvore; histórico da DRE é preservado)`)) return
    const { error } = await supabase.rpc('fn_psgc_contas_custom_excluir', { p_id: c.id, p_company_id: companyId })
    if (error) { setErro(error.message); return }
    setOk(`REMOVEU "${c.nome}"`); void carregar()
  }

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60 }} className="p-6 text-sm min-h-screen">
      Selecione uma empresa específica para ver o plano de contas.
    </div>
  )

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP }} className="p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>Financeiro · DRE</div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Plano de Contas Gerenciais</h1>
          <p className="text-sm mt-1" style={{ color: ESP60 }}>As contas <b>padrão</b> são fixas (base da DRE). Adicione <b>subcontas da sua empresa</b> sob qualquer conta.</p>
        </header>

        {erro && <div className="rounded-xl p-3 text-sm" style={{ background: '#FCEBEB', color: RED }}>{erro}</div>}
        {ok && <div className="rounded-xl p-3 text-sm font-semibold" style={{ background: '#EAF3DE', color: '#3B6D11' }}>✓ {ok}</div>}

        {loading ? (
          <div className="text-sm" style={{ color: ESP60 }}>Carregando…</div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            {ordenadas.map((c) => {
              const nivel = Math.max(0, c.codigo.split('.').length - 1)
              return (
                <div key={c.codigo} className="flex items-center gap-2 px-3 py-2" style={{ borderTop: `1px solid ${LINE}`, paddingLeft: 12 + nivel * 18 }}>
                  <span className="text-xs font-mono shrink-0" style={{ color: ESP60, minWidth: 56 }}>{c.codigo}</span>
                  <span className="text-sm flex-1" style={{ color: ESP, fontWeight: nivel === 0 ? 700 : 400 }}>{c.nome}</span>
                  {c.custom
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#FAEEDA', color: '#854F0B' }}>custom</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: BG, color: ESP60 }}>padrão</span>}
                  <button onClick={() => { setCriarSob(c); setNome(''); setDesc('') }} title="Adicionar subconta" className="text-[10px] px-2 py-1 rounded" style={{ border: `1px solid ${GOLD}`, color: GOLD }}>+ sub</button>
                  {c.custom && (<>
                    <button onClick={() => { setEditar(c); setNome(c.nome); setDesc(c.descricao ?? '') }} className="text-[10px] px-2 py-1 rounded" style={{ background: BG, color: ESP }}>Editar</button>
                    <button onClick={() => void excluir(c)} className="text-[10px] px-2 py-1 rounded" style={{ background: '#fff', border: `1px solid ${RED}`, color: RED }}>Remover</button>
                  </>)}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {(criarSob || editar) && (
        <div onClick={() => { setCriarSob(null); setEditar(null) }} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-md" style={{ background: '#fff' }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>
              {editar ? 'Editar conta' : 'Nova subconta'}
            </h3>
            {criarSob && <div className="text-xs mb-3" style={{ color: ESP60 }}>Sob: <b>{criarSob.codigo} · {criarSob.nome}</b> ({GRUPO_LABEL[criarSob.dre_grupo] ?? criarSob.dre_grupo})</div>}
            <div className="space-y-2">
              <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da conta (ex.: Cartão de Crédito)" className="w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]" />
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)" className="w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setCriarSob(null); setEditar(null) }} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
              <button onClick={() => (editar ? void salvarEditar() : void salvarCriar())} disabled={busy || !nome.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy || !nome.trim() ? 0.6 : 1 }}>
                {busy ? 'Salvando…' : editar ? 'Salvar' : 'Criar subconta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
