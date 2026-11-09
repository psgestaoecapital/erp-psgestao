'use client'

// FEAT-CADASTRO-SERVICOS-v1 · PR-1
// Tela de cadastro de Servicos · espelha /dashboard/cadastros/produtos
// (server-side + paginacao real + busca · NAO client-side, anti #266).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ConfirmarClonar from '@/components/cadastros/ConfirmarClonar'
import ServicoForm, { type Servico } from '@/components/cadastros/ServicoForm'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Briefcase, Plus, Search, Edit, Loader2, Copy, Trash2, RotateCcw } from 'lucide-react'

export const dynamic = 'force-dynamic'

const ROTA = '/dashboard/cadastros/servicos'
const PAGE_SIZE = 50
type Situacao = 'ativos' | 'inativos' | 'todos'

// '*' (#286): inclui cst_pis_cofins quando a migration já rodou, sem quebrar enquanto não rodou
const SELECT_COLS = '*' // antes: 'id,company_id,codigo,descricao_resumida,descricao_detalhada,categoria,categoria_codigo,codigo_nbs,codigo_servico_municipio,codigo_lc116,cnae,cnae_secundario,tipo_tributacao,aliquota_iss,iss_no_local_prestacao,iss_retido,valor_unitario,pct_desconto,aliquota_pis,retem_pis,aliquota_cofins,retem_cofins,aliquota_ir,retem_ir,aliquota_csll,retem_csll,aliquota_inss,retem_inss,rt_cst,rt_classificacao_tributaria,rt_indicador_operacao,rt_aliquota_ibs_municipal,rt_aliquota_ibs_estadual,rt_aliquota_cbs,ativo'

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v))

const fmtPct = (v: number | null | undefined) =>
  v == null || Number(v) === 0 ? '—' : `${Number(v).toFixed(2).replace('.', ',')}%`

