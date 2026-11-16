'use client'
import React, { useState } from 'react'
import { useLinhasNegocio } from '@/hooks/useLinhasNegocio'
import { supabase } from '@/lib/supabase'
import type { LinhaNegocio } from '@/types/linhas-negocio'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

// RD-96: paleta PS premium (mesmos tokens das telas irmãs — #C8941A/#3D2314, Fraunces), no lugar dos tokens genéricos
// shadcn/tailwind, para a jornada de linhas de negócio ficar visualmente consistente.
const C = {
  espresso: '#3D2314',
  dourado: '#C8941A',
  fundo: '#FAF7F2',
  card: '#FFFFFF',
  borda: 'rgba(61,35,20,0.15)',
  muted: 'rgba(61,35,20,0.6)',
  erro: '#A32D2D',
}
const ROTA_AJUDA = '/dashboard/linhas-negocio/configurar'

const CORES = ['#C8941A','#1A7A4A','#1A3A7A','#7A1A3A','#3A1A7A','#7A3A1A','#1A7A7A','#7A1A1A']

const rotulo: React.CSSProperties = { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, display: 'flex', alignItems: 'center', marginBottom: 6 }
const campo: React.CSSProperties = { width: '100%', border: `0.5px solid ${C.borda}`, borderRadius: 6, padding: '9px 12px', fontSize: 13, color: C.espresso, background: C.card, boxSizing: 'border-box' }

interface Props { empresaId: string }

export default function LinhasConfig({ empresaId }: Props) {
  const { linhas, loading, refetch } = useLinhasNegocio(empresaId)
  const [novo, setNovo] = useState({ nome: '', descricao: '', cor: '#C8941A' })
  const [salvando, setSalvando] = useState(false)
  // Edição inline por linha (RD-98: incluir/editar/excluir visíveis na lista).
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ nome: '', descricao: '', cor: '#C8941A' })
  const [salvandoEdit, setSalvandoEdit] = useState(false)

  async function criarLinha() {
    if (!novo.nome.trim()) return
    setSalvando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/linhas-negocio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ...novo, empresa_id: empresaId, ordem: linhas.length })
      })
      setNovo({ nome: '', descricao: '', cor: '#C8941A' })
      refetch()
    } finally { setSalvando(false) }
  }

  async function desativar(id: string) {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`/api/linhas-negocio?id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` }
    })
    refetch()
  }

  function iniciarEdicao(l: LinhaNegocio) {
    setEditId(l.id)
    setEditForm({ nome: l.nome, descricao: l.descricao ?? '', cor: l.cor })
  }

  async function salvarEdicao(id: string) {
    if (!editForm.nome.trim()) return
    setSalvandoEdit(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/linhas-negocio', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ id, nome: editForm.nome.trim(), descricao: editForm.descricao.trim(), cor: editForm.cor })
      })
      setEditId(null)
      refetch()
    } finally { setSalvandoEdit(false) }
  }

  if (loading) return <div style={{ fontSize: 13, color: C.muted, padding: 16 }}>Carregando linhas...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: C.espresso, margin: '0 0 12px' }}>Linhas cadastradas</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {linhas.length === 0 && (
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Nenhuma linha cadastrada. Crie a primeira abaixo.</p>
          )}
          {linhas.map((l: LinhaNegocio) => (
            editId === l.id ? (
              <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, border: `0.5px solid ${C.dourado}`, borderRadius: 10, background: C.card }}>
                <label style={{ display: 'block' }}>
                  <span style={rotulo}>
                    Nome da linha
                    <AjudaCampo chave="linhas_negocio.configurar.nome" rota={ROTA_AJUDA} />
                  </span>
                  <input value={editForm.nome} onChange={e => setEditForm(p => ({ ...p, nome: e.target.value }))} style={campo} />
                </label>
                <label style={{ display: 'block' }}>
                  <span style={rotulo}>
                    Descrição (opcional)
                    <AjudaCampo chave="linhas_negocio.configurar.descricao" rota={ROTA_AJUDA} />
                  </span>
                  <input value={editForm.descricao} onChange={e => setEditForm(p => ({ ...p, descricao: e.target.value }))} style={campo} />
                </label>
                <div>
                  <div style={rotulo}>
                    Cor identificadora
                    <AjudaCampo chave="linhas_negocio.configurar.cor" rota={ROTA_AJUDA} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {CORES.map(cor => (
                      <button key={cor} type="button" aria-label={`Cor ${cor}`} onClick={() => setEditForm(p => ({ ...p, cor }))}
                        style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${editForm.cor === cor ? C.espresso : 'transparent'}`, background: cor, cursor: 'pointer', padding: 0 }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setEditId(null)} style={{ fontSize: 12, color: C.muted, background: 'transparent', border: `0.5px solid ${C.borda}`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                  <button onClick={() => salvarEdicao(l.id)} disabled={salvandoEdit || !editForm.nome.trim()}
                    style={{ fontSize: 12, color: C.espresso, background: C.dourado, border: 'none', borderRadius: 6, padding: '6px 16px', cursor: salvandoEdit || !editForm.nome.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: salvandoEdit || !editForm.nome.trim() ? 0.4 : 1 }}>
                    {salvandoEdit ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            ) : (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: `0.5px solid ${C.borda}`, borderRadius: 10, background: C.card }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: l.cor }}/>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.espresso, margin: 0 }}>{l.nome}</p>
                  {l.descricao && <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>{l.descricao}</p>}
                </div>
                <button onClick={() => iniciarEdicao(l)} style={{ fontSize: 12, color: C.espresso, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Editar</button>
                <button onClick={() => desativar(l.id)} style={{ fontSize: 12, color: C.erro, background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Remover</button>
              </div>
            )
          ))}
        </div>
      </div>

      <div style={{ border: `0.5px solid ${C.borda}`, borderRadius: 10, padding: 16, background: C.card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, color: C.espresso, margin: 0 }}>Nova linha de negócio</h3>
        <label style={{ display: 'block' }}>
          <span style={rotulo}>
            Nome da linha
            <AjudaCampo chave="linhas_negocio.configurar.nome" rota={ROTA_AJUDA} />
          </span>
          <input
            value={novo.nome} onChange={e => setNovo(p => ({...p, nome: e.target.value}))}
            placeholder="Ex.: Linha Bovinos, Automação Industrial"
            style={campo}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={rotulo}>
            Descrição (opcional)
            <AjudaCampo chave="linhas_negocio.configurar.descricao" rota={ROTA_AJUDA} />
          </span>
          <input
            value={novo.descricao} onChange={e => setNovo(p => ({...p, descricao: e.target.value}))}
            placeholder="Descrição (opcional)"
            style={campo}
          />
        </label>
        <div>
          <div style={rotulo}>
            Cor identificadora
            <AjudaCampo chave="linhas_negocio.configurar.cor" rota={ROTA_AJUDA} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {CORES.map(cor => (
              <button key={cor} type="button" aria-label={`Cor ${cor}`} onClick={() => setNovo(p => ({...p, cor}))}
                style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${novo.cor === cor ? C.espresso : 'transparent'}`, background: cor, cursor: 'pointer', padding: 0 }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={criarLinha} disabled={salvando || !novo.nome.trim()}
          style={{ width: '100%', background: C.dourado, color: C.espresso, border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 13, fontWeight: 600, cursor: salvando || !novo.nome.trim() ? 'not-allowed' : 'pointer', opacity: salvando || !novo.nome.trim() ? 0.4 : 1 }}
        >
          {salvando ? 'Salvando...' : '+ Criar linha de negócio'}
        </button>
      </div>
    </div>
  )
}
