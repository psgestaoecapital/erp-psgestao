'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
};

type Operador = { id: string; full_name: string; email: string; role: string };
type Empresa = { id: string; nome: string; group_id: string | null };
type Grupo = { id: string; nome: string };
type Atribuicao = {
  id: string;
  user_id: string;
  scope: 'empresa' | 'grupo' | 'todas';
  company_id: string | null;
  group_id: string | null;
  ativo: boolean;
  observacao: string | null;
  nome_empresa?: string;
  nome_grupo?: string;
};

export default function AdminOperadoresPage() {
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [atribuicoes, setAtribuicoes] = useState<Atribuicao[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOperador, setSelectedOperador] = useState<Operador | null>(null);
  
  // Form state
  const [novoScope, setNovoScope] = useState<'empresa' | 'grupo' | 'todas'>('empresa');
  const [novoCompanyId, setNovoCompanyId] = useState<string>('');
  const [novoGroupId, setNovoGroupId] = useState<string>('');
  const [novoObs, setNovoObs] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    
    const [ops, emps, grps, atrs] = await Promise.all([
      supabase.from('users').select('id, full_name, email, role').eq('is_active', true).order('full_name'),
      supabase.from('companies').select('id, nome_fantasia, razao_social, group_id').order('nome_fantasia'),
      supabase.from('company_groups').select('id, nome').order('nome'),
      supabase.from('operator_clients').select('*').eq('ativo', true),
    ]);
    
    setOperadores(ops.data || []);
    setEmpresas((emps.data || []).map(e => ({
      id: e.id,
      nome: e.nome_fantasia || e.razao_social,
      group_id: e.group_id,
    })));
    setGrupos(grps.data || []);
    
    // Enriquecer atribuicoes com nomes
    const enriched = (atrs.data || []).map(a => ({
      ...a,
      nome_empresa: emps.data?.find(e => e.id === a.company_id)?.nome_fantasia || emps.data?.find(e => e.id === a.company_id)?.razao_social,
      nome_grupo: grps.data?.find(g => g.id === a.group_id)?.nome,
    }));
    setAtribuicoes(enriched);
    
    setLoading(false);
  }

  async function handleAdd() {
    if (!selectedOperador) return;
    
    setSaving(true);
    const payload: any = {
      user_id: selectedOperador.id,
      scope: novoScope,
      observacao: novoObs || null,
      ativo: true,
    };
    if (novoScope === 'empresa') payload.company_id = novoCompanyId;
    if (novoScope === 'grupo') payload.group_id = novoGroupId;
    
    const { error } = await supabase.from('operator_clients').insert(payload);
    
    if (error) {
      alert('Erro: ' + error.message);
    } else {
      setNovoCompanyId('');
      setNovoGroupId('');
      setNovoObs('');
      await loadAll();
    }
    setSaving(false);
  }

  async function handleRemove(atrId: string) {
    if (!confirm('Remover essa atribuição?')) return;
    await supabase.from('operator_clients').update({ ativo: false }).eq('id', atrId);
    await loadAll();
  }

  const atribuicoesDoOperador = selectedOperador
    ? atribuicoes.filter(a => a.user_id === selectedOperador.id)
    : [];

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', fontFamily: 'Calibri, sans-serif' }}>
      {/* CABECALHO */}
      <div style={{ backgroundColor: C.espresso, padding: '24px 32px', color: C.offwhite }}>
        <div style={{ fontSize: '11px', color: C.douradoClaro, fontWeight: 'bold', letterSpacing: '2px' }}>
          ADMIN · CENTRAL BPO
        </div>
        <h1 style={{ fontSize: '32px', fontFamily: 'Georgia, serif', margin: '4px 0 0 0', fontWeight: 'bold' }}>
          Operadores & Atribuições
        </h1>
        <div style={{ fontSize: '13px', color: C.douradoClaro, marginTop: '4px' }}>
          {operadores.length} operadores · {atribuicoes.length} atribuições ativas
        </div>
      </div>

      <div style={{ padding: '24px 32px', display: 'flex', gap: '20px' }}>
        {/* Lista de operadores */}
        <div style={{ flex: '0 0 340px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
            Operadores
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {operadores.map(op => {
              const count = atribuicoes.filter(a => a.user_id === op.id).length;
              const hasTodas = atribuicoes.some(a => a.user_id === op.id && a.scope === 'todas');
              return (
                <div
                  key={op.id}
                  onClick={() => setSelectedOperador(op)}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    borderLeft: selectedOperador?.id === op.id ? `4px solid ${C.dourado}` : '4px solid transparent',
                    transition: 'all 0.1s',
                    boxShadow: selectedOperador?.id === op.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.txt }}>
                    {op.full_name}
                  </div>
                  <div style={{ fontSize: '11px', color: C.txtClaro, marginTop: '2px' }}>
                    {op.email} · {op.role}
                  </div>
                  <div style={{ marginTop: '6px' }}>
                    {hasTodas ? (
                      <span style={{ fontSize: '10px', padding: '2px 8px', backgroundColor: C.dourado, color: 'white', borderRadius: '4px', fontWeight: 'bold' }}>
                        TODAS EMPRESAS
                      </span>
                    ) : count > 0 ? (
                      <span style={{ fontSize: '10px', padding: '2px 8px', backgroundColor: C.verde, color: 'white', borderRadius: '4px', fontWeight: 'bold' }}>
                        {count} atribuições
                      </span>
                    ) : (
                      <span style={{ fontSize: '10px', padding: '2px 8px', backgroundColor: C.txtClaro, color: 'white', borderRadius: '4px' }}>
                        sem atribuição
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Painel do operador selecionado */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedOperador ? (
            <div style={{ padding: '80px 24px', textAlign: 'center', color: C.txtMedio, backgroundColor: 'white', borderRadius: '12px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>👈</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>Selecione um operador</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>para gerenciar suas atribuições de empresas</div>
            </div>
          ) : (
            <>
              {/* Header operador */}
              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '22px', fontFamily: 'Georgia, serif', fontWeight: 'bold', color: C.txt }}>
                  {selectedOperador.full_name}
                </div>
                <div style={{ fontSize: '13px', color: C.txtMedio, marginTop: '4px' }}>
                  {selectedOperador.email} · Role: <strong>{selectedOperador.role}</strong>
                </div>
              </div>

              {/* Atribuicoes atuais */}
              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
                  Atribuições atuais ({atribuicoesDoOperador.length})
                </div>
                {atribuicoesDoOperador.length === 0 ? (
                  <div style={{ color: C.txtClaro, fontSize: '13px', fontStyle: 'italic' }}>
                    Sem atribuições. Use o formulário abaixo para adicionar.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {atribuicoesDoOperador.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: C.offwhite, borderRadius: '6px' }}>
                        <div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '10px', padding: '2px 8px', backgroundColor: a.scope === 'todas' ? C.dourado : a.scope === 'grupo' ? '#4A6B7A' : C.verde, color: 'white', borderRadius: '4px', fontWeight: 'bold', letterSpacing: '1px' }}>
                              {a.scope.toUpperCase()}
                            </span>
                            <span style={{ fontSize: '13px', color: C.txt, fontWeight: 'bold' }}>
                              {a.scope === 'todas' ? 'Todas as empresas' :
                               a.scope === 'grupo' ? `Grupo: ${a.nome_grupo}` :
                               `Empresa: ${a.nome_empresa}`}
                            </span>
                          </div>
                          {a.observacao && (
                            <div style={{ fontSize: '11px', color: C.txtMedio, marginTop: '4px' }}>
                              {a.observacao}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemove(a.id)}
                          style={{ background: 'none', border: 'none', color: C.vermelho, cursor: 'pointer', fontSize: '18px' }}
                          title="Remover"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Adicionar nova atribuicao */}
              <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
                  Nova atribuição
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: '6px' }}>
                    Tipo de escopo
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['empresa', 'grupo', 'todas'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setNovoScope(s)}
                        style={{
                          padding: '10px 16px',
                          border: novoScope === s ? `2px solid ${C.dourado}` : `1px solid ${C.border}`,
                          backgroundColor: novoScope === s ? C.dourado + '15' : 'white',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: novoScope === s ? 'bold' : 'normal',
                          fontSize: '13px',
                          textTransform: 'capitalize',
                          color: novoScope === s ? C.espresso : C.txtMedio,
                          flex: 1
                        }}
                      >
                        {s === 'empresa' ? '🏢 Empresa específica' : s === 'grupo' ? '🏛 Grupo inteiro' : '🌐 Todas empresas'}
                      </button>
                    ))}
                  </div>
                </div>

                {novoScope === 'empresa' && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: '6px' }}>
                      Empresa
                    </label>
                    <select value={novoCompanyId} onChange={e => setNovoCompanyId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: `1px solid ${C.border}`, fontSize: '13px' }}>
                      <option value="">Selecione...</option>
                      {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </div>
                )}

                {novoScope === 'grupo' && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: '6px' }}>
                      Grupo
                    </label>
                    <select value={novoGroupId} onChange={e => setNovoGroupId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: `1px solid ${C.border}`, fontSize: '13px' }}>
                      <option value="">Selecione...</option>
                      {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                    </select>
                  </div>
                )}

                {novoScope === 'todas' && (
                  <div style={{ padding: '12px', backgroundColor: C.dourado + '15', borderLeft: `3px solid ${C.dourado}`, borderRadius: '4px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', color: C.espresso, fontWeight: 'bold' }}>
                      ⚠ Acesso total: operador verá todas as empresas do sistema.
                    </div>
                    <div style={{ fontSize: '11px', color: C.txtMedio, marginTop: '4px' }}>
                      Use apenas para supervisores e administradores.
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: C.txt, display: 'block', marginBottom: '6px' }}>
                    Observação (opcional)
                  </label>
                  <input
                    type="text"
                    value={novoObs}
                    onChange={e => setNovoObs(e.target.value)}
                    placeholder="Ex: responsável por conciliação do grupo"
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: `1px solid ${C.border}`, fontSize: '13px' }}
                  />
                </div>

                <button
                  onClick={handleAdd}
                  disabled={saving || (novoScope === 'empresa' && !novoCompanyId) || (novoScope === 'grupo' && !novoGroupId)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: C.dourado,
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    cursor: 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Salvando...' : '+ Adicionar atribuição'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
