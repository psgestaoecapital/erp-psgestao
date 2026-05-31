'use client'

// Nova Venda Modal · Sub-frente 5.3 Onda 5
// Chama fn_orcamento_criar_venda · cria conta a receber + retorna codigo.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Cliente { id: string; nome_fantasia: string | null; razao_social: string | null }
interface Categoria { id: string; codigo: string; descricao: string }

type TipoVenda = 'orcamento' | 'venda_avulsa' | 'venda_recorrente'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
}

function nomeCliente(c: Cliente): string {
  return c.nome_fantasia || c.razao_social || 'Cliente sem nome'
}

function plus30(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().split('T')[0]
}

export default function NovaVendaModal({ open, onClose, companyId }: Props) {
  const router = useRouter()
  const [tipo, setTipo] = useState<TipoVenda>('venda_avulsa')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [clienteId, setClienteId] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(plus30())
  const [categoria, setCategoria] = useState('')
  const [emitirNF, setEmitirNF] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !companyId) return
    let ignore = false
    ;(async () => {
      const [cli, cat] = await Promise.all([
        supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', companyId).eq('ativo', true).order('nome_fantasia'),
        supabase.from('erp_plano_contas').select('id, codigo, descricao').eq('company_id', companyId).eq('tipo', 'receita').eq('ativo', true).order('codigo'),
      ])
      if (ignore) return
      setClientes((cli.data ?? []) as Cliente[])
      setCategorias((cat.data ?? []) as Categoria[])
    })()
    return () => { ignore = true }
  }, [open, companyId])

  async function confirmar() {
    setErro(null)
    if (!clienteId) { setErro('Selecione um cliente'); return }
    if (!descricao.trim()) { setErro('Descreva a venda'); return }
    if (!valor || Number(valor) <= 0) { setErro('Informe o valor'); return }

    setLoading(true)
    const { data, error } = await supabase.rpc('fn_orcamento_criar_venda', {
      p_company_id: companyId,
      p_cliente_id: clienteId,
      p_tipo_venda: tipo,
      p_situacao: tipo === 'orcamento' ? 'pendente' : 'aprovado',
      p_descricao: descricao.trim(),
      p_valor: Number(valor),
      p_data_venda: new Date().toISOString().split('T')[0],
      p_vencimento: vencimento,
      p_categoria_codigo: categoria || null,
      p_emitir_nf: emitirNF,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    const res = data as { codigo?: string; success?: boolean; mensagem?: string } | null
    if (res && res.success === false) { setErro(res.mensagem ?? 'Falha ao criar venda'); return }
    onClose()
    if (tipo !== 'orcamento') {
      router.push('/dashboard/financeiro/receber')
    }
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, padding: '24px', maxWidth: 520, width: '100%', boxShadow: '0 10px 30px rgba(61,35,20,0.25)' }}>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: '0 0 18px' }}>Nova Venda</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Tipo">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([['orcamento', 'Orçamento'], ['venda_avulsa', 'Venda Avulsa'], ['venda_recorrente', 'Recorrente']] as Array<[TipoVenda, string]>).map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#3D2314', cursor: 'pointer' }}>
                  <input type="radio" name="tipo" value={k} checked={tipo === k} onChange={() => setTipo(k)} />
                  {label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Cliente">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={input}>
              <option value="">— selecione —</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{nomeCliente(c)}</option>)}
            </select>
          </Field>

          <Field label="Descrição">
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Consultoria mensal · Setembro" style={input} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <Field label="Valor R$">
              <input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} style={input} />
            </Field>
            <Field label="Vencimento">
              <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={input} />
            </Field>
          </div>

          <Field label="Categoria (opcional)">
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={input}>
              <option value="">— sem categoria —</option>
              {categorias.map((c) => <option key={c.id} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
            </select>
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer', padding: '6px 0' }}>
            <input type="checkbox" checked={emitirNF} onChange={(e) => setEmitirNF(e.target.checked)} />
            Emitir NF-e?
          </label>

          {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>{erro}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading || clientes.length === 0} style={primaryBtn(loading)}>
            {loading ? 'Criando…' : tipo === 'orcamento' ? 'Salvar Orçamento' : tipo === 'venda_recorrente' ? 'Criar Recorrência' : 'Lançar Venda Avulsa'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

const input: React.CSSProperties = {
  width: '100%', background: '#FFFFFF',
  border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6,
  padding: '8px 10px', fontSize: 13, color: '#3D2314',
  fontFamily: 'inherit', boxSizing: 'border-box',
}

function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
