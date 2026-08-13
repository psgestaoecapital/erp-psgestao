'use client'
// Seletor de USUÁRIO do tenant (RD-26: fonte fn_usuarios_da_empresa, já filtrada por company_id — Pilar 2).
// Busca-como-digita (por nome OU e-mail), mas EXIBE só o nome — nunca o e-mail (decisão do CEO). Ao escolher
// devolve (id, nome) — grava responsavel_id + responsavel_nome. RD-51: sem full_name, embeleza o prefixo do
// e-mail (nomeUsuario), nunca mostra o e-mail inteiro.
import { useState, type CSSProperties } from 'react'
import { nomeUsuario } from '@/lib/usuarioLabel'

export type UsuarioOpt = { id: string; email: string | null; full_name?: string | null }

export default function SeletorUsuario({
  users, value, onChange, placeholder = 'Selecione o responsável…', disabled,
}: {
  users: UsuarioOpt[]
  value: string | null // responsavel_id
  onChange: (id: string | null, nome: string | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const sel = users.find((u) => u.id === value) ?? null
  const termo = q.trim().toLowerCase()
  const filtradas = termo
    ? users.filter((u) => `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(termo))
    : users
  const nomeDe = (u: UsuarioOpt) => nomeUsuario(u)

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? q : (sel ? nomeUsuario(sel) : '')}
        onFocus={() => { if (!disabled) { setOpen(true); setQ('') } }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {sel && !open && !disabled && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onChange(null, null); setQ('') }}
          style={limparBtn}
          aria-label="Limpar responsável"
        >✕</button>
      )}
      {open && !disabled && (
        <div style={dropdown}>
          {filtradas.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#6b5444' }}>Nenhum usuário desta empresa.</div>
          )}
          {filtradas.slice(0, 50).map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(u.id, nomeDe(u)); setOpen(false); setQ('') }}
              style={{ ...dropItem, background: u.id === value ? '#FAF7F2' : '#fff' }}
            >
              <span style={{ fontWeight: 600, color: '#3D2314' }}>{nomeDe(u)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const inp: CSSProperties = {
  border: '1px solid #E7DED3', borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40,
  background: '#fff', color: '#3D2314', colorScheme: 'light' as CSSProperties['colorScheme'],
}
const limparBtn: CSSProperties = {
  position: 'absolute', right: 8, top: 8, border: 'none', background: 'none',
  color: '#6b5444', fontSize: 13, cursor: 'pointer', padding: 4, lineHeight: 1,
}
const dropdown: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: 2,
  background: '#fff', border: '1px solid #E7DED3', borderRadius: 8,
  boxShadow: '0 6px 20px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto',
}
const dropItem: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none',
  padding: '10px 12px', fontSize: 13, cursor: 'pointer', minHeight: 40,
  borderBottom: '1px solid #FAF7F2',
}
