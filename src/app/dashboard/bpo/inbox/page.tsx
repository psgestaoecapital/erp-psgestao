'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Paleta PS Gestao
const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoClaro: '#E8C872',
  txt: '#1A1410',
  txtMedio: '#6B5C4A',
  txtClaro: '#918C82',
  border: '#E5DDD0',
  // Status SLA
  atrasado: '#B85042',
  urgente: '#D97706',
  hoje: '#FBBF24',
  ok: '#4A7C4A',
};

type InboxItem = {
  item_id: string;
  company_id: string;
  empresa: string;
  tipo_origem: 'tarefa' | 'alerta' | 'classificacao' | 'manual' | 'cliente';
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  prioridade: 'urgente' | 'alta' | 'normal' | 'baixa';
  sla_vence_em: string | null;
  horas_ate_sla: number | null;
  status_sla: 'atrasado' | 'urgente' | 'hoje' | 'ok' | 'sem_sla';
  ia_confianca: number | null;
  ia_acao_sugerida: string | null;
  ia_contexto: string | null;
  created_at: string;
};

export default function BPOInboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [filterEmpresa, setFilterEmpresa] = useState<string>('todas');
  const [filterPrioridade, setFilterPrioridade] = useState<string>('todas');
  const [filterTipo, setFilterTipo] = useState<string>('todos');
  const [busca, setBusca] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (userId) loadInbox();
  }, [userId]);

  async function loadCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('email', user.email)
      .single();
    
    if (profile) {
      setUserId(profile.id);
      setUserName(profile.full_name);
    }
  }

  async function loadInbox() {
    if (!userId) return;
    setLoading(true);
    
    const { data, error } = await supabase.rpc('fn_inbox_operador', {
      p_user_id: userId,
    });
    
    if (!error && data) {
      setItems(data as InboxItem[]);
    }
    setLoading(false);
  }

  // Lista de empresas unicas para filtro
  const empresas = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => set.add(i.empresa));
    return Array.from(set).sort();
  }, [items]);

  // Items filtrados
  const itemsFiltered = useMemo(() => {
    return items.filter(i => {
      if (filterEmpresa !== 'todas' && i.empresa !== filterEmpresa) return false;
      if (filterPrioridade !== 'todas' && i.prioridade !== filterPrioridade) return false;
      if (filterTipo !== 'todos' && i.tipo_origem !== filterTipo) return false;
      if (busca && !i.titulo.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [items, filterEmpresa, filterPrioridade, filterTipo, busca]);

  // Estatisticas do topo
  const stats = useMemo(() => {
    const atrasados = items.filter(i => i.status_sla === 'atrasado').length;
    const urgentes = items.filter(i => i.status_sla === 'urgente' || i.prioridade === 'urgente').length;
    const hoje = items.filter(i => i.status_sla === 'hoje').length;
    return { total: items.length, atrasados, urgentes, hoje };
  }, [items]);

  async function handleAction(item: InboxItem, action: 'aprovar' | 'rejeitar' | 'escalar') {
    setActionLoading(item.item_id);
    
    const updates: any = {
      status: action === 'aprovar' || action === 'rejeitar' ? 'concluido' : 'pendente',
      resolvido_em: new Date().toISOString(),
      resolvido_por: userId,
    };
    
    if (action === 'escalar') {
      updates.prioridade = 'urgente';
      updates.operador_notas = `Escalado em ${new Date().toISOString()}`;
    }
    
    const { error } = await supabase
      .from('bpo_inbox_items')
      .update(updates)
      .eq('id', item.item_id);
    
    if (!error) {
      // Tambem atualiza tabela origem (bpo_alertas ou bpo_classificacoes)
      if (item.tipo_origem === 'alerta') {
        await supabase
          .from('bpo_alertas')
          .update({ status: action === 'aprovar' ? 'resolvido' : 'rejeitado', resolvido_em: new Date().toISOString(), resolvido_por: userId })
          .eq('id', item.item_id);
      }
      if (item.tipo_origem === 'classificacao') {
        await supabase
          .from('bpo_classificacoes')
          .update({ status: action === 'aprovar' ? 'aprovado' : 'rejeitado', operador_id: userId, operador_acao: action, aplicado_em: new Date().toISOString() })
          .eq('id', item.item_id);
      }
      
      await loadInbox();
      setSelectedItem(null);
    }
    setActionLoading(null);
  }

  const slaColor = (status: string) => {
    switch (status) {
      case 'atrasado': return C.atrasado;
      case 'urgente': return C.urgente;
      case 'hoje': return C.hoje;
      case 'ok': return C.ok;
      default: return C.txtClaro;
    }
  };

  const slaLabel = (status: string, horas: number | null) => {
    if (status === 'sem_sla') return 'Sem SLA';
    if (status === 'atrasado') return `Atrasado ${Math.abs(horas ?? 0).toFixed(0)}h`;
    if (horas === null) return '-';
    if (horas < 1) return `${Math.round(horas * 60)}min`;
    if (horas < 24) return `${horas.toFixed(0)}h`;
    return `${Math.floor(horas / 24)}d`;
  };

  const prioridadeColor = (p: string) => {
    switch (p) {
      case 'urgente': return C.atrasado;
      case 'alta': return C.urgente;
      case 'normal': return C.dourado;
      default: return C.txtClaro;
    }
  };

  const tipoIcon = (t: string) => {
    switch (t) {
      case 'alerta': return '⚠';
      case 'classificacao': return '🏷';
      case 'tarefa': return '☑';
      case 'cliente': return '✉';
      default: return '○';
    }
  };

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', fontFamily: 'Calibri, sans-serif' }}>
      {/* CABEÇALHO */}
      <div style={{ backgroundColor: C.espresso, padding: '24px 32px', color: C.offwhite }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: '11px', color: C.douradoClaro, fontWeight: 'bold', letterSpacing: '2px' }}>
              CENTRAL BPO PS GESTÃO
            </div>
            <h1 style={{ fontSize: '32px', fontFamily: 'Georgia, serif', margin: '4px 0 0 0', fontWeight: 'bold' }}>
              Inbox do Operador
            </h1>
            <div style={{ fontSize: '13px', color: C.douradoClaro, marginTop: '4px' }}>
              {userName} · {itemsFiltered.length} de {stats.total} tarefas
            </div>
          </div>
          
          {/* KPIs rapidos */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <KpiCard label="Total" valor={stats.total} cor={C.douradoClaro} />
            <KpiCard label="Atrasados" valor={stats.atrasados} cor={C.atrasado} />
            <KpiCard label="Urgentes" valor={stats.urgentes} cor={C.urgente} />
            <KpiCard label="Hoje" valor={stats.hoje} cor={C.hoje} />
          </div>
        </div>
      </div>

      {/* FILTROS */}
      <div style={{ padding: '16px 32px', backgroundColor: '#fff', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Buscar por título..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: `1px solid ${C.border}`,
            fontSize: '13px',
            minWidth: '220px',
            fontFamily: 'Calibri, sans-serif'
          }}
        />
        <select value={filterEmpresa} onChange={e => setFilterEmpresa(e.target.value)} style={selectStyle()}>
          <option value="todas">Todas empresas</option>
          {empresas.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={filterPrioridade} onChange={e => setFilterPrioridade(e.target.value)} style={selectStyle()}>
          <option value="todas">Todas prioridades</option>
          <option value="urgente">Urgente</option>
          <option value="alta">Alta</option>
          <option value="normal">Normal</option>
          <option value="baixa">Baixa</option>
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={selectStyle()}>
          <option value="todos">Todos tipos</option>
          <option value="classificacao">Classificação IA</option>
          <option value="alerta">Alerta</option>
          <option value="tarefa">Tarefa de rotina</option>
          <option value="cliente">Solicitação cliente</option>
        </select>
        <button 
          onClick={loadInbox}
          style={{
            padding: '8px 16px',
            backgroundColor: C.dourado,
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          ↻ Atualizar
        </button>
      </div>

      {/* LISTA */}
      <div style={{ padding: '16px 32px', display: 'flex', gap: '16px' }}>
        {/* Coluna lista */}
        <div style={{ flex: selectedItem ? '1 1 55%' : '1 1 100%', minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: C.txtMedio }}>
              Carregando inbox...
            </div>
          ) : itemsFiltered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: C.txtMedio, backgroundColor: 'white', borderRadius: '8px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>Inbox vazio!</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>Todas as tarefas estão concluídas.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {itemsFiltered.map(item => (
                <ItemCard
                  key={item.item_id}
                  item={item}
                  selected={selectedItem?.item_id === item.item_id}
                  onClick={() => setSelectedItem(item)}
                  slaColor={slaColor}
                  slaLabel={slaLabel}
                  prioridadeColor={prioridadeColor}
                  tipoIcon={tipoIcon}
                />
              ))}
            </div>
          )}
        </div>

        {/* Painel lateral de detalhes */}
        {selectedItem && (
          <div style={{ flex: '1 1 45%', position: 'sticky', top: '16px', alignSelf: 'flex-start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            <DetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onAction={handleAction}
              actionLoading={actionLoading === selectedItem.item_id}
              slaColor={slaColor}
              prioridadeColor={prioridadeColor}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== COMPONENTES AUXILIARES =====================

function KpiCard({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.1)',
      padding: '10px 16px',
      borderRadius: '8px',
      minWidth: '90px',
      textAlign: 'center',
      borderLeft: `3px solid ${cor}`,
    }}>
      <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily: 'Georgia, serif', color: cor }}>
        {valor}
      </div>
      <div style={{ fontSize: '10px', color: '#FAF7F2', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );
}

function ItemCard({ item, selected, onClick, slaColor, slaLabel, prioridadeColor, tipoIcon }: any) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: 'white',
        padding: '12px 16px',
        borderRadius: '8px',
        border: selected ? `2px solid ${prioridadeColor(item.prioridade)}` : '2px solid transparent',
        borderLeft: `6px solid ${prioridadeColor(item.prioridade)}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? '0 4px 12px rgba(0,0,0,0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={e => !selected && ((e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
      onMouseLeave={e => !selected && ((e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '16px' }}>{tipoIcon(item.tipo_origem)}</span>
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#918C82', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {item.empresa}
            </span>
            {item.ia_confianca !== null && (
              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: item.ia_confianca >= 80 ? '#4A7C4A' : item.ia_confianca >= 60 ? '#C8941A' : '#B85042', color: 'white', borderRadius: '4px', fontWeight: 'bold' }}>
                IA {item.ia_confianca}%
              </span>
            )}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1A1410', marginBottom: '4px' }}>
            {item.titulo}
          </div>
          {item.descricao && (
            <div style={{ fontSize: '12px', color: '#6B5C4A', lineHeight: '1.4' }}>
              {item.descricao.length > 120 ? item.descricao.substring(0, 120) + '...' : item.descricao}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 'bold',
            color: slaColor(item.status_sla),
            padding: '4px 8px',
            backgroundColor: slaColor(item.status_sla) + '15',
            borderRadius: '4px',
            whiteSpace: 'nowrap'
          }}>
            {slaLabel(item.status_sla, item.horas_ate_sla)}
          </div>
          {item.ia_acao_sugerida && (
            <div style={{ fontSize: '10px', color: '#6B5C4A', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              IA: {item.ia_acao_sugerida}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ item, onClose, onAction, actionLoading, slaColor, prioridadeColor }: any) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#918C82', textTransform: 'uppercase', letterSpacing: '2px' }}>
            {item.empresa}
          </div>
          <div style={{ fontSize: '20px', fontFamily: 'Georgia, serif', fontWeight: 'bold', color: '#1A1410', marginTop: '4px' }}>
            {item.titulo}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#918C82' }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <Badge label={item.tipo_origem.toUpperCase()} bg="#3D2314" />
        <Badge label={item.prioridade.toUpperCase()} bg={prioridadeColor(item.prioridade)} />
        <Badge label={item.status_sla.toUpperCase()} bg={slaColor(item.status_sla)} />
        {item.categoria && <Badge label={item.categoria} bg="#918C82" />}
      </div>

      {item.descricao && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B5C4A', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
            Descrição
          </div>
          <div style={{ fontSize: '13px', color: '#1A1410', lineHeight: '1.5' }}>
            {item.descricao}
          </div>
        </div>
      )}

      {item.ia_contexto && (
        <div style={{ marginBottom: '16px', padding: '12px 14px', backgroundColor: '#C8941A10', borderLeft: '3px solid #C8941A', borderRadius: '4px' }}>
          <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#C8941A', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
            🤖 Análise da IA {item.ia_confianca !== null && `· Confiança ${item.ia_confianca}%`}
          </div>
          <div style={{ fontSize: '13px', color: '#1A1410', lineHeight: '1.5' }}>
            {item.ia_contexto}
          </div>
          {item.ia_acao_sugerida && (
            <div style={{ fontSize: '12px', color: '#3D2314', marginTop: '8px', fontWeight: 'bold' }}>
              → Ação sugerida: <span style={{ color: '#C8941A' }}>{item.ia_acao_sugerida}</span>
            </div>
          )}
        </div>
      )}

      {/* AÇÕES */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #E5DDD0' }}>
        <button
          disabled={actionLoading}
          onClick={() => onAction(item, 'aprovar')}
          style={actionButton('#4A7C4A', 'white')}
        >
          {actionLoading ? '...' : '✓ Aprovar'}
        </button>
        <button
          disabled={actionLoading}
          onClick={() => onAction(item, 'rejeitar')}
          style={actionButton('#B85042', 'white')}
        >
          ✕ Rejeitar
        </button>
        <button
          disabled={actionLoading}
          onClick={() => onAction(item, 'escalar')}
          style={actionButton('#D97706', 'white')}
        >
          ↑ Escalar
        </button>
      </div>
    </div>
  );
}

function Badge({ label, bg }: { label: string; bg: string }) {
  return (
    <span style={{
      fontSize: '10px',
      padding: '3px 8px',
      backgroundColor: bg,
      color: 'white',
      borderRadius: '4px',
      fontWeight: 'bold',
      letterSpacing: '1px'
    }}>
      {label}
    </span>
  );
}

function actionButton(bg: string, color: string) {
  return {
    flex: 1,
    padding: '10px',
    backgroundColor: bg,
    color,
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    opacity: 1,
  };
}

function selectStyle() {
  return {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #E5DDD0',
    fontSize: '13px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontFamily: 'Calibri, sans-serif',
  };
}
