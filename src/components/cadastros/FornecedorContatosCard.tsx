'use client'

// FEAT-FORNECEDOR-VENDEDORES-WHATSAPP-v1
// CRUD inline de vendedores/contatos por fornecedor.
// Light theme · mobile-first · linguagem CRIOU/ALTEROU/EXCLUIU.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Star, Save, Loader2 } from 'lucide-react'

interface Contato {
  id: string
  nome: string
  telefone: string | null
  cargo: string | null
  principal: boolean
  ativo: boolean
}

interface Props {
  companyId: string
  fornecedorId: string
}

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80',
  white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#10B981', greenBg: '#ECFDF5',
  red: '#EF4444', redBg: '#FEE2E2',
}

const inp: React.CSSProperties = {
  width: '100%', minHeight: 36, padding: '8px 10px',
  border: `1px solid ${C.border}`, borderRadius: 6,
  fontSize: 12, color: C.espresso, background: C.white, outline: 'none',
}

export default function FornecedorContatosCard({ companyId, fornecedorId }: Props) {
  const [contatos, setContatos] = useState<Contato[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msgOk, setMsgOk] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Form novo
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cargo, setCargo] = useState('')
  const [principal, setPrincipal] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('erp_fornecedor_contatos')
      .select('id,nome,telefone,cargo,principal,ativo')
      .eq('fornecedor_id', fornecedorId)
      .eq('ativo', true)
      .order('principal', { ascending: false })
      .order('nome')
    if (error) setErro(error.message)
    setContatos((data ?? []) as Contato[])
    setLoading(false)
  }, [fornecedorId])

  useEffect(() => { void carregar() }, [carregar])

  function flash(m: string) {
    setMsgOk(m)
    window.setTimeout(() => setMsgOk((x) => (x === m ? null : x)), 3000)
  }

  async function adicionar() {
    // FIX-FORNECEDOR-CONTATO-SAVE-v2 · validacoes + .select() + erro visivel
    const nomeT = nome.trim()
    if (!nomeT) { setErro('Informe o nome.'); return }
    if (!companyId) {
      setErro('Empresa não identificada · selecione uma empresa antes de cadastrar contato.')
      return
    }
    if (!fornecedorId) {
      setErro('Fornecedor sem id · salve o fornecedor antes de cadastrar contato.')
      return
    }
    setSalvando(true)
    setErro(null)

    // .select() devolve a linha inserida pra confirmar o sucesso de verdade ·
    // supabase client da sessao (anon + auth) · NUNCA admin/service_role
    const { data, error } = await supabase
      .from('erp_fornecedor_contatos')
      .insert({
        company_id: companyId,
        fornecedor_id: fornecedorId,
        nome: nomeT,
        telefone: telefone.trim() || null,
        cargo: cargo.trim() || null,
        principal,
        ativo: true,
      })
      .select()

    setSalvando(false)

    if (error) {
      console.error('[FornecedorContatosCard] INSERT erp_fornecedor_contatos falhou:', error)
      setErro(`Erro ao salvar: ${error.message}${error.details ? ` · ${error.details}` : ''}`)
      return // NAO fecha · NAO limpa form · usuario pode corrigir e tentar de novo
    }
    if (!data || data.length === 0) {
      console.error('[FornecedorContatosCard] INSERT retornou sem linha · provavel bloqueio RLS')
      setErro('Erro ao salvar: nenhuma linha foi gravada. Verifique se voce esta vinculado a esta empresa.')
      return
    }

    // Sucesso · limpa form + recarrega lista
    setNome(''); setTelefone(''); setCargo(''); setPrincipal(false)
    flash(`Vendedor "${nomeT}" salvo.`)
    await carregar()
  }

  async function marcarPrincipal(id: string) {
    // 1 principal por fornecedor: zera todos, marca este
    setErro(null)
    await supabase.from('erp_fornecedor_contatos').update({ principal: false }).eq('fornecedor_id', fornecedorId)
    const { error } = await supabase.from('erp_fornecedor_contatos').update({ principal: true }).eq('id', id)
    if (error) { setErro(error.message); return }
    flash('Vendedor ALTERADO · principal.')
    await carregar()
  }

  async function excluir(id: string) {
    if (!confirm('EXCLUIR este vendedor?')) return
    setErro(null)
    const { error } = await supabase.from('erp_fornecedor_contatos').delete().eq('id', id)
    if (error) { setErro(error.message); return }
    flash('Vendedor EXCLUÍDO.')
    await carregar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.espressoM, textTransform: 'uppercase', letterSpacing: 1 }}>
        Vendedores / Contatos
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Carregando…</p>
      ) : contatos.length === 0 ? (
        <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>Nenhum vendedor cadastrado.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {contatos.map((c) => (
            <li key={c.id} style={{
              padding: 10, background: C.white, borderTop: `1px solid ${C.border}`,
              display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center',
            }} data-testid="forn-contato-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.principal && <Star size={11} fill={C.gold} color={C.gold} />}
                  {c.nome}
                </div>
                <div style={{ fontSize: 11, color: C.espressoM }}>
                  {c.cargo && <span>{c.cargo}</span>}
                  {c.cargo && c.telefone && <span> · </span>}
                  {c.telefone && <span>{c.telefone}</span>}
                </div>
              </div>
              {!c.principal && (
                <button
                  type="button"
                  onClick={() => void marcarPrincipal(c.id)}
                  data-testid="forn-contato-principal"
                  title="Marcar como principal"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM, padding: 4 }}
                >
                  <Star size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => void excluir(c.id)}
                data-testid="forn-contato-excluir"
                aria-label="Excluir"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, padding: 4 }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{
        marginTop: 4, padding: 10, background: C.cream, borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.espressoM }}>Novo vendedor</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome *" style={inp} data-testid="forn-contato-novo-nome" />
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="WhatsApp (DDD)" style={inp} data-testid="forn-contato-novo-tel" />
        </div>
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo (opcional)" style={inp} />
        <label style={{ fontSize: 12, color: C.espresso, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={principal} onChange={(e) => setPrincipal(e.target.checked)} style={{ accentColor: C.gold }} />
          Marcar como principal
        </label>
        <button
          type="button"
          onClick={adicionar}
          disabled={salvando || !nome.trim()}
          data-testid="forn-contato-adicionar"
          style={{
            minHeight: 36, padding: '8px 12px', borderRadius: 6,
            border: 'none', background: C.gold, color: C.white,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            opacity: (salvando || !nome.trim()) ? 0.5 : 1,
            alignSelf: 'flex-start',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Adicionar
        </button>
      </div>

      {erro && <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {erro}</p>}
      {msgOk && <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>✓ {msgOk}</p>}
    </div>
  )
}
