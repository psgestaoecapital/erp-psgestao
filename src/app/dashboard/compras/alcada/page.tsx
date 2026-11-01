'use client'

// #1677 (B1) · Alçada de compras — tela da configuração por empresa (o banco veio na etapa A, #2101):
// quem aprova (principal e substituto), quantos orçamentos a solicitação exige (3 padrão ou 1) e quais categorias
// liberam compra urgente. Só Master grava (fn_compras_alcada_salvar confere); os demais veem em modo leitura.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { validarAlcadaForm } from '@/lib/compras/alcada'

type Usuario = { id: string; full_name: string | null; email: string | null; is_active: boolean }
type Config = {
  configurada: boolean
  aprovador_principal_id: string | null
  aprovador_substituto_id: string | null
  min_orcamentos: 1 | 3
  urgencia_categorias: string[]
  urgencia_produto_ids: string[]
  pode_configurar: boolean
}

const nomeUsuario = (u: Usuario) => u.full_name?.trim() || u.email || 'Usuário'

export default function AlcadaComprasPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [cfg, setCfg] = useState<Config | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [categoriasProdutos, setCategoriasProdutos] = useState<string[]>([])
  const [principal, setPrincipal] = useState('')
  const [substituto, setSubstituto] = useState('')
  const [minOrc, setMinOrc] = useState<1 | 3>(3)
  const [categorias, setCategorias] = useState<string[]>([])
  const [novaCat, setNovaCat] = useState('')
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setCfg(null); setLoading(false); return }
    setLoading(true); setMsg(null)
    const [{ data: c, error: cErr }, { data: us }, { data: prods }] = await Promise.all([
      supabase.rpc('fn_compras_alcada_obter', { p_company_id: empresa }),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
      supabase.from('erp_produtos').select('categoria').eq('company_id', empresa).not('categoria', 'is', null).limit(2000),
    ])
    if (cErr || !c) { setMsg({ tipo: 'erro', texto: cErr?.message ?? 'Não foi possível ler a alçada.' }); setLoading(false); return }
    const conf = c as Config
    setCfg(conf)
    setPrincipal(conf.aprovador_principal_id ?? '')
    setSubstituto(conf.aprovador_substituto_id ?? '')
    setMinOrc(conf.min_orcamentos === 1 ? 1 : 3)
    setCategorias(conf.urgencia_categorias ?? [])
    setUsuarios(((us ?? []) as Usuario[]).filter((u) => u.is_active))
    const cats = new Set<string>()
    for (const p of (prods ?? []) as { categoria: string | null }[]) if (p.categoria?.trim()) cats.add(p.categoria.trim())
    setCategoriasProdutos([...cats].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    setLoading(false)
  }, [empresa])

  useEffect(() => { carregar() }, [carregar])

  const somenteLeitura = !cfg?.pode_configurar
  const sugestoesCat = useMemo(() => categoriasProdutos.filter((c) => !categorias.includes(c)), [categoriasProdutos, categorias])

  const addCategoria = (c: string) => {
    const v = c.trim()
    if (!v || categorias.some((x) => x.toLowerCase() === v.toLowerCase())) { setNovaCat(''); return }
    setCategorias([...categorias, v]); setNovaCat('')
  }

  const salvar = async () => {
    if (!empresa || !cfg) return
    const erro = validarAlcadaForm({ principal, substituto })
    if (erro) { setMsg({ tipo: 'erro', texto: erro }); return }
    setSalvando(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_compras_alcada_salvar', {
      p_company_id: empresa,
      p_config: {
        aprovador_principal_id: principal || null,
        aprovador_substituto_id: substituto || null,
        min_orcamentos: minOrc,
        urgencia_categorias: categorias,
        urgencia_produto_ids: cfg.urgencia_produto_ids ?? [],
      },
    })
    setSalvando(false)
    const r = data as { sucesso?: boolean; erro?: string } | null
    if (error || !r?.sucesso) { setMsg({ tipo: 'erro', texto: error?.message ?? r?.erro ?? 'Não foi possível salvar.' }); return }
    setMsg({ tipo: 'ok', texto: 'Alçada salva. Vale para as próximas solicitações de compra.' })
    carregar()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-7 w-7 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Alçada de compras</h1>
          <p className="mt-1 text-sm text-gray-600">
            Quem aprova as solicitações de compra desta empresa, quantos orçamentos cada uma precisa e o que pode ser comprado com urgência.
          </p>
        </div>
      </header>

      {!empresa && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Escolha uma empresa no topo da tela para ver a alçada.</p>}
      {empresa && loading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>}

      {empresa && !loading && cfg && (
        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-6">
          {somenteLeitura && (
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              Você pode consultar. Para alterar, peça a um usuário Master (sócio, gerente com acesso total ou dono da empresa).
            </p>
          )}
          {!cfg.configurada && !somenteLeitura && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Alçada ainda não configurada: defina pelo menos o aprovador principal.</p>
          )}

          <section className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
                Aprovador principal <AjudaCampo chave="compras.alcada.aprovador_principal" />
              </span>
              <select value={principal} disabled={somenteLeitura} onChange={(e) => setPrincipal(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base disabled:bg-gray-50">
                <option value="">— escolha —</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{nomeUsuario(u)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
                Aprovador substituto <AjudaCampo chave="compras.alcada.aprovador_substituto" />
              </span>
              <select value={substituto} disabled={somenteLeitura} onChange={(e) => setSubstituto(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base disabled:bg-gray-50">
                <option value="">— nenhum —</option>
                {usuarios.filter((u) => u.id !== principal).map((u) => <option key={u.id} value={u.id}>{nomeUsuario(u)}</option>)}
              </select>
            </label>
          </section>

          <section>
            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
              Orçamentos exigidos por solicitação <AjudaCampo chave="compras.alcada.min_orcamentos" />
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {([3, 1] as const).map((n) => (
                <button key={n} type="button" disabled={somenteLeitura} onClick={() => setMinOrc(n)}
                  className={`rounded-full border px-4 py-2 text-sm ${minOrc === n ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-800' : 'border-gray-300 text-gray-700'} disabled:opacity-60`}>
                  {n === 3 ? '3 orçamentos (padrão)' : '1 orçamento'}
                </button>
              ))}
            </div>
          </section>

          <section>
            <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
              Categorias liberadas para compra urgente <AjudaCampo chave="compras.alcada.urgencia_categorias" />
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {categorias.length === 0 && <span className="text-sm text-gray-500">Nenhuma: toda compra passa pela aprovação.</span>}
              {categorias.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">
                  {c}
                  {!somenteLeitura && (
                    <button type="button" aria-label={`Tirar ${c}`} onClick={() => setCategorias(categorias.filter((x) => x !== c))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!somenteLeitura && (
              <div className="mt-3 flex gap-2">
                <label className="flex-1">
                  <span className="flex items-center gap-1 text-xs text-gray-600">
                    Incluir categoria <AjudaCampo chave="compras.alcada.incluir_categoria" />
                  </span>
                  <input list="alcada-categorias" value={novaCat} onChange={(e) => setNovaCat(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategoria(novaCat) } }}
                    placeholder="Ex.: Lubrificantes" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
                  <datalist id="alcada-categorias">{sugestoesCat.map((c) => <option key={c} value={c} />)}</datalist>
                </label>
                <button type="button" onClick={() => addCategoria(novaCat)}
                  className="self-end rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700">Incluir</button>
              </div>
            )}
          </section>

          {msg && (
            <p className={`rounded-lg p-3 text-sm ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.texto}</p>
          )}

          {!somenteLeitura && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={salvar} disabled={salvando}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar alçada
              </button>
              <AjudaCampo chave="compras.alcada.salvar" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
