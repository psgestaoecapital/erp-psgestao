'use client'

// FEAT-CADASTRO-SERVICOS-v1 · PR-1
// Form de cadastro/edicao de servico fiscal · 4 abas (OMIE-like).
// Reforma Tributaria desabilitada quando regime = simples_nacional
// (consulta erp_fiscal_provider_config.regime_tributario).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Save, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import ProdutoAutocomplete, { type ProdutoSelecionado } from '@/components/comum/ProdutoAutocomplete'

export interface Servico {
  id: string
  company_id: string
  codigo: string | null
  descricao_resumida: string
  descricao_detalhada: string | null
  categoria: string | null
  codigo_nbs: string | null
  codigo_servico_municipio: string | null
  codigo_lc116: string | null
  cnae: string | null
  cnae_secundario: string | null
  tipo_tributacao: string | null
  aliquota_iss: number | null
  iss_retido: boolean | null
  valor_unitario: number | null
  pct_desconto: number | null
  aliquota_pis: number | null; retem_pis: boolean | null
  aliquota_cofins: number | null; retem_cofins: boolean | null
  aliquota_ir: number | null; retem_ir: boolean | null
  aliquota_csll: number | null; retem_csll: boolean | null
  aliquota_inss: number | null; retem_inss: boolean | null
  rt_cst: string | null
  rt_classificacao_tributaria: string | null
  rt_indicador_operacao: string | null
  rt_aliquota_ibs_municipal: number | null
  rt_aliquota_ibs_estadual: number | null
  rt_aliquota_cbs: number | null
  ativo: boolean | null
}

interface Props {
  companyId: string
  servico: Servico | null
  onClose: () => void
  onSalvo: () => void
}

type Aba = 'servico' | 'federais' | 'produtos_utilizados' | 'reforma_trib'

