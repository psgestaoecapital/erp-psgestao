// src/app/(auth)/admin/psgc/revisao/page.tsx
// Tela de revisão manual de mapeamento PSGC
// Paleta PS Gestão: Espresso #3D2314, Off-white #FAF7F2, Dourado #C8941A

'use client';

import { apiFetch } from '@/lib/apiFetch';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface ContaRevisao {
  company_id: string;
  nome_fantasia: string;
  origem_codigo: string;
  origem_descricao: string;
  origem_tipo: string;
  psgc_codigo: string | null;
  psgc_nome: string | null;
  confianca: number | null;
  metodo: string | null;
  revisado: boolean;
  status_revisao: 'nao_mapeada' | 'revisar' | 'auto_alta_conf' | 'revisado';
  sugestao_auto: string | null;
}

interface PSGCConta {
  codigo: string;
  nome: string;
  natureza: string;
  dre_grupo: string;
}

export default function PSGCRevisaoPage() {
  const [data, setData] = useState<{
    resumo: any;
    contas: ContaRevisao[];
    psgc_disponiveis: PSGCConta[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<string>('all');
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  
  const searchParams = useSearchParams();
  const companyId = searchParams.get('company_id') || '';

  async function carregar() {
    if (!companyId) { setLoading(false); return; }
    const res = await apiFetch(`/api/psgc/revisao?company_id=${companyId}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [companyId]);

  async function corrigir(origem_codigo: string, psgc_codigo_correto: string) {
    setSaving(origem_codigo);
    try {
      const res = await apiFetch('/api/psgc/corrigir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, origem_codigo, psgc_codigo_correto })
      });
      if (res.ok) {
        await carregar();
      } else {
        alert('Erro ao salvar correção');
      }
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh' }}>Carregando...</div>;
  if (!data || !companyId) return <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa.</div>;

  const contasFiltradas = data.contas.filter(c => {
    if (filtroStatus !== 'all' && c.status_revisao !== filtroStatus) return false;
    if (busca && !c.origem_descricao.toLowerCase().includes(busca.toLowerCase()) 
        && !c.origem_codigo.includes(busca)) return false;
    return true;
  });

  const badgeCor = (status: string) => ({
    nao_mapeada: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Não mapeada' },
    revisar: { bg: '#FAEEDA', fg: '#854F0B', label: 'Revisar' },
    auto_alta_conf: { bg: '#EAF3DE', fg: '#527C1A', label: 'Auto' },
    revisado: { bg: '#EFEAE0', fg: '#3D2314', label: 'Revisado' }
  }[status] || { bg: '#EFEAE0', fg: '#3D2314', label: status });

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#C8941A', fontWeight: 500, textTransform: 'uppercase' }}>Admin PSGC</div>
          <h1 style={{ fontSize: 28, color: '#3D2314', margin: '4px 0 0', fontWeight: 500, letterSpacing: -0.5 }}>
            Revisão de Mapeamento
          </h1>
          <div style={{ fontSize: 13, color: '#7a6b5d', marginTop: 4 }}>
            {data.contas[0]?.nome_fantasia || ''} · Ajuste as classificações contábeis do Plano Canônico
          </div>
        </div>

        {/* Resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <Card label="Total" valor={data.resumo.total} onClick={() => setFiltroStatus('all')} active={filtroStatus === 'all'} />
          <Card label="Não mapeadas" valor={data.resumo.nao_mapeada} cor="#A32D2D" onClick={() => setFiltroStatus('nao_mapeada')} active={filtroStatus === 'nao_mapeada'} />
          <Card label="A revisar" valor={data.resumo.revisar} cor="#C8941A" onClick={() => setFiltroStatus('revisar')} active={filtroStatus === 'revisar'} />
          <Card label="Revisadas" valor={data.resumo.revisado} cor="#639922" onClick={() => setFiltroStatus('revisado')} active={filtroStatus === 'revisado'} />
        </div>

        <input
          type="text"
          placeholder="Buscar por descrição ou código..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #E8E2D4',
            fontSize: 14, marginBottom: 16, background: 'white', color: '#3D2314',
            fontFamily: 'inherit'
          }}
        />

        <div style={{ background: 'white', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 100px 180px 140px 120px',
            padding: '12px 20px',
            background: '#3D2314',
            color: 'white',
            fontSize: 11,
            letterSpacing: 1,
            textTransform: 'uppercase',
            fontWeight: 500
          }}>
            <div>Código</div>
            <div>Descrição</div>
            <div>Tipo</div>
            <div>PSGC Atual</div>
            <div>Status</div>
            <div>Ação</div>
          </div>
          {contasFiltradas.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#888780' }}>
              Nenhuma conta neste filtro.
            </div>
          )}
          {contasFiltradas.map(conta => {
            const badge = badgeCor(conta.status_revisao);
            return (
              <div key={conta.origem_codigo} style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr 100px 180px 140px 120px',
                padding: '14px 20px',
                borderBottom: '1px solid #F1EFE8',
                alignItems: 'center',
                fontSize: 13
              }}>
                <div style={{ fontFamily: 'SF Mono, Monaco, monospace', fontSize: 12, color: '#7a6b5d' }}>
                  {conta.origem_codigo}
                </div>
                <div style={{ color: '#3D2314', fontWeight: 500 }}>
                  {conta.origem_descricao}
                </div>
                <div style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase' }}>
                  {conta.origem_tipo}
                </div>
                <div>
                  <SelectPSGC 
                    valorAtual={conta.psgc_codigo}
                    sugestao={conta.sugestao_auto}
                    opcoes={data.psgc_disponiveis}
                    saving={saving === conta.origem_codigo}
                    onChange={psgc => corrigir(conta.origem_codigo, psgc)}
                  />
                </div>
                <div>
                  <span style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 20,
                    background: badge.bg, color: badge.fg, fontWeight: 500
                  }}>{badge.label}</span>
                  {conta.confianca && (
                    <div style={{ fontSize: 10, color: '#888780', marginTop: 2 }}>
                      conf. {conta.confianca}%
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#888780', textAlign: 'center' }}>
                  {conta.metodo === 'manual' && '✓ Manual'}
                  {conta.metodo === 'auto_ia' && '⚙ IA'}
                  {conta.metodo === 'auto_keyword' && '🔑 Auto'}
                  {conta.metodo === null && '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ label, valor, cor = '#3D2314', onClick, active }: { label: string; valor: number; cor?: string; onClick: () => void; active: boolean }) {
  return (
    <button onClick={onClick} style={{
      background: active ? cor : 'white',
      color: active ? 'white' : '#3D2314',
      border: `1px solid ${active ? cor : '#E8E2D4'}`,
      borderRadius: 12,
      padding: '14px 18px',
      textAlign: 'left',
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.15s'
    }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', opacity: active ? 0.9 : 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, color: active ? 'white' : cor }}>{valor}</div>
    </button>
  );
}

function SelectPSGC({ valorAtual, sugestao, opcoes, saving, onChange }: {
  valorAtual: string | null;
  sugestao: string | null;
  opcoes: PSGCConta[];
  saving: boolean;
  onChange: (psgc: string) => void;
}) {
  const v = valorAtual || sugestao || '';
  return (
    <select 
      value={v}
      onChange={e => onChange(e.target.value)}
      disabled={saving}
      style={{
        width: '100%', padding: '7px 9px', borderRadius: 7,
        border: '1px solid #E8E2D4', background: saving ? '#F1EFE8' : 'white',
        fontSize: 12, color: '#3D2314', fontFamily: 'inherit', cursor: 'pointer'
      }}
    >
      <option value="">— Selecionar —</option>
      {opcoes.map(o => (
        <option key={o.codigo} value={o.codigo}>
          {o.codigo} — {o.nome}
        </option>
      ))}
    </select>
  );
}
