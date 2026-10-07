'use client'

// FEAT-CADASTRO-SERVICOS-v1 · PR-1
// Form de cadastro/edicao de servico fiscal · 4 abas (OMIE-like).
// Reforma Tributaria desabilitada quando regime = simples_nacional
// (consulta erp_fiscal_provider_config.regime_tributario).

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Save, Loader2, AlertCircle, Trash2, Copy } from 'lucide-react'
import ProdutoAutocomplete, { type ProdutoSelecionado } from '@/components/comum/ProdutoAutocomplete'
import CategoriaCombobox from '@/components/financeiro/CategoriaCombobox'
import CatalogoFiscalCombobox from '@/components/comum/CatalogoFiscalCombobox'

export interface Servico {
  id: string
  company_id: string
  codigo: string | null
  descricao_resumida: string
  descricao_detalhada: string | null
  categoria: string | null
  categoria_codigo: string | null
  codigo_nbs: string | null
  codigo_servico_municipio: string | null
  codigo_lc116: string | null
  cnae: string | null
  cnae_secundario: string | null
  tipo_tributacao: string | null
  aliquota_iss: number | null
  iss_no_local_prestacao: boolean | null
  iss_retido: boolean | null
  valor_unitario: number | null
  pct_desconto: number | null
  aliquota_pis: number | null; retem_pis: boolean | null
  aliquota_cofins: number | null; retem_cofins: boolean | null
  cst_pis_cofins?: string | null
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
  // Clonar (duplicar): abre em modo NOVO pré-preenchido com os dados deste serviço (sem id/código — o código é
  // gerado novo). Só vale quando `servico` é null; o save segue o caminho de insert, nunca de update.
  clonarDe?: Servico | null
  onClose: () => void
  onSalvo: () => void
  // Botão "Clonar" na ficha (modo edição): devolve o serviço aberto pra a página reabrir em modo clone.
  onClonar?: (servico: Servico) => void
}

type Aba = 'servico' | 'federais' | 'produtos_utilizados' | 'reforma_trib'

const num = (v: string) => {
  const n = parseFloat(v.replace(',', '.'))
  return isNaN(n) ? 0 : n
}

// Sufixo "(cópia)" na descrição clonada, pra lembrar de editar antes de salvar.
const comCopia = (s: string | null | undefined) => `${(s ?? '').trim()} (cópia)`.trim()

