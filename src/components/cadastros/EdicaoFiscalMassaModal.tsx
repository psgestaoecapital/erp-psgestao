'use client'

// Edição fiscal EM MASSA de produtos (CEO 29/09 · FCR com 436 produtos sem os 4 campos). Filtra (NCM, prefixo de NCM,
// grupo, CSOSN/CST igual a, "sem o campo" ou todos) → escolhe o valor de cada campo (4 de tributação + CFOP de venda
// dentro e fora do estado, CEO 30/09) → PRÉVIA de quantos produtos mudam →
// aplica. Tudo pela fn_produtos_fiscal_massa (valida contra a tabela oficial e o regime da empresa, registra quem
// alterou e o antes/depois de cada campo). Por padrão só PREENCHE o que está vazio. Serve para qualquer empresa.
import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Eye, Check, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CAMPOS_FISCAIS, type CampoFiscal, ehSimples, opcoesDoCampo, rotuloCampo } from '@/lib/produtos/fiscalMassa'

type SemCampo = '' | 'algum' | CampoFiscal
type Previa = {
  ok: boolean; erro?: string; mensagem?: string; aplicado?: boolean; lote_id?: string; simples?: boolean; regime?: string
  produtos_no_filtro?: number; produtos_mudam?: number; campos_mudam?: number
  por_campo?: Partial<Record<CampoFiscal, { preenche: number; substitui: number }>>
  amostra?: Array<{ codigo: string; nome: string; ncm: string | null; mudancas: Array<{ campo: CampoFiscal; antes: string | null; depois: string }> }>
}
type Lote = { lote_id: string; criado_em: string; usuario_email: string | null; valores: Record<string, string>; filtro: Record<string, unknown>; sobrescrever: boolean; observacao?: string | null; produtos_alterados: number; campos_alterados: number }

interface Props { companyId: string; onClose: () => void; onAplicado?: () => void }

const lbl = 'text-[10.5px] uppercase tracking-wide text-[#3D2314]/65 block mb-1 font-medium'
const inp = 'w-full px-2 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded bg-white text-[#3D2314]'

