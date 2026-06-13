'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import FornecedorContatosCard from './FornecedorContatosCard'
import { buscarCNPJ } from '@/lib/cadastros/buscarCNPJ'

export interface Pessoa {
  id: string
  company_id: string
  nome_fantasia: string
  razao_social: string | null
  cnpj_cpf: string | null
  tipo_pessoa: 'PF' | 'PJ' | null
  email: string | null
  telefone: string | null
  cidade: string | null
  uf: string | null
  ativo: boolean
  tags: string[] | null
}

export const TAGS_SUGERIDAS = ['Cliente', 'Fornecedor', 'Funcionário', 'Parceiro', 'Prospect']

interface Props {
  companyId: string
  tipo: 'cliente' | 'fornecedor'
  pessoa: Pessoa | null
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

export default function PessoaForm({ companyId, tipo, pessoa, onClose, onSaved }: Props) {
  const tabela = tipo === 'cliente' ? 'erp_clientes' : 'erp_fornecedores'
  const label = tipo === 'cliente' ? 'cliente' : 'fornecedor'

  const [tipoPessoa, setTipoPessoa] = useState<'PF' | 'PJ'>(pessoa?.tipo_pessoa ?? 'PJ')
  const [cnpjCpf, setCnpjCpf] = useState(pessoa?.cnpj_cpf ?? '')
  const [nomeFantasia, setNomeFantasia] = useState(pessoa?.nome_fantasia ?? '')
  const [razaoSocial, setRazaoSocial] = useState(pessoa?.razao_social ?? '')
  const [email, setEmail] = useState(pessoa?.email ?? '')
  const [telefone, setTelefone] = useState(pessoa?.telefone ?? '')
  const [cidade, setCidade] = useState(pessoa?.cidade ?? '')
  const [uf, setUf] = useState(pessoa?.uf ?? '')
  const [tags, setTags] = useState<string[]>(pessoa?.tags ?? (tipo === 'cliente' ? ['Cliente'] : ['Fornecedor']))
  const [novaTag, setNovaTag] = useState('')
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function adicionarTag(t: string) {
    const limpa = t.trim()
    if (!limpa) return
    if (tags.includes(limpa)) return
    setTags([...tags, limpa])
    setNovaTag('')
  }

  function removerTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  async function handleBuscarCNPJ() {
    if (tipoPessoa !== 'PJ') return
    const digits = cnpjCpf.replace(/\D/g, '')
    if (digits.length !== 14) {
      setErro('CNPJ deve ter 14 dígitos')
      return
    }
    setBuscandoCNPJ(true)
    setErro(null)
    const dados = await buscarCNPJ(cnpjCpf)
    setBuscandoCNPJ(false)
    if (!dados) {
      setErro('CNPJ não encontrado na Receita Federal — preencha manualmente')
      return
    }
    setRazaoSocial(dados.razao_social)
    if (!nomeFantasia) setNomeFantasia(dados.nome_fantasia || dados.razao_social)
    if (dados.email && !email) setEmail(dados.email)
    if (dados.telefone && !telefone) setTelefone(dados.telefone)
    if (dados.cidade && !cidade) setCidade(dados.cidade)
    if (dados.uf && !uf) setUf(dados.uf)
  }

  async function handleSalvar() {
    if (!nomeFantasia.trim()) {
      setErro('Nome / Apelido é obrigatório')
      return
    }
    setSalvando(true)
    setErro(null)

    const payload = {
      company_id: companyId,
      nome_fantasia: nomeFantasia.trim(),
      razao_social: razaoSocial.trim() || null,
      cnpj_cpf: cnpjCpf.replace(/\D/g, '') || null,
      tipo_pessoa: tipoPessoa,
      email: email.trim() || null,
      telefone: telefone.trim() || null,
      cidade: cidade.trim() || null,
      uf: uf.trim().toUpperCase().slice(0, 2) || null,
      ativo: pessoa?.ativo ?? true,
      tags: tags.length > 0 ? tags : null,
    }

    const result = pessoa?.id
      ? await supabase.from(tabela).update(payload).eq('id', pessoa.id)
      : await supabase.from(tabela).insert(payload)

    setSalvando(false)
    if (result.error) setErro('Erro: ' + result.error.message)
    else onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 580, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {pessoa?.id ? 'Editar' : 'Novo'} {label}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{erro}</div>
          )}

          <Campo label="Tipo de pessoa *">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['PJ', 'PF'] as const).map((t) => {
                const ativo = tipoPessoa === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoPessoa(t)}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      background: ativo ? '#3D2314' : '#FFFFFF',
                      color: ativo ? '#FAF7F2' : '#3D2314',
                      border: '0.5px solid rgba(61,35,20,0.15)',
                      fontWeight: 600,
                    }}
                  >
                    {t === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                  </button>
                )
              })}
            </div>
          </Campo>

          <Campo
            label={tipoPessoa === 'PJ' ? 'CNPJ' : 'CPF'}
            hint={tipoPessoa === 'PJ' ? 'Auto-preenche dados via BrasilAPI (Receita Federal)' : 'Opcional'}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={cnpjCpf}
                onChange={(e) => setCnpjCpf(e.target.value)}
                placeholder={tipoPessoa === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                style={{ ...inputStyle, flex: 1 }}
              />
              {tipoPessoa === 'PJ' && (
                <button
                  type="button"
                  onClick={handleBuscarCNPJ}
                  disabled={buscandoCNPJ}
                  style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: buscandoCNPJ ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {buscandoCNPJ ? 'Buscando…' : '🔍 Buscar'}
                </button>
              )}
            </div>
          </Campo>

          <Campo label="Nome / Apelido *" hint={`Como você identifica esse ${label} no dia-a-dia`}>
            <input value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} style={inputStyle} />
          </Campo>

          {tipoPessoa === 'PJ' && (
            <Campo label="Razão Social">
              <input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} style={inputStyle} />
            </Campo>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="Telefone">
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 12 }}>
            <Campo label="Cidade">
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="UF">
              <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} style={inputStyle} maxLength={2} />
            </Campo>
          </div>

          <Campo label="Tags" hint="Categorize a pessoa · clique nas sugestões ou digite uma tag nova">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {tags.map((t) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#C8941A', color: '#3D2314', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                  {t}
                  <button type="button" onClick={() => removerTag(t)} aria-label={`Remover ${t}`} style={{ background: 'transparent', border: 'none', color: '#3D2314', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {TAGS_SUGERIDAS.filter((t) => !tags.includes(t)).map((t) => (
                <button key={t} type="button" onClick={() => adicionarTag(t)} style={{ background: 'transparent', border: '0.5px solid rgba(61,35,20,0.2)', color: '#3D2314', padding: '2px 8px', borderRadius: 12, fontSize: 11, cursor: 'pointer' }}>
                  + {t}
                </button>
              ))}
            </div>
            <input
              value={novaTag}
              onChange={(e) => setNovaTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  adicionarTag(novaTag)
                }
              }}
              placeholder="Digite uma tag e tecle Enter…"
              style={{ ...inputStyle, fontSize: 12 }}
            />
          </Campo>

          {/* FEAT-FORNECEDOR-VENDEDORES-WHATSAPP-v1 · so em fornecedor ja salvo */}
          {tipo === 'fornecedor' && pessoa?.id && (
            <div style={{
              marginTop: 16, padding: 16, borderRadius: 8,
              background: '#FAF7F2', border: '1px solid #E0D8CC',
            }}>
              <FornecedorContatosCard fornecedorId={pessoa.id} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}
            >
              {salvando ? 'Salvando…' : pessoa?.id ? 'Salvar' : `Cadastrar ${label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