export default function ServicoForm({ companyId, servico, clonarDe = null, onClose, onSalvo, onClonar }: Props) {
  // Clone = abre como NOVO (servico null) porém pré-preenchido a partir de `clonarDe`. `base` é a fonte dos
  // valores iniciais dos campos copiáveis; `servico` continua sendo a única fonte do "é edição?" (id, update).
  const ehClone = !servico && !!clonarDe
  const base = servico ?? clonarDe ?? null
  const [aba, setAba] = useState<Aba>('servico')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [regime, setRegime] = useState<string | null>(null)
  // #146 (Alliance) · o regime é editado em DOIS lugares: Configurações → Empresa (companies, fonte desta tela) e
  // Configurações → Fiscal (erp_fiscal_provider_config, usado na emissão). Quando divergem, a tela avisa com o link
  // de onde corrigir — antes travava o IBS/CBS em silêncio ("empresa no presumido, mas continua bloqueado").
  const [regimeFiscal, setRegimeFiscal] = useState<string | null>(null)

  // Aba Servico
  // Código NÃO é copiado no clone (base fica de fora): em modo criar/clone o efeito mais abaixo gera o próximo SRV.
  const [codigo, setCodigo] = useState(servico?.codigo ?? '')
  const [descricaoResumida, setDescricaoResumida] = useState(ehClone ? comCopia(base?.descricao_resumida) : (servico?.descricao_resumida ?? ''))
  const [descricaoDetalhada, setDescricaoDetalhada] = useState(base?.descricao_detalhada ?? '')
  // Categoria agora é vínculo ao Plano de Contas (codigo). `categoria` (texto) fica só como
  // legado/denormalizado — a trigger no banco a sincroniza a partir do codigo escolhido.
  const [categoria] = useState(base?.categoria ?? '')
  const [categoriaCodigo, setCategoriaCodigo] = useState(base?.categoria_codigo ?? '')
  const [codigoNbs, setCodigoNbs] = useState(base?.codigo_nbs ?? '')
  const [codigoServicoMun, setCodigoServicoMun] = useState(base?.codigo_servico_municipio ?? '')
  const [codigoLc116, setCodigoLc116] = useState(base?.codigo_lc116 ?? '')
  const [cnae, setCnae] = useState(base?.cnae ?? '')
  const [cnaeSec, setCnaeSec] = useState(base?.cnae_secundario ?? '')
  const [tipoTrib, setTipoTrib] = useState(base?.tipo_tributacao ?? 'tributavel_municipio')
  const [aliqIss, setAliqIss] = useState(String(base?.aliquota_iss ?? '0'))
  // #32 · ISS no local da prestação (LC 116 art. 3o). Quando true, a alíquota vem do município da
  // execução (não deste campo fixo) — o campo de alíquota some para não mentir.
  const [issLocal, setIssLocal] = useState(!!base?.iss_no_local_prestacao)
  const [issRetido, setIssRetido] = useState(!!base?.iss_retido)
  const [valorUnit, setValorUnit] = useState(String(base?.valor_unitario ?? '0'))
  const [pctDesc, setPctDesc] = useState(String(base?.pct_desconto ?? '0'))

  // Aba Federais
  const [aliqPis, setAliqPis] = useState(String(base?.aliquota_pis ?? '0'));   const [retemPis, setRetemPis] = useState(!!base?.retem_pis)
  const [aliqCof, setAliqCof] = useState(String(base?.aliquota_cofins ?? '0')); const [retemCof, setRetemCof] = useState(!!base?.retem_cofins)
  const [cstPisCofins, setCstPisCofins] = useState(base?.cst_pis_cofins ?? '')
  const [aliqIr, setAliqIr]  = useState(String(base?.aliquota_ir ?? '0'));     const [retemIr, setRetemIr]   = useState(!!base?.retem_ir)
  const [aliqCsll, setAliqCsll] = useState(String(base?.aliquota_csll ?? '0')); const [retemCsll, setRetemCsll] = useState(!!base?.retem_csll)
  const [aliqInss, setAliqInss] = useState(String(base?.aliquota_inss ?? '0')); const [retemInss, setRetemInss] = useState(!!base?.retem_inss)

  // Aba Reforma Tributaria
  const [rtCst, setRtCst] = useState(base?.rt_cst ?? '')
  const [rtClass, setRtClass] = useState(base?.rt_classificacao_tributaria ?? '')
  const [rtIndOp, setRtIndOp] = useState(base?.rt_indicador_operacao ?? '')
  const [rtIbsM, setRtIbsM] = useState(String(base?.rt_aliquota_ibs_municipal ?? '0'))
  const [rtIbsE, setRtIbsE] = useState(String(base?.rt_aliquota_ibs_estadual ?? '0'))
  const [rtCbs,  setRtCbs]  = useState(String(base?.rt_aliquota_cbs ?? '0'))

  // Regime tributario da empresa (RT depende disso). Fonte única = companies.regime_tributario
  // (a migration normaliza; normalizo aqui também por segurança enquanto o deploy não roda).
  useEffect(() => {
    let alive = true
    void (async () => {
      const [{ data }, { data: fisc }] = await Promise.all([
        supabase.from('companies').select('regime_tributario').eq('id', companyId).maybeSingle(),
        supabase.from('erp_fiscal_provider_config').select('regime_tributario').eq('company_id', companyId).eq('ativo', true).limit(1).maybeSingle(),
      ])
      if (!alive) return
      setRegimeFiscal(((fisc?.regime_tributario as string | null) ?? null)?.trim().toLowerCase() ?? null)
      const raw = (data?.regime_tributario as string | null)?.trim().toLowerCase() ?? null
      const norm = raw === 'simples' ? 'simples_nacional'
        : raw === 'presumido' ? 'lucro_presumido'
        : raw === 'real' ? 'lucro_real'
        : raw
      setRegime(norm)
    })()
    return () => { alive = false }
  }, [companyId])

  const isSimples = regime === 'simples_nacional'
  // divergência: um lado diz Simples e o outro não (ex.: empresa "simples_nacional" × fiscal "regime_normal")
  const fiscalSimples = regimeFiscal ? regimeFiscal.startsWith('simples') : null
  const regimeDivergente = regime != null && fiscalSimples != null && isSimples !== fiscalSimples

  // RT · auto-preenche cClassTrib + indOpRT da correlação ao escolher o NBS (fonte: fiscal_correlacao_servico).
  // Não passa o LC116 (o campo está em formato incompatível com a correlação); NBS ambíguo → não chuta.
  // rt_cst NÃO vem da correlação (não tem CST) → fica manual.
  const correlacaoAplicadaRef = useRef(false)
  useEffect(() => {
    if (!codigoNbs) return
    let alive = true
    void (async () => {
      // LC116 no formato subitem (GG.SS) desambigua; formato legado/incompatível → só NBS.
      const m = codigoLc116.match(/^(\d{1,2})\.(\d{2})$/)
      const lc116Param = m ? `${m[1].padStart(2, '0')}.${m[2]}` : null
      const { data } = await supabase.rpc('fn_reforma_correlacao_servico', { p_nbs: codigoNbs, p_lc116: lc116Param })
      const row = (Array.isArray(data) ? data[0] : data) as
        | { cclasstrib: string | null; cindop: string | null; ambiguo: boolean; encontrou: boolean }
        | undefined
      if (!alive || !row || !row.encontrou || row.ambiguo) return
      // 1a passada (edição): só preenche vazio; depois (troca de NBS): sobrescreve.
      const inicial = !correlacaoAplicadaRef.current
      correlacaoAplicadaRef.current = true
      if (row.cclasstrib) setRtClass((p) => (inicial ? p || row.cclasstrib! : row.cclasstrib!))
      if (row.cindop) setRtIndOp((p) => (inicial ? p || row.cindop! : row.cindop!))
    })()
    return () => { alive = false }
  }, [codigoNbs, codigoLc116])

  // RT · alíquotas IBS/CBS vêm da tabela de parâmetro por ano (não hardcoded).
  const [paramRT, setParamRT] = useState<{ ano: number; cbs: number; ibsUf: number; ibsMun: number } | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const ano = new Date().getFullYear()
      const { data } = await supabase.rpc('fn_reforma_parametro_ano', { p_ano: ano })
      const row = (Array.isArray(data) ? data[0] : data) as
        | { ano: number; cbs_pct: number; ibs_uf_pct: number; ibs_mun_pct: number } | undefined
      if (!alive || !row) return
      setParamRT({ ano: row.ano, cbs: Number(row.cbs_pct), ibsUf: Number(row.ibs_uf_pct), ibsMun: Number(row.ibs_mun_pct) })
      // Em modo CRIAR, prefill os campos ainda zerados com o parâmetro do ano.
      if (!servico) {
        setRtIbsE((p) => (num(p) === 0 ? String(row.ibs_uf_pct) : p))
        setRtIbsM((p) => (num(p) === 0 ? String(row.ibs_mun_pct) : p))
        setRtCbs((p) => (num(p) === 0 ? String(row.cbs_pct) : p))
      }
    })()
    return () => { alive = false }
  }, [servico])

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
        // Envia o vínculo (codigo); a trigger preenche `categoria` (texto) a partir dele.
        // Sem codigo, mantém o texto legado que veio carregado (não perde dado).
        categoria_codigo: categoriaCodigo || null,
        categoria: categoria.trim() || null,
        codigo_nbs: codigoNbs.trim() || null,
        codigo_servico_municipio: codigoServicoMun.trim() || null,
        codigo_lc116: codigoLc116.trim() || null,
        cnae: cnae.trim() || null,
        cnae_secundario: cnaeSec.trim() || null,
        tipo_tributacao: tipoTrib || null,
        aliquota_iss: issLocal ? 0 : num(aliqIss),
        iss_no_local_prestacao: issLocal,
        iss_retido: issRetido,
        valor_unitario: num(valorUnit),
        pct_desconto: num(pctDesc),
        aliquota_pis: num(aliqPis),   retem_pis: retemPis,
        aliquota_cofins: num(aliqCof), retem_cofins: retemCof,
        // #286: só envia quando a coluna existe (servico já veio com ela) ou o usuário preencheu
        ...((servico && 'cst_pis_cofins' in servico) || cstPisCofins.trim() ? { cst_pis_cofins: cstPisCofins.trim() || null } : {}),
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
            {servico ? 'Editar Serviço' : ehClone ? 'Clonar Serviço' : 'Novo Serviço'}
          </h2>
          <div className="flex items-center gap-3">
            {servico && onClonar && (
              <button
                type="button"
                onClick={() => onClonar(servico)}
                data-testid="servico-clonar-ficha"
                className="text-[#C8941A] hover:text-[#A87810] flex items-center gap-1.5 text-[12.5px] font-medium"
                title="Criar um novo serviço a partir deste"
              >
                <Copy size={15} /> Clonar
              </button>
            )}
            <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]">
              <X size={18} />
            </button>
          </div>
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
          {ehClone && (
            <div data-testid="servico-clone-aviso" className="flex items-start gap-2 p-3 rounded-lg bg-[#FBF4E4] border border-[#C8941A]/40 text-[12px] text-[#3D2314]">
              <Copy size={14} className="mt-0.5 flex-shrink-0 text-[#C8941A]" />
              <span>
                Clonando a partir de <b>{clonarDe?.codigo ?? '—'}</b> — <b>{clonarDe?.descricao_resumida}</b>. Revise os
                dados e salve; um <b>novo código</b> será gerado (os campos fiscais foram copiados). A lista de
                <b> Produtos Utilizados</b> não é copiada — adicione-a depois de salvar.
              </span>
            </div>
          )}
          {aba === 'servico' && (
            <>
              <Campo label="Código (interno · auto)" value={codigo} onChange={setCodigo} placeholder="ex: SRV00001" mono />
              <Campo label="Descrição resumida *" value={descricaoResumida} onChange={setDescricaoResumida} placeholder="ex: Hora técnica de mecânica" />
              <Campo label="Descrição detalhada (entra na NFS-e)" value={descricaoDetalhada} onChange={setDescricaoDetalhada} multiline />
              <div>
                <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                  Categoria <span className="text-[#3D2314]/50 font-normal">(Plano de Contas · receita)</span>
                </label>
                <CategoriaCombobox
                  companyId={companyId}
                  aplicacao="receber"
                  value={categoriaCodigo}
                  onChange={setCategoriaCodigo}
                  placeholder="busque uma receita do plano (ex.: serviços prestados)…"
                />
                {!categoriaCodigo && categoria.trim() !== '' && (
                  <p className="text-[11px] mt-1 text-[#8A5A00]">
                    Categoria atual (texto legado): <b>{categoria}</b> — escolha uma do plano pra vincular à classificação (DRE).
                  </p>
                )}
                <p className="text-[11px] mt-1 text-[#3D2314]/55">
                  Vincula ao Plano de Contas em vez de texto solto. Não achou? Digite e crie a categoria na hora.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">NBS</label>
                  <CatalogoFiscalCombobox
                    tipo="nbs"
                    value={codigoNbs}
                    onChange={setCodigoNbs}
                    placeholder="busque por código ou palavra (ex.: gesso)…"
                  />
                  <p className="text-[11px] mt-1 text-[#3D2314]/55">Nomenclatura Brasileira de Serviços — busque no catálogo.</p>
                </div>
                <Campo label="Cód. Serviço Município" value={codigoServicoMun} onChange={setCodigoServicoMun} placeholder="ex: 140101" mono />
                <div>
                  <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">
                    Cód. LC 116 <span className="text-[#3D2314]/50 font-normal">(subitem · catálogo)</span>
                  </label>
                  <CatalogoFiscalCombobox
                    tipo="lc116"
                    value={codigoLc116}
                    onChange={setCodigoLc116}
                    placeholder="busque o subitem (ex.: 07.02 ou 'gesso')…"
                  />
                  <p className="text-[11px] mt-1 text-[#3D2314]/55">Subitem oficial da LC 116 (ex.: 07.02) — desambigua a classificação da RT.</p>
                </div>
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
              {/* #32 · onde o ISS é devido — define de onde vem a alíquota */}
              <div className="rounded-lg border border-[#E7DECF] p-3">
                <div className="text-[12px] font-medium text-[#3D2314] mb-2">Onde o ISS é devido?</div>
                <label className="flex items-start gap-2 cursor-pointer mb-1.5">
                  <input type="radio" name="iss_local" className="mt-0.5" checked={!issLocal} onChange={() => setIssLocal(false)} />
                  <span className="text-[12.5px] text-[#3D2314]">No município da minha empresa <span className="text-[#3D2314]/55">— alíquota fixa aqui</span></span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="iss_local" className="mt-0.5" checked={issLocal} onChange={() => setIssLocal(true)} />
                  <span className="text-[12.5px] text-[#3D2314]">No município onde o serviço é prestado <span className="text-[#3D2314]/55">— alíquota vem do local</span></span>
                </label>
                <p className="text-[11px] mt-2 text-[#3D2314]/55 leading-relaxed">
                  ⓘ Construção civil, limpeza e vigilância têm ISS no local da prestação (LC 116/2003, art. 3º).
                  Na dúvida, confirme com o contador.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {issLocal ? (
                  <div className="col-span-2 flex items-start gap-2 p-2.5 rounded-lg bg-[#FBF4E4] border border-[#C8941A]/40 text-[12px] text-[#3D2314]">
                    A alíquota deste serviço vem do <b>município da execução</b>, no momento de faturar — cadastre-a em
                    <b> Configurações → Fiscal → ISS por município</b>. Sem alíquota cadastrada, a nota não é emitida.
                  </div>
                ) : (
                  <Campo label="Alíquota ISS (%)" value={aliqIss} onChange={setAliqIss} placeholder="5" />
                )}
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
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Campo label="CST do PIS/COFINS (2 dígitos)" value={cstPisCofins} onChange={setCstPisCofins} placeholder="ex.: 01 — confirme com o contador" mono />
              </div>
              <p className="text-[11px] text-[#3D2314]/55 pt-1">
                Tributos federais e retenções na fonte. Aplicáveis quando o tomador ou regime exigir. Na NFS-e Nacional, o
                PIS/COFINS de apuração própria e as retenções de PIS/COFINS/CSLL só vão para a nota com o CST preenchido;
                INSS e IR retidos vão sempre que marcados.
              </p>
            </div>
          )}

          {aba === 'produtos_utilizados' && (
            <ProdutosUtilizadosEditor companyId={companyId} servicoId={servico?.id ?? null} />
          )}

          {aba === 'reforma_trib' && (
            <div className="space-y-3">
              {regimeDivergente && (
                <div data-testid="rt-regime-divergente" className="flex items-start gap-2 p-3 rounded-lg bg-[#FFF4DC] text-[#6B4A00] text-[12px] border border-[#C8941A]/40">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    O regime da empresa está diferente em dois lugares: <b>Configurações → Empresa</b> diz{' '}
                    <b>{isSimples ? 'Simples Nacional' : 'fora do Simples'}</b>, e a <b>Configuração Fiscal</b> (usada na emissão) diz{' '}
                    <b>{fiscalSimples ? 'Simples Nacional' : 'Regime Normal (Presumido/Real)'}</b>. Esta tela segue a Empresa.{' '}
                    <a href="/dashboard/configuracoes/empresa" className="underline font-semibold">Corrigir em Configurações → Empresa</a>.
                  </span>
                </div>
              )}
              {isSimples && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FCEBEB] text-[#791F1F] text-[12px]">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Desabilitado para Simples Nacional. CBS/IBS não se aplicam ao regime atual da empresa.
                    Os campos ficarão habilitados quando a empresa migrar para Lucro Presumido ou Real.
                  </span>
                </div>
              )}
              {!isSimples && (
                <p className="text-[11px] text-[#3D2314]/70 bg-[#C8941A]/8 rounded-lg px-3 py-2">
                  <b>Classificação tributária</b> e <b>indicador de operação</b> preenchem automático a partir do
                  <b> NBS</b> (correlação LC116×NBS). NBS ambíguo fica manual. O <b>CST</b> não vem da correlação — preencha à mão.
                  {paramRT && <> As alíquotas abaixo vêm do parâmetro <b>{paramRT.ano}</b> (CBS {paramRT.cbs}% · IBS UF {paramRT.ibsUf}% · Mun {paramRT.ibsMun}%), editável.</>}
                </p>
              )}
              <fieldset disabled={isSimples} className={isSimples ? 'opacity-50' : ''}>
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="CST (RT) · manual" value={rtCst} onChange={setRtCst} placeholder="ex: 000" mono />
                  <Campo label="Classificação tributária (cClassTrib · auto)" value={rtClass} onChange={setRtClass} placeholder="do NBS" mono />
                  <Campo label="Indicador de operação (cIndOp · 6 dígitos, Anexo C)" value={rtIndOp} onChange={setRtIndOp} placeholder="do NBS" mono />
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
