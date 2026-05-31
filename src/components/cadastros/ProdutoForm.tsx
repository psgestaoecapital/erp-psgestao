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
  ativo?: boolean | null
}

interface Props {
  companyId: string
  produto: Produto | null
  onClose: () => void
  onSalvo: () => void
}

type Aba = 'basico' | 'fiscal' | 'precos'

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
  const [cstIcms, setCstIcms] = useState(produto?.cst_icms ?? '00')
  const [aliquotaIcms, setAliquotaIcms] = useState(String(produto?.aliquota_icms ?? '18'))
  const [aliquotaIpi, setAliquotaIpi] = useState(String(produto?.aliquota_ipi ?? '0'))
  const [cstPis, setCstPis] = useState(produto?.cst_pis ?? '01')
  const [aliquotaPis, setAliquotaPis] = useState(String(produto?.aliquota_pis ?? '1.65'))
  const [cstCofins, setCstCofins] = useState(produto?.cst_cofins ?? '01')
  const [aliquotaCofins, setAliquotaCofins] = useState(String(produto?.aliquota_cofins ?? '7.6'))

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
        cst_icms: cstIcms || null,
        aliquota_icms: parseFloat(aliquotaIcms) || 0,
        aliquota_ipi: parseFloat(aliquotaIpi) || 0,
        cst_pis: cstPis || null,
        aliquota_pis: parseFloat(aliquotaPis) || 0,
        cst_cofins: cstCofins || null,
        aliquota_cofins: parseFloat(aliquotaCofins) || 0,
        ativo: true,
      }
      const body = produto ? { ...payload, id: produto.id } : payload

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
                <Campo label="CST ICMS" value={cstIcms} onChange={setCstIcms} placeholder="00, 20, 40..." />
                <Campo label="Aliquota ICMS (%)" value={aliquotaIcms} onChange={setAliquotaIcms} placeholder="18" />
                <Campo label="Aliquota IPI (%)" value={aliquotaIpi} onChange={setAliquotaIpi} placeholder="0" />
                <span />
                <Campo label="CST PIS" value={cstPis} onChange={setCstPis} placeholder="01" />
                <Campo label="Aliquota PIS (%)" value={aliquotaPis} onChange={setAliquotaPis} placeholder="1.65" />
                <Campo label="CST COFINS" value={cstCofins} onChange={setCstCofins} placeholder="01" />
                <Campo label="Aliquota COFINS (%)" value={aliquotaCofins} onChange={setAliquotaCofins} placeholder="7.6" />
              </div>
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