const num = (v: string) => {
  const n = parseFloat(v.replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export default function ServicoForm({ companyId, servico, onClose, onSalvo }: Props) {
  const [aba, setAba] = useState<Aba>('servico')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [regime, setRegime] = useState<string | null>(null)

  // Aba Servico
  const [codigo, setCodigo] = useState(servico?.codigo ?? '')
  const [descricaoResumida, setDescricaoResumida] = useState(servico?.descricao_resumida ?? '')
  const [descricaoDetalhada, setDescricaoDetalhada] = useState(servico?.descricao_detalhada ?? '')
  const [categoria, setCategoria] = useState(servico?.categoria ?? '')
  const [codigoNbs, setCodigoNbs] = useState(servico?.codigo_nbs ?? '')
  const [codigoServicoMun, setCodigoServicoMun] = useState(servico?.codigo_servico_municipio ?? '')
  const [codigoLc116, setCodigoLc116] = useState(servico?.codigo_lc116 ?? '')
  const [cnae, setCnae] = useState(servico?.cnae ?? '')
  const [cnaeSec, setCnaeSec] = useState(servico?.cnae_secundario ?? '')
  const [tipoTrib, setTipoTrib] = useState(servico?.tipo_tributacao ?? 'tributavel_municipio')
  const [aliqIss, setAliqIss] = useState(String(servico?.aliquota_iss ?? '0'))
  const [issRetido, setIssRetido] = useState(!!servico?.iss_retido)
  const [valorUnit, setValorUnit] = useState(String(servico?.valor_unitario ?? '0'))
  const [pctDesc, setPctDesc] = useState(String(servico?.pct_desconto ?? '0'))

  // Aba Federais
  const [aliqPis, setAliqPis] = useState(String(servico?.aliquota_pis ?? '0'));   const [retemPis, setRetemPis] = useState(!!servico?.retem_pis)
  const [aliqCof, setAliqCof] = useState(String(servico?.aliquota_cofins ?? '0')); const [retemCof, setRetemCof] = useState(!!servico?.retem_cofins)
  const [aliqIr, setAliqIr]  = useState(String(servico?.aliquota_ir ?? '0'));     const [retemIr, setRetemIr]   = useState(!!servico?.retem_ir)
  const [aliqCsll, setAliqCsll] = useState(String(servico?.aliquota_csll ?? '0')); const [retemCsll, setRetemCsll] = useState(!!servico?.retem_csll)
  const [aliqInss, setAliqInss] = useState(String(servico?.aliquota_inss ?? '0')); const [retemInss, setRetemInss] = useState(!!servico?.retem_inss)

  // Aba Reforma Tributaria
  const [rtCst, setRtCst] = useState(servico?.rt_cst ?? '')
  const [rtClass, setRtClass] = useState(servico?.rt_classificacao_tributaria ?? '')
  const [rtIndOp, setRtIndOp] = useState(servico?.rt_indicador_operacao ?? '')
  const [rtIbsM, setRtIbsM] = useState(String(servico?.rt_aliquota_ibs_municipal ?? '0'))
  const [rtIbsE, setRtIbsE] = useState(String(servico?.rt_aliquota_ibs_estadual ?? '0'))
  const [rtCbs,  setRtCbs]  = useState(String(servico?.rt_aliquota_cbs ?? '0'))

  // Regime tributario da empresa (RT depende disso)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase
        .from('erp_fiscal_provider_config')
        .select('regime_tributario')
        .eq('company_id', companyId)
        .maybeSingle()
      if (alive) setRegime((data?.regime_tributario as string | null) ?? null)
    })()
    return () => { alive = false }
  }, [companyId])

  const isSimples = regime === 'simples_nacional'

  // Sugere proximo codigo SRVNNNNN ao abrir em modo CRIAR
  useEffect(() => {
    if (servico || codigo) return
    let alive = true
    void (async () => {
      const { data } = await supabase.rpc('fn_next_servico_codigo', { p_company_id: companyId })
      if (alive && typeof data === 'string') setCodigo(data)
    })()
    return () => { alive = false }
  }, [companyId, servico, codigo])

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      if (!descricaoResumida.trim()) throw new Error('Descricao resumida obrigatoria.')
      const payload: Record<string, unknown> = {
        company_id: companyId,
        codigo: codigo.trim() || null,
        descricao_resumida: descricaoResumida.trim(),
        descricao_detalhada: descricaoDetalhada.trim() || null,
        categoria: categoria.trim() || null,
        codigo_nbs: codigoNbs.trim() || null,
        codigo_servico_municipio: codigoServicoMun.trim() || null,
        codigo_lc116: codigoLc116.trim() || null,
        cnae: cnae.trim() || null,
        cnae_secundario: cnaeSec.trim() || null,
        tipo_tributacao: tipoTrib || null,
        aliquota_iss: num(aliqIss),
        iss_retido: issRetido,
        valor_unitario: num(valorUnit),
        pct_desconto: num(pctDesc),
        aliquota_pis: num(aliqPis),   retem_pis: retemPis,
        aliquota_cofins: num(aliqCof), retem_cofins: retemCof,
        aliquota_ir: num(aliqIr),     retem_ir: retemIr,
        aliquota_csll: num(aliqCsll), retem_csll: retemCsll,
        aliquota_inss: num(aliqInss), retem_inss: retemInss,
        rt_cst: rtCst.trim() || null,
        rt_classificacao_tributaria: rtClass.trim() || null,
        rt_indicador_operacao: rtIndOp.trim() || null,
        rt_aliquota_ibs_municipal: num(rtIbsM),
        rt_aliquota_ibs_estadual: num(rtIbsE),
        rt_aliquota_cbs: num(rtCbs),
        ativo: true,
      }
      const { error } = servico
        ? await supabase.from('erp_servicos').update(payload).eq('id', servico.id)
        : await supabase.from('erp_servicos').insert(payload)
      if (error) throw error
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const abas: Array<[Aba, string]> = [
    ['servico', 'Serviço'],
    ['federais', 'Impostos Federais'],
    ['produtos_utilizados', 'Produtos Utilizados'],
    ['reforma_trib', 'Reforma Tributária'],
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-[15px] font-medium text-[#3D2314]">
            {servico ? 'Editar Serviço' : 'Novo Serviço'}
          </h2>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-[#3D2314]/10 px-5 sticky top-[57px] bg-white z-10 overflow-x-auto">
          {abas.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              data-testid={`servico-tab-${id}`}
              className={`px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                aba === id ? 'border-[#C8941A] text-[#3D2314]' : 'border-transparent text-[#3D2314]/55 hover:text-[#3D2314]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {aba === 'servico' && (
            <>
              <Campo label="Código (interno · auto)" value={codigo} onChange={setCodigo} placeholder="ex: SRV00001" mono />
              <Campo label="Descrição resumida *" value={descricaoResumida} onChange={setDescricaoResumida} placeholder="ex: Hora técnica de mecânica" />
              <Campo label="Descrição detalhada (entra na NFS-e)" value={descricaoDetalhada} onChange={setDescricaoDetalhada} multiline />
              <Campo label="Categoria" value={categoria} onChange={setCategoria} placeholder="ex: Mão de obra" />
              <div className="grid grid-cols-2 gap-3">
                <Campo label="NBS" value={codigoNbs} onChange={setCodigoNbs} placeholder="Nomenclatura Brasileira Serviços" mono />
                <Campo label="Cód. Serviço Município" value={codigoServicoMun} onChange={setCodigoServicoMun} placeholder="ex: 140101" mono />
                <Campo label="Cód. LC 116" value={codigoLc116}
                  onChange={(v) => setCodigoLc116(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="ex.: 172401" mono
                  hint={codigoLc116.replace(/\D/g, '').length === 6
                    ? '6 dígitos ✓ (17.24.01 → 172401)'
                    : codigoLc116.length > 0
                      ? `⚠️ ${codigoLc116.replace(/\D/g, '').length} díg. — o LC 116 tem 6 (17.24.01 → 172401)`
                      : '6 dígitos, só números (17.24.01 → 172401)'}
                  hintWarn={codigoLc116.length > 0 && codigoLc116.replace(/\D/g, '').length !== 6} />
                <Campo label="CNAE" value={cnae} onChange={setCnae} placeholder="0000-0/00" mono />
                <Campo label="CNAE Secundário" value={cnaeSec} onChange={setCnaeSec} placeholder="opcional" mono />
                <Select
                  label="Tipo de tributação"
                  value={tipoTrib}
                  onChange={setTipoTrib}
                  options={[
                    ['tributavel_municipio', 'Tributável no município'],
                    ['tributavel_fora', 'Tributável fora do município'],
                    ['isento', 'Isento'],
                    ['imune', 'Imune'],
                    ['suspenso', 'Exigibilidade suspensa'],
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Alíquota ISS (%)" value={aliqIss} onChange={setAliqIss} placeholder="5" />
                <CampoCheck label="ISS retido na fonte" checked={issRetido} onChange={setIssRetido} />
                <Campo label="Valor unitário (R$)" value={valorUnit} onChange={setValorUnit} placeholder="0,00" />
                <Campo label="% Desconto" value={pctDesc} onChange={setPctDesc} placeholder="0" />
              </div>
            </>
          )}

          {aba === 'federais' && (
            <div className="space-y-3">
              <LinhaFederal label="PIS"    aliq={aliqPis}  setAliq={setAliqPis}  retem={retemPis}  setRetem={setRetemPis} />
              <LinhaFederal label="COFINS" aliq={aliqCof}  setAliq={setAliqCof}  retem={retemCof}  setRetem={setRetemCof} />
              <LinhaFederal label="IR"     aliq={aliqIr}   setAliq={setAliqIr}   retem={retemIr}   setRetem={setRetemIr} />
              <LinhaFederal label="CSLL"   aliq={aliqCsll} setAliq={setAliqCsll} retem={retemCsll} setRetem={setRetemCsll} />
              <LinhaFederal label="INSS"   aliq={aliqInss} setAliq={setAliqInss} retem={retemInss} setRetem={setRetemInss} />
              <p className="text-[11px] text-[#3D2314]/55 pt-1">
                Tributos federais e retenções na fonte. Aplicáveis quando o tomador ou regime exigir.
              </p>
            </div>
          )}

          {aba === 'produtos_utilizados' && (
            <ProdutosUtilizadosEditor companyId={companyId} servicoId={servico?.id ?? null} />
          )}

          {aba === 'reforma_trib' && (
            <div className="space-y-3">
              {isSimples && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FCEBEB] text-[#791F1F] text-[12px]">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Desabilitado para Simples Nacional. CBS/IBS não se aplicam ao regime atual da empresa.
                    Os campos ficarão habilitados quando a empresa migrar para Lucro Presumido ou Real.
                  </span>
                </div>
              )}
              <fieldset disabled={isSimples} className={isSimples ? 'opacity-50' : ''}>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="CST (RT)" value={rtCst} onChange={setRtCst} placeholder="ex: 000" mono />
                  <Campo label="Classificação tributária" value={rtClass} onChange={setRtClass} placeholder="cClassTrib" mono />
                  <Campo label="Indicador de operação" value={rtIndOp} onChange={setRtIndOp} placeholder="indOpRT" mono />
                  <span />
                  <Campo label="Alíq. IBS Municipal (%)" value={rtIbsM} onChange={setRtIbsM} placeholder="0" />
                  <Campo label="Alíq. IBS Estadual (%)" value={rtIbsE} onChange={setRtIbsE} placeholder="0" />
                  <Campo label="Alíq. CBS (%)" value={rtCbs} onChange={setRtCbs} placeholder="0" />
                </div>
              </fieldset>
              <p className="text-[11px] text-[#3D2314]/55 pt-1">
                Os campos são armazenados mesmo quando desabilitados, pra preservar dados ao mudar de regime.
              </p>
            </div>
          )}

          {erro && <div className="text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2.5 rounded-lg">{erro}</div>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={!descricaoResumida.trim() || salvando}
              data-testid="servico-salvar"
              className="flex-1 px-4 py-2.5 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface CampoProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  mono?: boolean
  hint?: string
  hintWarn?: boolean
}

function Campo({ label, value, onChange, placeholder, multiline, mono, hint, hintWarn }: CampoProps) {
  const cls = `w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 ${mono ? 'font-mono' : ''} ${hintWarn ? 'border-[#C8941A]/60' : 'border-[#3D2314]/15'}`
  return (
    <div>
      <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className={cls} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
      {hint && <p className={`text-[11px] mt-1 ${hintWarn ? 'text-[#8A5A00]' : 'text-[#3D2314]/55'}`}>{hint}</p>}
    </div>
  )
}

interface CheckProps { label: string; checked: boolean; onChange: (b: boolean) => void }
function CampoCheck({ label, checked, onChange }: CheckProps) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 border border-[#3D2314]/15 rounded-lg cursor-pointer text-[13px] text-[#3D2314]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#C8941A]" />
      {label}
    </label>
  )
}

interface LinhaFederalProps {
  label: string
  aliq: string; setAliq: (v: string) => void
  retem: boolean; setRetem: (b: boolean) => void
}
function LinhaFederal({ label, aliq, setAliq, retem, setRetem }: LinhaFederalProps) {
  return (
    <div className="grid grid-cols-[80px_1fr_auto] gap-3 items-center">
      <span className="text-[13px] font-medium text-[#3D2314]">{label}</span>
      <div>
        <input
          type="text"
          inputMode="decimal"
          value={aliq}
          onChange={(e) => setAliq(e.target.value)}
          placeholder="%"
          className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
        />
      </div>
      <label className="flex items-center gap-2 px-3 py-2 border border-[#3D2314]/15 rounded-lg cursor-pointer text-[12.5px] text-[#3D2314] whitespace-nowrap">
        <input type="checkbox" checked={retem} onChange={(e) => setRetem(e.target.checked)} className="accent-[#C8941A]" />
        Retido
      </label>
    </div>
  )
}

interface SelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<[string, string]>
}
function Select({ label, value, onChange, options }: SelectProps) {
  return (
    <div>
      <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

// FEAT-OS-ONDA1-ITENS-SERVICO-BOM-v1 · editor BOM (substitui placeholder "Em breve")
// Persiste em erp_servicos_produtos (RLS por company_id).
// So habilitado em modo edicao (servicoId NOT NULL) · em modo criar, salve o
// servico primeiro pra liberar a aba (nao queremos optimistic linkage).

interface BomItem {
  id: string
  produto_id: string
  produto_codigo: string | null
  produto_nome: string | null
  quantidade_padrao: number
}

interface ProdutosUtilizadosEditorProps {
  companyId: string
  servicoId: string | null
}

function ProdutosUtilizadosEditor({ companyId, servicoId }: ProdutosUtilizadosEditorProps) {
  const [itens, setItens] = useState<BomItem[]>([])
  const [carregando, setCarregando] = useState(false)
  const [novoProd, setNovoProd] = useState<ProdutoSelecionado | null>(null)
  const [novaQtd, setNovaQtd] = useState('1')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function recarregar() {
    if (!servicoId) return
    setCarregando(true)
    const { data, error } = await supabase
      .from('erp_servicos_produtos')
      .select('id,produto_id,produto_codigo,produto_nome,quantidade_padrao')
      .eq('servico_id', servicoId)
      .order('produto_nome')
    if (!error) setItens((data ?? []) as BomItem[])
    setCarregando(false)
  }

  useEffect(() => { void recarregar() }, [servicoId])

  async function adicionar() {
    if (!servicoId || !novoProd) return
    const qtd = parseFloat(novaQtd.replace(',', '.'))
    if (!isFinite(qtd) || qtd <= 0) { setErro('Quantidade deve ser maior que zero.'); return }
    setSalvando(true)
    setErro(null)
    const { error } = await supabase.from('erp_servicos_produtos').insert({
      company_id: companyId,
      servico_id: servicoId,
      produto_id: novoProd.id,
      produto_codigo: novoProd.codigo,
      produto_nome: novoProd.nome,
      quantidade_padrao: qtd,
    })
    if (error) {
      setErro(error.message.includes('uq_servicos_produtos_serv_prod')
        ? 'Esse produto já está na lista. Remova antes de adicionar de novo.'
        : error.message)
      setSalvando(false)
      return
    }
    setNovoProd(null)
    setNovaQtd('1')
    setSalvando(false)
    await recarregar()
  }

  async function remover(id: string) {
    if (!confirm('EXCLUIR este produto da composição?')) return
    const { error } = await supabase.from('erp_servicos_produtos').delete().eq('id', id)
    if (!error) await recarregar()
  }

  if (!servicoId) {
    return (
      <div className="py-8 text-center text-[#3D2314]/60 text-[12.5px]">
        <p className="font-medium text-[#3D2314] mb-1">Salve o serviço primeiro</p>
        <p>Após salvar, esta aba libera a lista de produtos consumidos (BOM).</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="block text-[11px] text-[#3D2314]/60">Adicionar produto à composição</span>
        <ProdutoAutocomplete
          companyId={companyId}
          selecionado={novoProd}
          onSelect={setNovoProd}
          onClear={() => setNovoProd(null)}
          testId="bom-produto"
        />
        {novoProd && (
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="block text-[11px] text-[#3D2314]/60 mb-1">Quantidade padrão</span>
              <input
                type="text"
                inputMode="decimal"
                value={novaQtd}
                onChange={(e) => setNovaQtd(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
              />
            </label>
            <button
              type="button"
              onClick={adicionar}
              disabled={salvando}
              data-testid="bom-adicionar"
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40"
            >
              {salvando ? '...' : 'Adicionar'}
            </button>
          </div>
        )}
        {erro && <div className="text-[12px] text-[#791F1F] bg-[#FCEBEB] p-2 rounded">{erro}</div>}
      </div>

      <div className="border-t border-[#3D2314]/10 pt-3">
        <div className="text-[11px] text-[#3D2314]/60 mb-2">
          {carregando ? 'Carregando…' : itens.length === 0
            ? 'Nenhum produto na composição ainda.'
            : `${itens.length} produto(s) na composição`}
        </div>
        {itens.length > 0 && (
          <ul className="divide-y divide-[#3D2314]/8 border border-[#3D2314]/10 rounded-lg">
            {itens.map((i) => (
              <li key={i.id} className="px-3 py-2 flex items-center justify-between gap-3" data-testid="bom-item">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[#3D2314] font-medium truncate">{i.produto_nome ?? '—'}</div>
                  {i.produto_codigo && (
                    <div className="text-[10px] text-[#3D2314]/55 font-mono">{i.produto_codigo}</div>
                  )}
                </div>
                <div className="text-[12.5px] text-[#3D2314] tabular-nums whitespace-nowrap">
                  {Number(i.quantidade_padrao).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                </div>
                <button
                  type="button"
                  onClick={() => remover(i.id)}
                  data-testid="bom-remover"
                  className="text-[#EF4444] hover:text-[#C53030] p-1"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-[#3D2314]/55">
        Estes produtos serão baixados do estoque automaticamente quando o serviço for faturado (Onda 3).
      </p>
    </div>
  )
}
