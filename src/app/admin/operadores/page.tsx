'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoClaro: '#E8C872',
  txt: '#1A1410',
  txtMedio: '#6B5C4A',
  txtClaro: '#918C82',
  border: '#E5DDD0',
  verde: '#4A7C4A',
  vermelho: '#B85042',
}

type Operador = { id: string; full_name: string; email: string; role: string }
type Empresa = { id: string; nome: string; group_id: string | null }
type Grupo = { id: string; nome: string }
type Atribuicao = {
  id: string
  user_id: string
  scope: 'empresa' | 'grupo' | 'todas'
  company_id: string | null
  group_id: string | null
  ativo: boolean
  observacao: string | null
  nome_empresa?: string
  nome_grupo?: string
}

export default function AdminOperadoresPage() {
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [atribuicoes, setAtribuicoes] = useState<Atribuicao[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOperador, setSelectedOperador] = useState<Operador | null>(null)

  const [novoScope, setNovoScope] = useState<'empresa' | 'grupo' | 'todas'>('empresa')
  const [novoCompanyId, setNovoCompanyId] = useState<string>('')
  const [novoGroupId, setNovoGroupId] = useState<string>('')
  const [novoObs, setNovoObs] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)

    const [ops, emps, grps, atrs] = await Promise.all([
      supabase.from('users').select('id, full_name, email, role').eq('is_active', true).order('full_name'),
      supabase.from('companies').select('id, nome_fantasia, razao_social, group_id').order('nome_fantasia'),
      supabase.from('company_groups').select('id, nome').order('nome'),
      supabase.from('operator_clients').select('*').eq('ativo', true),
    ])

    setOperadores(ops.data || [])
    const empsData = emps.data || []
    setEmpresas(empsData.map(e => ({
      id: e.id,
      nome: e.nome_fantasia || e.razao_social,
      group_id: e.group_id,
    })))
    setGrupos(grps.data || [])

    const enriched = (atrs.data || []).map(a => ({
      ...a,
      nome_empresa: empsData.find(e => e.id === a.company_id)?.nome_fantasia || empsData.find(e => e.id === a.company_id)?.razao_social,
      nome_grupo: grps.data?.find(g => g.id === a.group_id)?.nome,
    }))
    setAtribuicoes(enriched)

    setLoading(false)
  }

  async function handleAdd() {
    if (!selectedOperador) return

    setSaving(true)
    const payload: Record<string, unknown> = {
      user_id: selectedOperador.id,
      scope: novoScope,
      observacao: novoObs || null,
      ativo: true,
    }
    if (novoScope === 'empresa') payload.company_id = novoCompanyId
    if (novoScope === 'grupo') payload.group_id = novoGroupId

    const { error } = await supabase.from('operator_clients').insert(payload)

    if (error) {
      alert('Erro: ' + error.message)
    } else {
      setNovoCompanyId('')
      setNovoGroupId('')
      setNovoObs('')
      await loadAll()
    }
    setSaving(false)
  }

  async function handleRemove(atrId: string) {
    if (!confirm('Remover essa atribuicao?')) return
    await supabase.from('operator_clients').update({ ativo: false }).eq('id', atrId)
    await loadAll()
  }

  const atribuicoesDoOperador = selectedOperador
    ? atribuicoes.filter(a => a.user_id === selectedOperador.id)
    : []

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.txtMedio }}>Carregando...</div>
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: 'calc(100vh - 64px)', margin: -24 }}>
      <div style={{ backgroundColor: C.espresso, padding: '24px 32px', color: C.offwhite }}>
        <div style={{ fontSize: 11, color: C.douradoClaro, fontWeight: 'bold', letterSpacing: 2 }}>
          ADMIN - CENTRAL BPO
        </div>
        <h1 style={{ fontSize: 32, fontFamily: 'Georgia, serif', margin: '4px 0 0 0', fontWeight: 'bold' }}>
          Operadores e Atribuicoes
        </h1>
        <div style={{ fontSize: 13, color: C.douradoClaro, marginTop: 4 }}>
          {operadores.length} operadores - {atribuicoes.length} atribuicoes ativas
        </div>
      </div>

      <div style={{ padding: '24px 32px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 340px' }}>
          <div style={{ fontSize: 12, fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
            Operadores
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {operadores.map(op => {
              const count = atribuicoes.filter(a => a.user_id === op.id).length
              const hasTodas = atribuicoes.some(a => a.user_id === op.id && a.scope === 'todas')
              return (
                <div
                  key={op.id}
                  onClick={() => setSelectedOperador(op)}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'white',
                    borderRadius: 8,
                    cursor: 'pointer',
                    borderLeft: selectedOperador?.id === op.id ? `4px solid ${C.dourado}` : '4px solid transparent',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: C.txt }}>
                    {op.full_name}
                  </div>
                  <div style={{ fontSize: 11, color: C.txtClaro, marginTop: 2 }}>
                    {op.email} - {op.role}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {hasTodas ? (
                      <span style={{ fontSize: 10, padding: '2px 8px', backgroundColor: C.dourado, color: 'white', borderRadius: 4, fontWeight: 'bold' }}>
                        TODAS EMPRESAS
                      </span>
                    ) : count > 0 ? (
                      <span style={{ fontSize: 10, padding: '2px 8px', backgroundColor: C.verde, color: 'white', borderRadius: 4, fontWeight: 'bold' }}>
                        {count} atribuicoes
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, padding: '2px 8px', backgroundColor: C.txtClaro, color: 'white', borderRadius: 4 }}>
                        sem atribuicao
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          {!selectedOperador ? (
            <div style={{ padding: '80px 24px', textAlign: 'center', color: C.txtMedio, backgroundColor: 'white', borderRadius: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 'bold' }}>Selecione um operador</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>para gerenciar atribuicoes de empresas</div>
            </div>
          ) : (
            <>
              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 22, fontFamily: 'Georgia, serif', fontWeight: 'bold', color: C.txt }}>
                  {selectedOperador.full_name}
                </div>
                <div style={{ fontSize: 13, color: C.txtMedio, marginTop: 4 }}>
                  {selectedOperador.email} - Role: <strong>{selectedOperador.role}</strong>
                </div>
              </div>

              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
                  Atribuicoes atuais ({atribuicoesDoOperador.length})
                </div>
                {atribuicoesDoOperador.length === 0 ? (
                  <div style={{ color: C.txtClaro, fontSize: 13, fontStyle: 'italic' }}>
                    Sem atribuicoes. Use o formulario abaixo para adicionar.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {atribuicoesDoOperador.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: C.offwhite, borderRadius: 6 }}>
                        <div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, padding: '2px 8px', backgroundColor: a.scope === 'todas' ? C.dourado : a.scope === 'grupo' ? '#4A6B7A' : C.verde, color: 'white', borderRadius: 4, fontWeight: 'bold', letterSpacing: 1 }}>
                              {a.scope.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 13, color: C.txt, fontWeight: 'bold' }}>
                              {a.scope === 'todas' ? 'Todas as empresas' :
                               a.scope === 'grupo' ? `Grupo: ${a.nome_grupo}` :
                               `Empresa: ${a.nome_empresa}`}
                            </span>
                          </div>
                          {a.observacao && (
                            <div style={{ fontSize: 11, color: C.txtMedio, marginTop: 4 }}>{a.observacao}</div>
                          )}
                        </div>
                        <button onClick={() => handleRemove(a.id)} style={{ background: 'none', border: 'none', color: C.vermelho, cursor: 'pointer', fontSize: 18 }}>
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
                  Nova atribuicao
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: 6 }}>
                    Tipo de escopo
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['empresa', 'grupo', 'todas'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setNovoScope(s)}
                        style={{
                          padding: '10px 16px',
                          border: novoScope === s ? `2px solid ${C.dourado}` : `1px solid ${C.border}`,
                          backgroundColor: novoScope === s ? C.dourado + '15' : 'white',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontWeight: novoScope === s ? 'bold' : 'normal',
                          fontSize: 13,
                          color: novoScope === s ? C.espresso : C.txtMedio,
                          flex: 1,
                          minWidth: 130,
                        }}
                      >
                        {s === 'empresa' ? 'Empresa especifica' : s === 'grupo' ? 'Grupo inteiro' : 'Todas empresas'}
                      </button>
                    ))}
                  </div>
                </div>

                {novoScope === 'empresa' && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: 6 }}>Empresa</label>
                    <select value={novoCompanyId} onChange={e => setNovoCompanyId(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13 }}>
                      <option value="">Selecione...</option>
                      {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </div>
                )}

                {novoScope === 'grupo' && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: 6 }}>Grupo</label>
                    <select value={novoGroupId} onChange={e => setNovoGroupId(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13 }}>
                      <option value="">Selecione...</option>
                      {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                    </select>
                  </div>
                )}

                {novoScope === 'todas' && (
                  <div style={{ padding: 12, backgroundColor: C.dourado + '15', borderLeft: `3px solid ${C.dourado}`, borderRadius: 4, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: C.espresso, fontWeight: 'bold' }}>
                      Acesso total: operador vera todas as empresas do sistema.
                    </div>
                    <div style={{ fontSize: 11, color: C.txtMedio, marginTop: 4 }}>
                      Use apenas para supervisores e administradores.
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: 6 }}>Observacao (opcional)</label>
                  <input
                    type="text"
                    value={novoObs}
                    onChange={e => setNovoObs(e.target.value)}
                    placeholder="Ex: responsavel por conciliacao do grupo"
                    style={{ width: '100%', padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13 }}
                  />
                </div>

                <button
                  onClick={handleAdd}
                  disabled={saving || (novoScope === 'empresa' && !novoCompanyId) || (novoScope === 'grupo' && !novoGroupId)}
                  style={{
                    width: '100%',
                    padding: 12,
                    backgroundColor: C.dourado,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 'bold',
                    fontSize: 14,
                    cursor: 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Salvando...' : '+ Adicionar atribuicao'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