export default function EdicaoFiscalMassaModal({ companyId, onClose, onAplicado }: Props) {
  const [regime, setRegime] = useState<string | null>(null)
  const [ncms, setNcms] = useState<Array<{ ncm: string; qtd: number }>>([])
  const [grupos, setGrupos] = useState<string[]>([])
  // filtro
  const [ncm, setNcm] = useState('')
  const [prefixo, setPrefixo] = useState('')
  const [grupo, setGrupo] = useState('')
  const [semCampo, setSemCampo] = useState<SemCampo>('algum')
  // ex.: aplicar 5405/6404 só em quem é CSOSN 500 (ICMS já retido por ST)
  const [icmsIgual, setIcmsIgual] = useState('')
  const [todos, setTodos] = useState(false)
  // valores
  const [valores, setValores] = useState<Record<CampoFiscal, string>>({ tipo_item_sped: '', cst_icms: '', cst_pis: '', cst_cofins: '', cfop_venda: '', cfop_venda_interestadual: '' })
  const [sobrescrever, setSobrescrever] = useState(false)
  const [observacao, setObservacao] = useState('')
  // estado
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [previaChave, setPreviaChave] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aplicado, setAplicado] = useState<Previa | null>(null)
  const [historico, setHistorico] = useState<Lote[]>([])

  const simples = ehSimples(regime)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  useEffect(() => {
    let vivo = true
    supabase.from('companies').select('regime_tributario').eq('id', companyId).maybeSingle()
      .then(({ data }) => { if (vivo) setRegime((data as { regime_tributario: string | null } | null)?.regime_tributario ?? null) })
    supabase.from('erp_produtos').select('ncm, grupo').eq('company_id', companyId).limit(10000)
      .then(({ data }) => {
        if (!vivo) return
        const cont = new Map<string, number>(); const gs = new Set<string>()
        for (const r of (data ?? []) as Array<{ ncm: string | null; grupo: string | null }>) {
          const n = (r.ncm ?? '').replace(/\D/g, '')
          if (n) cont.set(n, (cont.get(n) ?? 0) + 1)
          if (r.grupo) gs.add(r.grupo)
        }
        setNcms([...cont.entries()].map(([n, q]) => ({ ncm: n, qtd: q })).sort((a, b) => a.ncm.localeCompare(b.ncm)))
        setGrupos([...gs].sort((a, b) => a.localeCompare(b, 'pt-BR')))
      })
    return () => { vivo = false }
  }, [companyId])

  async function carregarHistorico() {
    const { data } = await supabase.rpc('fn_produtos_fiscal_massa_historico', { p_company_id: companyId })
    setHistorico((data ?? []) as Lote[])
  }
  useEffect(() => {
    carregarHistorico()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const filtro = useMemo(() => ({
    ...(ncm ? { ncm } : {}),
    // vários prefixos separados por vírgula/espaço: "3208, 3209"
    ...(prefixo.replace(/\D/g, '') ? { ncm_prefixo: prefixo.split(/[^0-9]+/).filter(Boolean).join(',') } : {}),
    ...(grupo ? { grupo } : {}),
    ...(semCampo ? { sem_campo: semCampo } : {}),
    ...(icmsIgual.trim() ? { icms_igual: icmsIgual.trim() } : {}),
    ...(todos ? { todos: true } : {}),
  }), [ncm, prefixo, grupo, semCampo, icmsIgual, todos])
  const valoresEscolhidos = useMemo(() => Object.fromEntries(Object.entries(valores).filter(([, v]) => v)), [valores])
  const chave = JSON.stringify({ filtro, valoresEscolhidos, sobrescrever, observacao: observacao.trim() })
  const temFiltro = Object.keys(filtro).length > 0
  const temValor = Object.keys(valoresEscolhidos).length > 0
  const previaVale = previa?.ok && previaChave === chave

  async function chamar(aplicar: boolean): Promise<Previa | null> {
    setErro(null)
    setCarregando(true)
    try {
      const { data, error } = await supabase.rpc('fn_produtos_fiscal_massa', {
        p_company_id: companyId, p_filtro: filtro, p_valores: valoresEscolhidos, p_sobrescrever: sobrescrever, p_aplicar: aplicar,
        p_observacao: observacao.trim() || null,
      })
      if (error) { setErro(error.message); return null }
      const r = data as Previa
      if (!r.ok) { setErro(r.mensagem ?? r.erro ?? 'Não foi possível'); return null }
      return r
    } finally {
      setCarregando(false)
    }
  }

  async function verPrevia() {
    setAplicado(null)
    const r = await chamar(false)
    setPrevia(r)
    setPreviaChave(r ? chave : '')
  }

  async function aplicar() {
    if (!previaVale || !previa?.produtos_mudam) return
    if (!window.confirm(`Aplicar em ${previa.produtos_mudam} produto(s)? A alteração fica registrada com o seu usuário.`)) return
    const r = await chamar(true)
    if (r) {
      setAplicado(r)
      setPrevia(null)
      setPreviaChave('')
      await carregarHistorico()
      onAplicado?.()
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-[#3D2314]/50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} data-testid="fiscal-massa-modal" className="bg-[#FAF7F2] rounded-xl w-full max-w-4xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#3D2314] rounded-t-xl">
          <h2 className="text-[16px] font-semibold text-[#C8941A] m-0">Edição fiscal em massa</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#FAF7F2] p-2"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 text-[#3D2314]">
          <p className="text-[12.5px] text-[#3D2314]/75">
            Preenche <b>Tipo do item (SPED)</b>, <b>{rotuloCampo('cst_icms', simples)}</b>, <b>CST do PIS</b>, <b>CST da COFINS</b> e o <b>CFOP de venda</b> (dentro e fora do estado) de vários produtos
            de uma vez. Primeiro a prévia (nada muda); depois aplicar. Fica registrado quem alterou, quando e o antes/depois de cada produto.
            {regime && <> Regime da empresa: <b>{regime}</b> → ICMS em <b>{simples ? 'CSOSN (3 dígitos)' : 'CST (2 dígitos)'}</b>.</>}
          </p>

          {/* 1 · filtro */}
          <section className="rounded-lg border border-[#3D2314]/10 bg-white p-4">
            <div className="text-[12px] font-semibold mb-3">1 · Quais produtos</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={lbl}>NCM</label>
                <select value={ncm} onChange={(e) => setNcm(e.target.value)} data-testid="fm-filtro-ncm" className={inp}>
                  <option value="">Qualquer</option>
                  {ncms.map((n) => <option key={n.ncm} value={n.ncm}>{n.ncm} ({n.qtd})</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Prefixo do NCM</label>
                <input value={prefixo} onChange={(e) => setPrefixo(e.target.value)} placeholder="um ou vários: 3208, 3209, 3214"
                  data-testid="fm-filtro-prefixo" className={inp} />
              </div>
              <div>
                <label className={lbl}>Grupo</label>
                <select value={grupo} onChange={(e) => setGrupo(e.target.value)} data-testid="fm-filtro-grupo" className={inp} disabled={grupos.length === 0}>
                  <option value="">{grupos.length === 0 ? 'Nenhum grupo cadastrado' : 'Qualquer'}</option>
                  {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Só os que estão sem</label>
                <select value={semCampo} onChange={(e) => setSemCampo(e.target.value as SemCampo)} data-testid="fm-filtro-sem" className={inp}>
                  <option value="">Não filtrar por isso</option>
                  <option value="algum">Algum dos campos (tributação ou CFOP dentro do estado)</option>
                  {CAMPOS_FISCAIS.map((c) => <option key={c} value={c}>{rotuloCampo(c, simples)}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 max-w-xs">
              <label className={lbl}>Só os com {rotuloCampo('cst_icms', simples)} igual a</label>
              <input value={icmsIgual} onChange={(e) => setIcmsIgual(e.target.value)} placeholder={simples ? 'ex.: 500' : 'ex.: 60'}
                inputMode="numeric" data-testid="fm-filtro-icms" className={inp} />
            </div>
            {!ncm && !prefixo && !grupo && !semCampo && !icmsIgual && (
              <label className="mt-3 flex items-center gap-2 text-[12.5px] cursor-pointer">
                <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} data-testid="fm-todos" className="accent-[#C8941A]" />
                Todos os produtos da empresa (sem filtro)
              </label>
            )}
            <div className="mt-2 text-[11px] text-[#3D2314]/55">Produtos inativos e serviços ficam de fora.</div>
          </section>

          {/* 2 · valores */}
          <section className="rounded-lg border border-[#3D2314]/10 bg-white p-4">
            <div className="text-[12px] font-semibold mb-3">2 · Valor de cada campo (vazio = não mexe)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CAMPOS_FISCAIS.map((c) => (
                <div key={c}>
                  <label className={lbl}>{rotuloCampo(c, simples)}</label>
                  <select value={valores[c]} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} data-testid={`fm-valor-${c}`} className={inp}>
                    <option value="">— não alterar —</option>
                    {opcoesDoCampo(c, simples).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.rotulo}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-[12.5px] cursor-pointer">
              <input type="checkbox" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} data-testid="fm-sobrescrever" className="accent-[#C8941A]" />
              Substituir também o que já está preenchido com outro valor (padrão: só preenche o vazio)
            </label>
            <div className="mt-3">
              <label className={lbl}>Marca em cada produto alterado (opcional)</label>
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} data-testid="fm-observacao" className={inp}
                placeholder="ex.: regra provisória 30/09 — confirmar com o contador" />
            </div>
          </section>

          {erro && <div data-testid="fm-erro" className="px-3 py-2 rounded bg-[#FCEBEB] text-[#791F1F] text-[12.5px] border border-[#E8A6A5]">{erro}</div>}

          {aplicado && (
            <div data-testid="fm-aplicado" className="px-3 py-2 rounded bg-[#EAF3E6] text-[#2F5A1F] text-[12.5px] border border-[#B9D3AC]">
              Aplicado: {aplicado.produtos_mudam} produto(s), {aplicado.campos_mudam} campo(s). Registrado no histórico abaixo.
            </div>
          )}

          {/* 3 · prévia + aplicar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={verPrevia} disabled={carregando || !temValor || !temFiltro} data-testid="fm-previa"
              className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] disabled:opacity-40 flex items-center gap-2">
              {carregando ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Ver prévia
            </button>
            <button type="button" onClick={aplicar} disabled={carregando || !previaVale || !previa?.produtos_mudam} data-testid="fm-aplicar"
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center gap-2">
              <Check size={14} /> Aplicar{previaVale && previa?.produtos_mudam ? ` em ${previa.produtos_mudam} produto(s)` : ''}
            </button>
            {previa && !previaVale && <span className="text-[11.5px] text-[#A32D2D]">Filtro ou valores mudaram — veja a prévia de novo.</span>}
          </div>

          {previa?.ok && (
            <section data-testid="fm-previa-resumo" className="rounded-lg border border-[#C8941A]/40 bg-[#FBF4E4] p-4 text-[12.5px]">
              <div className="mb-2">
                <b data-testid="fm-previa-mudam">{previa.produtos_mudam}</b> de <b>{previa.produtos_no_filtro}</b> produto(s) no filtro mudam
                ({previa.campos_mudam} campo(s)).
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                {CAMPOS_FISCAIS.filter((c) => previa.por_campo?.[c]).map((c) => (
                  <span key={c}>{rotuloCampo(c, simples)}: preenche {previa.por_campo?.[c]?.preenche ?? 0}
                    {(previa.por_campo?.[c]?.substitui ?? 0) > 0 && <> · substitui {previa.por_campo?.[c]?.substitui}</>}</span>
                ))}
              </div>
              {(previa.amostra?.length ?? 0) > 0 && (
                <div className="max-h-60 overflow-y-auto rounded border border-[#3D2314]/10 bg-white">
                  {previa.amostra?.map((p) => (
                    <div key={p.codigo} data-testid="fm-previa-linha" className="px-3 py-1.5 border-b border-[#3D2314]/5 text-[12px]">
                      <span className="font-mono text-[#3D2314]/70">{p.codigo}</span> · {p.nome}
                      {p.ncm && <span className="text-[#3D2314]/50"> · NCM {p.ncm}</span>}
                      <div className="text-[11.5px] text-[#3D2314]/75">
                        {p.mudancas.map((m) => `${rotuloCampo(m.campo, simples)}: ${m.antes ?? 'vazio'} → ${m.depois}`).join(' · ')}
                      </div>
                    </div>
                  ))}
                  {(previa.produtos_mudam ?? 0) > (previa.amostra?.length ?? 0) && (
                    <div className="px-3 py-1.5 text-[11px] text-[#3D2314]/50">…e mais {(previa.produtos_mudam ?? 0) - (previa.amostra?.length ?? 0)}.</div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* histórico */}
          <section data-testid="fm-historico" className="rounded-lg border border-[#3D2314]/10 bg-white p-4">
            <div className="text-[12px] font-semibold mb-2 flex items-center gap-1.5"><History size={13} /> Últimas alterações em massa</div>
            {historico.length === 0 ? (
              <div className="text-[12px] text-[#3D2314]/55">Nenhuma ainda.</div>
            ) : (
              <div className="space-y-1">
                {historico.map((l) => (
                  <div key={l.lote_id} className="text-[12px] text-[#3D2314]/80">
                    {new Date(l.criado_em).toLocaleString('pt-BR')} · <b>{l.usuario_email ?? '—'}</b> · {l.produtos_alterados} produto(s) ·{' '}
                    {Object.entries(l.valores).map(([c, v]) => `${rotuloCampo(c as CampoFiscal, simples)} ${v}`).join(', ')}
                    {l.sobrescrever && ' · substituindo'}
                    {l.observacao && <> · <i>{l.observacao}</i></>}
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