export default function ServicosPage() {
  const [servicos, setServicos] = useState<Servico[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [situacao, setSituacao] = useState<Situacao>('ativos')

  const [excluindoServico, setExcluindoServico] = useState<Servico | null>(null)
  const [acaoBusy, setAcaoBusy] = useState(false)
  const [acaoErro, setAcaoErro] = useState<string | null>(null)

  const [editando, setEditando] = useState<Servico | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  // Clonar: a lista traz '*' (SELECT_COLS), então o próprio registro da linha já tem todos os campos p/ pré-preencher.
  const [clonando, setClonando] = useState<Servico | null>(null)
  const [confirmarClone, setConfirmarClone] = useState<Servico | null>(null)
  const abrirClone = (s: Servico) => setConfirmarClone(s)
  const confirmarAbrirClone = () => { const s = confirmarClone; setConfirmarClone(null); if (s) { setEditando(null); setNovoAberto(false); setClonando(s) } }

  const offsetRef = useRef(0)

  useEffect(() => {
    const id = setTimeout(() => setBuscaDebounced(busca.trim()), 300)
    return () => clearTimeout(id)
  }, [busca])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const cid = localStorage.getItem('ps_empresa_sel')
    if (cid && !cid.startsWith('group_') && cid !== 'consolidado') {
      setCompanyId(cid)
    } else {
      setLoading(false)
    }
  }, [])

  const carregar = useCallback(
    async (reset: boolean) => {
      if (!companyId) return
      if (reset) {
        setLoading(true)
        offsetRef.current = 0
      } else {
        setLoadingMore(true)
      }
      setErro(null)
      try {
        let q = supabase
          .from('erp_servicos')
          .select(SELECT_COLS, { count: 'exact' })
          .eq('company_id', companyId)
        if (situacao === 'ativos') q = q.eq('ativo', true)
        else if (situacao === 'inativos') q = q.eq('ativo', false)

        if (buscaDebounced) {
          const b = buscaDebounced.replace(/[%,()]/g, '')
          q = q.or(`descricao_resumida.ilike.%${b}%,codigo.ilike.%${b}%,categoria.ilike.%${b}%`)
        }

        q = q.order('descricao_resumida', { ascending: true })
             .range(offsetRef.current, offsetRef.current + PAGE_SIZE - 1)

        const { data, count, error } = await q
        if (error) throw error
        const rows = (data ?? []) as unknown as Servico[]
        setTotal(count ?? 0)
        setServicos((prev) => (reset ? rows : [...prev, ...rows]))
        offsetRef.current += rows.length
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar servicos')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [companyId, buscaDebounced, situacao]
  )

  useEffect(() => {
    if (companyId) carregar(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, buscaDebounced, situacao])

  // Exclusão lógica rastreável (RD-98 p4): soft-delete + audit_log via RPC com guarda de empresa.
  async function confirmarExcluir() {
    if (!excluindoServico || !companyId) return
    setAcaoBusy(true); setAcaoErro(null)
    const { data, error } = await supabase.rpc('fn_erp_servico_excluir', { p_servico_id: excluindoServico.id, p_company_id: companyId })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setAcaoErro(error?.message ?? (r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Não foi possível excluir.')) }
    else { setExcluindoServico(null); await carregar(true) }
    setAcaoBusy(false)
  }

  async function reativar(s: Servico) {
    if (!companyId) return
    setAcaoBusy(true); setAcaoErro(null)
    const { data, error } = await supabase.rpc('fn_erp_servico_reativar', { p_servico_id: s.id, p_company_id: companyId })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) setAcaoErro(error?.message ?? 'Não foi possível reativar.')
    else await carregar(true)
    setAcaoBusy(false)
  }

  const podeCarregarMais = servicos.length < total
  const buscaAtiva = !!buscaDebounced
  const headerContagem = buscaAtiva ? `${servicos.length} de ${total} (filtrado)` : `${servicos.length} de ${total}`

  const contagemLabel = useMemo(() => headerContagem, [headerContagem])

  if (!companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="p-6 text-center text-[#3D2314]/70 text-[13px]">
            Selecione uma empresa específica (não consolidado ou grupo) pra cadastrar serviços.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">
              Cadastros · Gestão Empresarial
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
              <Briefcase size={22} className="text-[#C8941A]" /> Serviços
            </h1>
            <p className="text-[13px] text-[#3D2314]/70 mt-1.5">
              Catálogo pra emissão de NFS-e · classificação fiscal + retenções federais
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => setNovoAberto(true)}
              data-testid="servico-novo"
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2"
            >
              <Plus size={15} /> Novo Serviço
            </button>
            <AjudaCampo chave="cadastros.servicos.novo" rota={ROTA} />
          </div>
        </header>

        <div className="bg-white rounded-xl border border-[#3D2314]/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#3D2314]/10 flex items-center gap-2 flex-wrap">
            <Search size={15} className="text-[#3D2314]/50 flex-shrink-0" />
            <AjudaCampo chave="cadastros.servicos.busca" rota={ROTA} />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição, código ou categoria..."
              data-testid="servico-busca"
              className="flex-1 text-[13px] outline-none bg-transparent text-[#3D2314] placeholder:text-[#3D2314]/40 min-w-0"
            />
            <label className="flex items-center gap-1 text-[11.5px] text-[#3D2314]/70 flex-shrink-0">
              Situação <AjudaCampo chave="cadastros.servicos.filtro_situacao" rota={ROTA} />
              <select
                value={situacao}
                onChange={(e) => setSituacao(e.target.value as Situacao)}
                data-testid="servico-situacao"
                className="text-[12px] rounded-md border border-[#3D2314]/15 bg-white px-1.5 py-1 text-[#3D2314] outline-none"
              >
                <option value="ativos">Ativos</option>
                <option value="inativos">Inativos</option>
                <option value="todos">Todos</option>
              </select>
            </label>
            <span
              className="text-[11px] text-[#3D2314]/70 flex-shrink-0"
              data-testid="servicos-contagem"
            >
              {contagemLabel}
            </span>
          </div>

          {erro && (
            <div className="px-4 py-2 bg-[#FCEBEB] text-[#791F1F] text-[12.5px] border-b border-[#E8A6A5]">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="animate-spin text-[#C8941A]" size={24} />
            </div>
          ) : servicos.length === 0 ? (
            <div className="py-12 text-center text-[#3D2314]/70 text-[13px]">
              {buscaAtiva
                ? 'Nenhum serviço corresponde à busca · ajuste ou limpe pra ver mais.'
                : 'Nenhum serviço cadastrado · clique em "Novo Serviço" pra começar'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-[13px] text-[#3D2314]">
                  <thead className="bg-[#3D2314]/5 text-[11.5px] text-[#3D2314]/75 uppercase tracking-[0.5px]">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Código <AjudaCampo chave="cadastros.servicos.col_codigo" rota={ROTA} /></span></th>
                      <th className="text-left px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Descrição <AjudaCampo chave="cadastros.servicos.col_descricao" rota={ROTA} /></span></th>
                      <th className="text-left px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">LC 116 <AjudaCampo chave="cadastros.servicos.col_lc116" rota={ROTA} /></span></th>
                      <th className="text-right px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1 justify-end">% ISS <AjudaCampo chave="cadastros.servicos.col_iss" rota={ROTA} /></span></th>
                      <th className="text-right px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1 justify-end">Valor <AjudaCampo chave="cadastros.servicos.col_valor" rota={ROTA} /></span></th>
                      <th className="text-right px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1 justify-end">Ações <AjudaCampo chave="cadastros.servicos.col_acoes" rota={ROTA} /></span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {servicos.map((s) => (
                      <tr
                        key={s.id}
                        data-testid="servico-row"
                        className="border-t border-[#3D2314]/8 hover:bg-[#FAEEDA]/30"
                      >
                        <td className="px-4 py-2.5 font-mono text-[12px] text-[#3D2314]">{s.codigo ?? '—'}</td>
                        <td className="px-4 py-2.5 text-[#3D2314]">
                          <div className="font-medium">{s.descricao_resumida}</div>
                          {s.categoria && <div className="text-[11px] text-[#3D2314]/55">{s.categoria}</div>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-stone-500">{s.codigo_lc116 ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314]">{fmtPct(s.aliquota_iss)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#3D2314] font-medium">{fmtBRL(s.valor_unitario)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => abrirClone(s)}
                            data-testid="servico-clonar"
                            className="text-[#C8941A] hover:text-[#A87810] mr-3"
                            title="Clonar (criar novo a partir deste)"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditando(s)}
                            data-testid="servico-editar"
                            className="text-[#C8941A] hover:text-[#A87810] mr-3"
                            title="Editar"
                          >
                            <Edit size={14} />
                          </button>
                          {s.ativo === false ? (
                            <button
                              type="button"
                              onClick={() => void reativar(s)}
                              disabled={acaoBusy}
                              data-testid="servico-reativar"
                              className="text-[#5C8D3F] hover:text-[#456b2f] disabled:opacity-40"
                              title="Reativar serviço"
                            >
                              <RotateCcw size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setAcaoErro(null); setExcluindoServico(s) }}
                              data-testid="servico-excluir"
                              className="text-[#C44536] hover:text-[#9e3329]"
                              title="Excluir (exclusão lógica · vai para Inativos)"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-[#3D2314]/8">
                {servicos.map((s) => (
                  <div
                    key={s.id}
                    data-testid="servico-row-mobile"
                    className="px-4 py-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[#3D2314] leading-tight">
                        {s.descricao_resumida}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-stone-500 flex-wrap">
                        <span className="font-mono text-[#3D2314]/85">{s.codigo ?? '—'}</span>
                        {s.codigo_lc116 && <><span>·</span><span className="font-mono">LC {s.codigo_lc116}</span></>}
                        {s.aliquota_iss != null && Number(s.aliquota_iss) > 0 && <><span>·</span><span>{fmtPct(s.aliquota_iss)} ISS</span></>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <div className="text-[13.5px] tabular-nums font-medium text-[#3D2314]">{fmtBRL(s.valor_unitario)}</div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => abrirClone(s)}
                          data-testid="servico-clonar-mobile"
                          className="text-[#C8941A] hover:text-[#A87810]"
                          title="Clonar"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(s)}
                          className="text-[#C8941A] hover:text-[#A87810]"
                          title="Editar"
                        >
                          <Edit size={14} />
                        </button>
                        {s.ativo === false ? (
                          <button
                            type="button"
                            onClick={() => void reativar(s)}
                            disabled={acaoBusy}
                            data-testid="servico-reativar-mobile"
                            className="text-[#5C8D3F] hover:text-[#456b2f] disabled:opacity-40"
                            title="Reativar"
                          >
                            <RotateCcw size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setAcaoErro(null); setExcluindoServico(s) }}
                            data-testid="servico-excluir-mobile"
                            className="text-[#C44536] hover:text-[#9e3329]"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {podeCarregarMais && (
                <div className="px-4 py-3 border-t border-[#3D2314]/10 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => carregar(false)}
                    disabled={loadingMore}
                    data-testid="servico-carregar-mais"
                    className="px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40 flex items-center gap-2"
                  >
                    {loadingMore ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Carregar mais (faltam {total - servicos.length})
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <ConfirmarClonar aberto={!!confirmarClone} onConfirmar={confirmarAbrirClone} onCancelar={() => setConfirmarClone(null)} />

        {excluindoServico && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="excluir-servico">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-[#3D2314]">Excluir este serviço?</h3>
                <AjudaCampo chave="cadastros.servicos.excluir" rota={ROTA} />
              </div>
              <p className="mt-2 text-[13.5px] text-[#3D2314]/70" data-testid="excluir-servico-confirmar">
                <strong className="text-[#3D2314]">{excluindoServico.codigo ? `${excluindoServico.codigo} · ` : ''}{excluindoServico.descricao_resumida}</strong> sai da lista
                de serviços ativos. É exclusão lógica: nada é apagado — fica em <strong>Inativos</strong> e pode ser reativado, com registro de quem e quando.
              </p>
              {acaoErro && <p className="mt-3 text-[13px] text-red-700" data-testid="excluir-servico-erro">{acaoErro}</p>}
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setExcluindoServico(null)} data-testid="excluir-servico-cancelar" className="rounded-lg px-4 py-2 text-[13px] text-[#3D2314]/70 hover:bg-stone-100">Cancelar</button>
                <button type="button" onClick={() => void confirmarExcluir()} disabled={acaoBusy} data-testid="excluir-servico-ok" className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-50">
                  {acaoBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir serviço
                </button>
              </div>
            </div>
          </div>
        )}

        {(novoAberto || editando || clonando) && (
          <ServicoForm
            key={editando ? `edit-${editando.id}` : clonando ? `clone-${clonando.id}` : 'novo'}
            companyId={companyId}
            servico={editando}
            clonarDe={clonando}
            onClonar={(s) => abrirClone(s)}
            onClose={() => {
              setNovoAberto(false)
              setEditando(null)
              setClonando(null)
            }}
            onSalvo={() => {
              setNovoAberto(false)
              setEditando(null)
              setClonando(null)
              carregar(true)
            }}
          />
        )}
      </div>
    </div>
  )
}
