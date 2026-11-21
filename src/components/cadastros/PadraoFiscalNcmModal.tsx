'use client'

// Padrão fiscal por NCM (chamado #4051 · Gean Auto, vale para todas as empresas) — FATIA 2 (tela).
// Cadastra UMA vez "todo item com NCM X entra com CST/CSOSN do ICMS, CST do PIS e da COFINS e CFOP de venda Y".
// Ao criar o produto pela entrada da NF, o sistema preenche os campos fiscais a partir do padrão MAIS ESPECÍFICO
// cujo NCM é prefixo do NCM do produto (fatia 3). Reusa os seletores da "Edição fiscal em massa"
// (src/lib/produtos/fiscalMassa.ts — RD-26) e o CRUD do backend (fn_padrao_fiscal_ncm_* — fatia 1).
// RD-95: "?" em todo campo/ação/lista. RD-98: incluir, editar e excluir visíveis.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Loader2, Plus, Pencil, Trash2, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CAMPOS_FISCAIS, type CampoFiscal, ehSimples, opcoesDoCampo, rotuloCampo } from '@/lib/produtos/fiscalMassa'

const ROTA = '/dashboard/cadastros/produtos'

type Padrao = {
  id: string
  ncm: string
  tipo_item_sped: string | null
  cst_icms: string | null
  cst_pis: string | null
  cst_cofins: string | null
  cfop_venda: string | null
  cfop_venda_interestadual: string | null
  observacao: string | null
}

type Valores = Record<CampoFiscal, string>
const VAZIO: Valores = { tipo_item_sped: '', cst_icms: '', cst_pis: '', cst_cofins: '', cfop_venda: '', cfop_venda_interestadual: '' }

interface Props { companyId: string; onClose: () => void; onSalvo?: () => void }

const lbl = 'text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 flex items-center gap-1 mb-1 font-medium'
const inp = 'w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314]'

