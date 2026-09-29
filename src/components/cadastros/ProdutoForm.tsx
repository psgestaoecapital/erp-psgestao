'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { X, Save, Loader2 } from 'lucide-react'

export interface Produto {
  id: string
  codigo: string
  nome: string
  descricao?: string | null
  unidade?: string | null
  preco_venda?: number | null
  preco_custo?: number | null
  ncm?: string | null
  cest?: string | null
  cfop_venda?: string | null
  origem?: string | null
  cst_icms?: string | null
  aliquota_icms?: number | null
  aliquota_ipi?: number | null
  cst_pis?: string | null
  aliquota_pis?: number | null
  cst_cofins?: string | null
  aliquota_cofins?: number | null
  // CST 60/500 · ST retido (NT 2018.005), por unidade
  vbcst_ret?: number | null
  pst?: number | null
  vicms_substituto?: number | null
  vicms_st_ret?: number | null
  // Grupo comb (NT 2016/002) · combustível/lubrificante (NCM 2710...). Da tabela SIMP da ANP.
  combustivel_codigo_anp?: number | null
  combustivel_descricao_anp?: string | null
  ativo?: boolean | null
  // marca da edição fiscal em massa (ex.: "regra provisória 30/09 — confirmar com o contador")
  fiscal_observacao?: string | null
}

interface Props {
  companyId: string
  produto: Produto | null
  onClose: () => void
  onSalvo: () => void
}

type Aba = 'basico' | 'fiscal' | 'precos'

// '' → NULL (não informado); 0 é valor válido
const numOuNulo = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')) || 0)

