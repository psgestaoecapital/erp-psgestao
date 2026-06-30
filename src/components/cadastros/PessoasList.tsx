'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PessoaForm, { type Pessoa } from './PessoaForm'

interface Props {
  companyId: string
  tipo: 'cliente' | 'fornecedor'
}

function fmtCNPJ(s: string | null): string {
  if (!s) return '—'
  const d = s.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return s
}

export default function PessoasList({ companyId, tipo }: Props) {
  const router = useRouter()
  const tabela = tipo === 'cliente' ? 'erp_clientes' : 'erp_fornecedores'
  const labelSingular = tipo === 'cliente' ? 'cliente' : 'fornecedor'
  const labelPlural = tipo === 'cliente' ? 'Clientes' : 'Fornecedores'
  const descricao = tipo === 'cliente'
    ? 'Cadastre quem compra seus produtos ou serviços. Usado em lançamentos e cobranças.'
    : 'Cadastre quem você paga. Usado em contas a pagar e DRE.'

  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Pessoa | null>(null)
  const [busca, setBusca] = useState('')
  const [drawerPessoa, setDrawerPessoa] = useState<Pessoa | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from(tabela)
      .select('id, company_id, nome_fantasia, razao_social, cnpj_cpf, tipo_pessoa, email, telefone, whatsapp, cep, logradouro, numero, bairro, complemento, cidade, uf, ativo, tags')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .order('nome_fantasia')
    if (data) setPessoas(data as Pessoa[])
    setLoading(false)
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, tabela])

  async function handleInativar(id: string) {
    if (!confirm(`Inativar esse ${labelSingular}? Você pode reativá-lo depois.`)) return
    await supabase.from(tabela).update({ ativo: false }).eq('id', id)
    load()
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return pessoas
    const qDigits = q.replace(/\D/g, '')
    return pessoas.filter((p) => {
      if ((p.nome_fantasia ?? '').toLowerCase().includes(q)) return true
      if ((p.razao_social ?? '').toLowerCase().includes(q)) return true
      if (qDigits && (p.cnpj_cpf ?? '').includes(qDigits)) return true
      return false
    })
  }, [pessoas, busca])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.5)' }}>Carregando {labelPlural.toLowerCase()}…</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Cadastros · Gestão Empresarial
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
            {labelPlural}
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 560 }}>
            {descricao}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Novo {labelSingular}
        </button>
      </div>

      {pessoas.length > 0 && (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar por nome ou CNPJ/CPF…`}
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 6, fontSize: 13, color: '#3D2314', background: 'transparent' }}
          />
          <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
            {filtradas.length} de {pessoas.length} ativos
          </span>
        </div>
      )}

      {pessoas.length === 0 ? (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>👥</div>
          <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.65)', marginBottom: 16 }}>
            Você ainda não tem nenhum {labelSingular} cadastrado.
            <br />
            Cadastre o primeiro para começar.
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Cadastrar primeiro {labelSingular}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtradas.length === 0 ? (
            <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: 32, textAlign: 'center', color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>
              Nenhum resultado para “{busca}”.
            </div>
          ) : (
            filtradas.map((p) => (
              <Card
                key={p.id}
                pessoa={p}
                onAbrir={() => setDrawerPessoa(p)}
                onEditar={() => {
                  setEditing(p)
                  setShowForm(true)
                }}
                onInativar={() => handleInativar(p.id)}
              />
            ))
          )}
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao Dashboard
        </button>
      </div>

      {showForm && (
        <PessoaForm
          companyId={companyId}
          tipo={tipo}
          pessoa={editing}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
            load()
          }}
        />
      )}

      {drawerPessoa && (
        <PessoaDrawer
          pessoa={drawerPessoa}
          tipo={tipo}
          onClose={() => setDrawerPessoa(null)}
          onEditar={() => {
            setEditing(drawerPessoa)
            setShowForm(true)
            setDrawerPessoa(null)
          }}
          onInativar={() => {
            handleInativar(drawerPessoa.id)
            setDrawerPessoa(null)
          }}
        />
      )}
    </div>
  )
}

function Card({ pessoa, onAbrir, onEditar, onInativar }: { pessoa: Pessoa; onAbrir: () => void; onEditar: () => void; onInativar: () => void }) {
  const isPJ = pessoa.tipo_pessoa === 'PJ'
  const icone = isPJ ? '🏢' : '👤'
  const local = [pessoa.cidade, pessoa.uf].filter(Boolean).join(' / ')
  const contato = [pessoa.email, pessoa.telefone].filter(Boolean).join(' · ')
  const tags = pessoa.tags ?? []

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir() } }}
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderLeft: '4px solid #3D2314',
        borderRadius: 8,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 22 }} aria-hidden>{icone}</div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#3D2314' }}>{pessoa.nome_fantasia}</span>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgba(200,148,26,0.15)', color: '#854F0B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {pessoa.tipo_pessoa ?? '—'}
          </span>
          {tags.map((t) => (
            <span key={t} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#3D2314', color: '#FAF7F2', fontWeight: 600 }}>
              {t}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 3 }}>
          {pessoa.razao_social && pessoa.razao_social !== pessoa.nome_fantasia ? `${pessoa.razao_social} · ` : ''}
          {fmtCNPJ(pessoa.cnpj_cpf)}
          {local && ` · ${local}`}
        </div>
        {contato && (
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>{contato}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onEditar} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Editar
        </button>
        <button type="button" onClick={onInativar} style={{ background: 'transparent', color: '#A32D2D', border: '0.5px solid rgba(163,45,45,0.3)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Inativar
        </button>
      </div>
    </div>
  )
}

function PessoaDrawer({ pessoa, tipo, onClose, onEditar, onInativar }: { pessoa: Pessoa; tipo: 'cliente' | 'fornecedor'; onClose: () => void; onEditar: () => void; onInativar: () => void }) {
  const router = useRouter()
  const tags = pessoa.tags ?? []
  const inicial = (pessoa.nome_fantasia ?? '?').charAt(0).toUpperCase()
  const telDigits = (pessoa.telefone ?? '').replace(/\D/g, '')
  const telForWa = telDigits ? (telDigits.length <= 11 ? `55${telDigits}` : telDigits) : ''
  const waHref = telForWa ? `https://wa.me/${telForWa}?text=${encodeURIComponent(`Olá ${(pessoa.nome_fantasia ?? '').split(' ')[0]}, tudo bem?`)}` : null
  const mailHref = pessoa.email ? `mailto:${pessoa.email}` : null
  const verLancamentos = () => {
    const destino = tipo === 'cliente' ? '/dashboard/financeiro/receber' : '/dashboard/financeiro/pagar'
    router.push(`${destino}?q=${encodeURIComponent(pessoa.nome_fantasia ?? '')}`)
  }
  const renegociar = () => {
    if (tipo === 'cliente') router.push(`/dashboard/financeiro/inadimplentes?q=${encodeURIComponent(pessoa.nome_fantasia ?? '')}`)
  }
  const exportar = () => {
    const head = ['Campo', 'Valor']
    const linhas = [
      ['Nome', pessoa.nome_fantasia],
      ['Razão social', pessoa.razao_social],
      ['CNPJ/CPF', pessoa.cnpj_cpf],
      ['Tipo', pessoa.tipo_pessoa],
      ['Email', pessoa.email],
      ['Telefone', pessoa.telefone],
      ['Cidade', pessoa.cidade],
      ['UF', pessoa.uf],
      ['Tags', tags.join(', ')],
    ]
    const csv = [head, ...linhas].map((r) => r.map((c) => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tipo}_${pessoa.nome_fantasia ?? 'sem-nome'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', width: 380, maxWidth: '100%', height: '100vh', boxShadow: '-12px 0 30px rgba(61,35,20,0.25)', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '18px 20px', position: 'sticky', top: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#C8941A', color: '#3D2314', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }} aria-hidden>
              {inicial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pessoa.nome_fantasia}</div>
              <div style={{ fontSize: 11, color: 'rgba(250,247,242,0.7)' }}>{pessoa.tipo_pessoa ?? '—'} · {fmtCNPJ(pessoa.cnpj_cpf)}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
              {tags.map((t) => (
                <span key={t} style={{ background: '#C8941A', color: '#3D2314', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{t}</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <DrawerAction label="✏️ Editar dados" onClick={onEditar} />
          <DrawerAction label={tipo === 'cliente' ? '📥 Ver recebimentos' : '📤 Ver pagamentos'} onClick={verLancamentos} />
          {tipo === 'cliente' && <DrawerAction label="🤝 Renegociar dívidas" onClick={renegociar} />}
          {waHref ? (
            <DrawerLink href={waHref} target="_blank" label="💬 Cobrar via WhatsApp" color="#25D366" />
          ) : (
            <DrawerAction label="💬 Cobrar via WhatsApp" disabled hint="Sem telefone cadastrado" onClick={() => undefined} />
          )}
          {mailHref ? (
            <DrawerLink href={mailHref} label="✉️ Enviar email" color="#3D2314" />
          ) : (
            <DrawerAction label="✉️ Enviar email" disabled hint="Sem email cadastrado" onClick={() => undefined} />
          )}
          <DrawerAction label="📄 Exportar histórico (CSV)" onClick={exportar} />
          <div style={{ height: 1, background: 'rgba(61,35,20,0.1)', margin: '8px 0' }} />
          <DrawerAction label="🗑 Inativar" onClick={onInativar} danger />
        </div>
      </aside>
    </div>
  )
}

function DrawerAction({ label, onClick, danger, disabled, hint }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      style={{
        background: '#FFFFFF',
        color: danger ? '#A32D2D' : '#3D2314',
        border: `0.5px solid ${danger ? 'rgba(163,45,45,0.3)' : 'rgba(61,35,20,0.15)'}`,
        padding: '12px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  )
}

function DrawerLink({ href, label, color, target }: { href: string; label: string; color: string; target?: string }) {
  return (
    <a
      href={href}
      target={target}
      rel={target ? 'noopener noreferrer' : undefined}
      style={{
        background: '#FFFFFF',
        color,
        border: '0.5px solid rgba(61,35,20,0.15)',
        padding: '12px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'left',
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  )
}
