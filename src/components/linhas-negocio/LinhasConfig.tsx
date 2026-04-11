'use client'
import React, { useState } from 'react'
import { useLinhasNegocio } from '@/hooks/useLinhasNegocio'
import { supabase } from '@/lib/supabase'
import type { LinhaNegocio } from '@/types/linhas-negocio'

const CORES = ['#C8941A','#1A7A4A','#1A3A7A','#7A1A3A','#3A1A7A','#7A3A1A','#1A7A7A','#7A1A1A']

interface Props { empresaId: string }

export default function LinhasConfig({ empresaId }: Props) {
  const { linhas, loading, refetch } = useLinhasNegocio(empresaId)
  const [novo, setNovo] = useState({ nome: '', descricao: '', cor: '#C8941A' })
  const [salvando, setSalvando] = useState(false)

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

  if (loading) return <div className="text-sm text-muted-foreground p-4">Carregando linhas...</div>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Linhas cadastradas</h3>
        <div className="space-y-2">
          {linhas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma linha cadastrada. Crie a primeira abaixo.</p>
          )}
          {linhas.map((l: LinhaNegocio) => (
            <div key={l.id} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: l.cor }}/>
              <div className="flex-1">
                <p className="text-sm font-medium">{l.nome}</p>
                {l.descricao && <p className="text-xs text-muted-foreground">{l.descricao}</p>}
              </div>
              <button onClick={() => desativar(l.id)} className="text-xs text-destructive hover:underline">Remover</button>
            </div>
          ))}
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-card space-y-3">
        <h3 className="text-sm font-medium">Nova linha de negócio</h3>
        <input
          value={novo.nome} onChange={e => setNovo(p => ({...p, nome: e.target.value}))}
          placeholder="Nome da linha (ex: Linha Bovinos, Automação Industrial)"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        />
        <input
          value={novo.descricao} onChange={e => setNovo(p => ({...p, descricao: e.target.value}))}
          placeholder="Descrição (opcional)"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        />
        <div>
          <p className="text-xs text-muted-foreground mb-2">Cor identificadora</p>
          <div className="flex gap-2">
            {CORES.map(cor => (
              <button key={cor} onClick={() => setNovo(p => ({...p, cor}))}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ background: cor, borderColor: novo.cor === cor ? '#fff' : 'transparent' }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={criarLinha} disabled={salvando || !novo.nome.trim()}
          className="w-full bg-primary text-primary-foreground rounded py-2 text-sm font-medium disabled:opacity-40"
        >
          {salvando ? 'Salvando...' : '+ Criar linha de negócio'}
        </button>
      </div>
    </div>
  )
}