export default function ProdutoForm({ companyId, produto, onClose, onSalvo }: Props) {
  const [aba, setAba] = useState<Aba>('basico')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [codigo, setCodigo] = useState(produto?.codigo ?? '')
  const [nome, setNome] = useState(produto?.nome ?? '')
  const [descricao, setDescricao] = useState(produto?.descricao ?? '')
  const [unidade, setUnidade] = useState(produto?.unidade ?? 'UN')
  const [precoVenda, setPrecoVenda] = useState(String(produto?.preco_venda ?? '0'))
  const [precoCusto, setPrecoCusto] = useState(String(produto?.preco_custo ?? '0'))
  const [ncm, setNcm] = useState(produto?.ncm ?? '')
  const [cest, setCest] = useState(produto?.cest ?? '')
  const [cfopVenda, setCfopVenda] = useState(produto?.cfop_venda ?? '5102')
  const [origem, setOrigem] = useState(produto?.origem ?? '0')
  // CEO 29/09: nada de tributação suposta. Campo vazio fica vazio (NULL) — antes a ficha abria com CST 00 / PIS e
  // COFINS 01 / alíquotas 18-1,65-7,6 e GRAVAVA isso em qualquer produto sem cadastro fiscal só por salvar a ficha.
  // Produto sem CSOSN/CST não emite NF-e (nfe-validator) — preencha aqui ou em "Edição fiscal em massa".
  const [cstIcms, setCstIcms] = useState(produto?.cst_icms ?? '')
  const [aliquotaIcms, setAliquotaIcms] = useState(produto?.aliquota_icms != null ? String(produto.aliquota_icms) : '')
  const [aliquotaIpi, setAliquotaIpi] = useState(String(produto?.aliquota_ipi ?? '0'))
  const [cstPis, setCstPis] = useState(produto?.cst_pis ?? '')
  const [aliquotaPis, setAliquotaPis] = useState(produto?.aliquota_pis != null ? String(produto.aliquota_pis) : '')
  const [cstCofins, setCstCofins] = useState(produto?.cst_cofins ?? '')
  const [aliquotaCofins, setAliquotaCofins] = useState(produto?.aliquota_cofins != null ? String(produto.aliquota_cofins) : '')
  // CST 60/500 · ST retido (por unidade). '' = não informado (mantém NULL no banco).
  const [vbcstRet, setVbcstRet] = useState(produto?.vbcst_ret != null ? String(produto.vbcst_ret) : '')
  const [pst, setPst] = useState(produto?.pst != null ? String(produto.pst) : '')
  const [vicmsSubstituto, setVicmsSubstituto] = useState(produto?.vicms_substituto != null ? String(produto.vicms_substituto) : '')
  const [vicmsStRet, setVicmsStRet] = useState(produto?.vicms_st_ret != null ? String(produto.vicms_st_ret) : '')
  // Grupo comb (NCM 2710) · ANP. '' = não informado (mantém NULL no banco).
  const [combAnpCodigo, setCombAnpCodigo] = useState(produto?.combustivel_codigo_anp != null ? String(produto.combustivel_codigo_anp) : '')
  const [combAnpDescricao, setCombAnpDescricao] = useState(produto?.combustivel_descricao_anp ?? '')
  const ncmEhCombustivel = ncm.replace(/\D/g, '').startsWith('2710')

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const ncmLimpo = ncm.replace(/\D/g, '')
      if (!nome.trim()) throw new Error('Nome obrigatorio')
      if (!codigo.trim()) throw new Error('Codigo obrigatorio')

      const payload = {
        company_id: companyId,
        codigo: codigo.trim(),
        nome: nome.trim(),
        descricao: descricao || null,
        unidade: unidade || 'UN',
        preco_venda: parseFloat(precoVenda) || 0,
        preco_custo: parseFloat(precoCusto) || 0,
        ncm: ncmLimpo || null,
        cest: cest || null,
        cfop_venda: cfopVenda || null,
        origem,
        cst_icms: cstIcms.trim() || null,
        aliquota_icms: numOuNulo(aliquotaIcms),
        aliquota_ipi: parseFloat(aliquotaIpi) || 0,
        cst_pis: cstPis.trim() || null,
        aliquota_pis: numOuNulo(aliquotaPis),
        cst_cofins: cstCofins.trim() || null,
        aliquota_cofins: numOuNulo(aliquotaCofins),
        // ST retido (CST 60/500) · '' → NULL; 0 é valor válido, por isso não uso `|| null`.
        vbcst_ret: vbcstRet.trim() === '' ? null : parseFloat(vbcstRet.replace(',', '.')),
        pst: pst.trim() === '' ? null : parseFloat(pst.replace(',', '.')),
        vicms_substituto: vicmsSubstituto.trim() === '' ? null : parseFloat(vicmsSubstituto.replace(',', '.')),
        vicms_st_ret: vicmsStRet.trim() === '' ? null : parseFloat(vicmsStRet.replace(',', '.')),
        // Grupo comb (NCM 2710) · código ANP é inteiro; '' → NULL.
        combustivel_codigo_anp: combAnpCodigo.trim() === '' ? null : parseInt(combAnpCodigo.replace(/\D/g, ''), 10),
        combustivel_descricao_anp: combAnpDescricao.trim() === '' ? null : combAnpDescricao.trim(),
        ativo: true,
      }
      // Defesa: na edição, campo que NÃO veio carregado no produto e continua vazio não vai no PATCH — senão o salvar
      // apagaria no banco um valor que a ficha nem chegou a ver (CST, alíquotas, ST retido…).
      const enviado: Record<string, unknown> = { ...payload }
      if (produto) {
        for (const k of Object.keys(enviado)) {
          if (!(k in produto) && (enviado[k] === null || enviado[k] === '')) delete enviado[k]
        }
      }
      const body = produto ? { ...enviado, id: produto.id } : payload

      const r = await authFetch('/api/cadastros/produtos', {
        method: produto ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) throw new Error(json.mensagem ?? 'Erro ao salvar')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-[15px] font-medium text-[#3D2314]">
            {produto ? 'Editar Produto' : 'Novo Produto'}
          </h2>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-[#3D2314]/10 px-5 sticky top-[57px] bg-white z-10">
          {(['basico', 'fiscal', 'precos'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAba(t)}
              className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors ${
                aba === t
                  ? 'border-[#C8941A] text-[#3D2314]'
                  : 'border-transparent text-[#3D2314]/55 hover:text-[#3D2314]'
              }`}
            >
              {t === 'basico' ? 'Basico' : t === 'fiscal' ? 'Fiscal (NCM/CFOP/CST)' : 'Precos'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {aba === 'basico' && (
            <>
              <Campo label="Codigo * (interno)" value={codigo} onChange={setCodigo} placeholder="ex: PROD-001" />
              <Campo label="Nome *" value={nome} onChange={setNome} placeholder="Tinta acrilica branca 18L" />
              <Campo
                label="Descricao"
                value={descricao}
                onChange={setDescricao}
                placeholder="Detalhes adicionais (entra na NFe)"
                multiline
              />
              <Campo label="Unidade *" value={unidade} onChange={setUnidade} placeholder="UN · KG · M · L · CX" />
            </>
          )}

          {aba === 'fiscal' && (
            <>
              {produto?.fiscal_observacao && (
                <div data-testid="produto-fiscal-observacao" className="rounded-lg border border-[#C8941A]/40 bg-[#FBF4E4] px-3 py-2 text-[12px] text-[#633806]">
                  ⚠ {produto.fiscal_observacao}
                </div>
              )}
              <Campo label="NCM * (8 digitos)" value={ncm} onChange={setNcm} placeholder="ex: 32091010" maxLength={8} mono />
              <Campo label="CEST" value={cest} onChange={setCest} placeholder="opcional (substituicao tributaria)" />
              <Campo label="CFOP venda" value={cfopVenda} onChange={setCfopVenda} placeholder="5102 (dentro estado) · 6102 (fora)" />
              <Select
                label="Origem"
                value={origem}
                onChange={setOrigem}
                options={[
                  ['0', '0 · Nacional'],
                  ['1', '1 · Estrangeira (importacao direta)'],
                  ['2', '2 · Estrangeira (mercado interno)'],
                  ['3', '3 · Nacional com importacao > 40%'],
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Campo label="CST / CSOSN ICMS" value={cstIcms} onChange={setCstIcms} placeholder="Simples: 102, 500… · normal: 00, 60…" />
                <Campo label="Aliquota ICMS (%)" value={aliquotaIcms} onChange={setAliquotaIcms} placeholder="vazio = não informado" />
                <Campo label="Aliquota IPI (%)" value={aliquotaIpi} onChange={setAliquotaIpi} placeholder="0" />
                <span />
                <Campo label="CST PIS" value={cstPis} onChange={setCstPis} placeholder="ex.: 01, 04, 49" />
                <Campo label="Aliquota PIS (%)" value={aliquotaPis} onChange={setAliquotaPis} placeholder="vazio = não informado" />
                <Campo label="CST COFINS" value={cstCofins} onChange={setCstCofins} placeholder="ex.: 01, 04, 49" />
                <Campo label="Aliquota COFINS (%)" value={aliquotaCofins} onChange={setAliquotaCofins} placeholder="vazio = não informado" />
              </div>

              {(cstIcms === '500' || cstIcms === '60') && (
                <div className="mt-4 rounded-lg border border-[#C99A2E]/40 bg-[#FBF6EA] p-3">
                  <div className="text-[12px] font-semibold text-[#3D2314] mb-0.5">ICMS ST retido (CST {cstIcms})</div>
                  <div className="text-[11px] text-[#6B4B33] mb-2.5">
                    Obrigatorio pelo leiaute (NT 2018.005) — sem isto a SEFAZ rejeita (938). Valores <b>por unidade</b>:
                    a nota multiplica pela quantidade vendida. A aliquota (pST) e percentual e nao multiplica.
                    Os quatro vem da nota de compra do fornecedor.
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="vBCSTRet · Base ICMS ST retido (R$/un)" value={vbcstRet} onChange={setVbcstRet} placeholder="0.00" />
                    <Campo label="pST · Aliquota consumidor final (%)" value={pst} onChange={setPst} placeholder="ex: 18" />
                    <Campo label="vICMSSubstituto · ICMS do substituto (R$/un)" value={vicmsSubstituto} onChange={setVicmsSubstituto} placeholder="0.00" />
                    <Campo label="vICMSSTRet · ICMS ST retido (R$/un)" value={vicmsStRet} onChange={setVicmsStRet} placeholder="0.00" />
                  </div>
                </div>
              )}

              {ncmEhCombustivel && (
                <div className="mt-4 rounded-lg border border-[#C99A2E]/40 bg-[#FBF6EA] p-3">
                  <div className="text-[12px] font-semibold text-[#3D2314] mb-0.5">Combustivel / lubrificante — grupo ANP (NCM 2710)</div>
                  <div className="text-[11px] text-[#6B4B33] mb-2.5">
                    Obrigatorio pelo leiaute (NT 2016/002) — sem isto a SEFAZ rejeita o grupo comb. O codigo
                    e a descricao vem da tabela SIMP da ANP (fixos por produto). A UF de consumo sai da nota
                    (destinatario), nao e preenchida aqui.
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="cProdANP · Codigo ANP (SIMP)" value={combAnpCodigo} onChange={setCombAnpCodigo} placeholder="ex: 320101001" maxLength={9} mono />
                    <Campo label="descANP · Descricao ANP" value={combAnpDescricao} onChange={setCombAnpDescricao} placeholder="descricao conforme a ANP" />
                  </div>
                </div>
              )}
            </>
          )}

          {aba === 'precos' && (
            <>
              <Campo label="Preco de venda (R$) *" value={precoVenda} onChange={setPrecoVenda} placeholder="0.00" />
              <Campo label="Preco de custo (R$)" value={precoCusto} onChange={setPrecoCusto} placeholder="0.00" />
              <p className="text-[11.5px] text-[#3D2314]/55">
                Margem:{' '}
                {parseFloat(precoCusto) > 0 && parseFloat(precoVenda) > 0
                  ? (((parseFloat(precoVenda) - parseFloat(precoCusto)) / parseFloat(precoVenda)) * 100).toFixed(1) + '%'
                  : '—'}
              </p>
            </>
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
              disabled={!nome || !codigo || salvando}
              data-testid="produto-salvar"
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
  maxLength?: number
  mono?: boolean
}

function Campo({ label, value, onChange, placeholder, multiline, maxLength, mono }: CampoProps) {
  const cls = `w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40 ${
    mono ? 'font-mono' : ''
  }`
  return (
    <div>
      <label className="text-[12px] font-medium text-[#3D2314] block mb-1.5">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cls}
        />
      )}
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
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  )
}