export default function PadraoFiscalNcmModal({ companyId, onClose, onSalvo }: Props) {
  const [regime, setRegime] = useState<string | null>(null)
  const [lista, setLista] = useState<Padrao[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [ncm, setNcm] = useState('')
  const [valores, setValores] = useState<Valores>(VAZIO)
  const [observacao, setObservacao] = useState('')

  const simples = ehSimples(regime)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: comp }, { data, error }] = await Promise.all([
      supabase.from('companies').select('regime_tributario').eq('id', companyId).maybeSingle(),
      supabase.rpc('fn_padrao_fiscal_ncm_listar', { p_company_id: companyId }),
    ])
    setRegime((comp as { regime_tributario: string | null } | null)?.regime_tributario ?? null)
    if (error) setErro(error.message)
    else setLista((data ?? []) as Padrao[])
    setCarregando(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  function limpar() {
    setEditId(null); setNcm(''); setValores(VAZIO); setObservacao(''); setErro(null)
  }

  function editar(p: Padrao) {
    setEditId(p.id); setNcm(p.ncm)
    setValores({
      tipo_item_sped: p.tipo_item_sped ?? '', cst_icms: p.cst_icms ?? '', cst_pis: p.cst_pis ?? '',
      cst_cofins: p.cst_cofins ?? '', cfop_venda: p.cfop_venda ?? '', cfop_venda_interestadual: p.cfop_venda_interestadual ?? '',
    })
    setObservacao(p.observacao ?? ''); setErro(null)
  }

  const ncmLimpo = useMemo(() => ncm.replace(/\D/g, ''), [ncm])
  const ncmValido = /^[0-9]{2,8}$/.test(ncmLimpo)
  const temAlgumValor = Object.values(valores).some((v) => v)

  async function salvar() {
    setErro(null)
    if (!ncmValido) { setErro('Informe o NCM com 2 a 8 dígitos — o início (ex.: 8708) ou completo (ex.: 87081000).'); return }
    if (!temAlgumValor) { setErro('Escolha ao menos um campo fiscal para o padrão (senão ele não preenche nada).'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_padrao_fiscal_ncm_salvar', {
      p_company_id: companyId, p_ncm: ncmLimpo,
      p_tipo_item_sped: valores.tipo_item_sped || null, p_cst_icms: valores.cst_icms || null,
      p_cst_pis: valores.cst_pis || null, p_cst_cofins: valores.cst_cofins || null,
      p_cfop_venda: valores.cfop_venda || null, p_cfop_venda_interestadual: valores.cfop_venda_interestadual || null,
      p_observacao: observacao.trim() || null, p_id: editId,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string; detalhe?: string } | null
    if (error) { setErro(error.message); return }
    if (!r?.ok) { setErro(r?.detalhe ?? r?.erro ?? 'Não foi possível salvar o padrão.'); return }
    limpar(); await carregar(); onSalvo?.()
  }

  async function excluir(p: Padrao) {
    if (!window.confirm(`Excluir o padrão fiscal do NCM ${p.ncm}? Produtos já cadastrados não mudam.`)) return
    const { data, error } = await supabase.rpc('fn_padrao_fiscal_ncm_remover', { p_company_id: companyId, p_id: p.id })
    const r = data as { ok?: boolean } | null
    if (error || !r?.ok) { setErro(error?.message ?? 'Não foi possível excluir.'); return }
    if (editId === p.id) limpar()
    await carregar(); onSalvo?.()
  }

  function resumo(p: Padrao): string {
    const partes = CAMPOS_FISCAIS
      .filter((c) => p[c])
      .map((c) => `${rotuloCampo(c, simples)} ${p[c]}`)
    return partes.length ? partes.join(' · ') : 'sem campo definido'
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-[#3D2314]/50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} data-testid="padrao-fiscal-ncm-modal" className="bg-[#FAF7F2] rounded-xl w-full max-w-3xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#3D2314] rounded-t-xl">
          <h2 className="text-[16px] font-semibold text-[#C8941A] m-0">Padrão fiscal por NCM</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#FAF7F2] p-2"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 text-[#3D2314]">
          <p className="text-[12.5px] text-[#3D2314]/75">
            Cadastre uma vez a tributação de cada <b>NCM</b>: quando um produto desse NCM for criado pela entrada da nota,
            o sistema já preenche <b>{rotuloCampo('cst_icms', simples)}</b>, <b>CST do PIS/COFINS</b>, <b>Tipo do item (SPED)</b> e
            o <b>CFOP de venda</b>. O NCM pode ser o início (ex.: <b>8708</b>, todas as autopeças) ou completo; vale o <b>mais específico</b>.
            Produtos já cadastrados não mudam — para eles use a <b>Edição fiscal em massa</b>.
            {regime && <> Regime: <b>{regime}</b> → ICMS em <b>{simples ? 'CSOSN (3 dígitos)' : 'CST (2 dígitos)'}</b>.</>}
          </p>

          {/* formulário incluir/editar */}
          <section className="rounded-lg border border-[#3D2314]/10 bg-white p-4">
            <div className="text-[12px] font-semibold mb-3 flex items-center gap-1.5">
              {editId ? <><Pencil size={13} /> Editar padrão</> : <><Plus size={13} /> Novo padrão</>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="block">
                <span className={lbl}>NCM<AjudaCampo chave="cadastros.produtos.padrao_fiscal.ncm" rota={ROTA} /></span>
                <input value={ncm} onChange={(e) => setNcm(e.target.value)} inputMode="numeric" placeholder="ex.: 8708 ou 87081000"
                  data-testid="pf-ncm" className={inp} disabled={!!editId} />
              </label>
              {CAMPOS_FISCAIS.map((c) => (
                <label key={c} className="block">
                  <span className={lbl}>{rotuloCampo(c, simples)}<AjudaCampo chave={`cadastros.produtos.padrao_fiscal.${c}`} rota={ROTA} /></span>
                  <select value={valores[c]} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} data-testid={`pf-${c}`} className={inp}>
                    <option value="">— não definir —</option>
                    {opcoesDoCampo(c, simples).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.rotulo}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <label className="block mt-3">
              <span className={lbl}>Observação<AjudaCampo chave="cadastros.produtos.padrao_fiscal.observacao" rota={ROTA} /></span>
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} data-testid="pf-observacao" className={inp}
                placeholder="ex.: autopeças com ICMS já retido por ST — confirmado pelo contador" />
            </label>
            {erro && <div data-testid="pf-erro" className="mt-3 px-3 py-2 rounded bg-[#FCEBEB] text-[#791F1F] text-[12.5px] border border-[#E8A6A5]">{erro}</div>}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <AjudaCampo chave="cadastros.produtos.padrao_fiscal.salvar" rota={ROTA} />
              <button type="button" onClick={salvar} disabled={salvando} data-testid="pf-salvar"
                className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center gap-2">
                {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editId ? 'Salvar alterações' : 'Adicionar padrão'}
              </button>
              {editId && (
                <button type="button" onClick={limpar} data-testid="pf-cancelar-edicao"
                  className="px-3 py-2 text-[12.5px] rounded-lg border border-[#3D2314]/20 text-[#3D2314] hover:bg-[#F0E9DF]">
                  Cancelar edição
                </button>
              )}
            </div>
          </section>

          {/* lista */}
          <section data-testid="pf-lista" className="rounded-lg border border-[#3D2314]/10 bg-white p-4">
            <div className="text-[12px] font-semibold mb-2 flex items-center gap-1">
              Padrões cadastrados<AjudaCampo chave="cadastros.produtos.padrao_fiscal.lista" rota={ROTA} />
            </div>
            {carregando ? (
              <div className="text-[12px] text-[#3D2314]/55 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Carregando…</div>
            ) : lista.length === 0 ? (
              <div className="text-[12px] text-[#3D2314]/60">
                Nenhum padrão ainda. Adicione o primeiro acima — por exemplo o NCM <b>8708</b> com o CST/CSOSN e o CFOP que você usa nas autopeças.
              </div>
            ) : (
              <div className="divide-y divide-[#3D2314]/5">
                {lista.map((p) => (
                  <div key={p.id} data-testid="pf-linha" className="py-2 flex items-start justify-between gap-3 text-[12.5px]">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-[#3D2314]">{p.ncm}</div>
                      <div className="text-[11.5px] text-[#3D2314]/70 break-words">{resumo(p)}</div>
                      {p.observacao && <div className="text-[11px] text-[#3D2314]/50 italic">{p.observacao}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => editar(p)} aria-label={`Editar ${p.ncm}`} data-testid="pf-editar"
                        className="p-1.5 rounded border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#F0E9DF]"><Pencil size={13} /></button>
                      <button type="button" onClick={() => excluir(p)} aria-label={`Excluir ${p.ncm}`} data-testid="pf-excluir"
                        className="p-1.5 rounded border border-[#A32D2D]/30 text-[#A32D2D] hover:bg-[#FCEBEB]"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
