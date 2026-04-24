// src/app/(auth)/dashboard/page.tsx
// Dashboard Universal — serve Comércio, Industrial, Agro, BPO, P&M
// Rota inteligente: detecta plano via contexto (cookie/localStorage/query) 

'use client';

import { apiFetch } from '@/lib/apiFetch';

import { useEffect, useState, useCallback , Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface Empresa { id: string; nome_fantasia: string; cnpj?: string; }
interface Grupo { 
  id: string; nome: string; icone: string; cor: string; is_padrao: boolean;
  dashboard_grupos_empresas: { company_id: string; companies: Empresa }[];
}
interface Atalho { id?: string; nome: string; url: string; icone: string; cor: string; ordem: number; }
interface DashboardData {
  contexto: any;
  camada1: {
    saude: { status: string; titulo: string; frase: string; indicadores: any };
    acoes: any[];
    futuro: { fluxo: any[]; saldo_projetado_60d: number };
  };
  camada2: {
    dre_nivel2: any[];
    top_clientes: any[];
    top_fornecedores: any[];
  };
  atalhos: Atalho[];
}

const PLANOS = [
  { id: 'comercio', label: 'Comércio & Serviços' },
  { id: 'industrial', label: 'Industrial' },
  { id: 'agro', label: 'Agro' },
  { id: 'bpo', label: 'BPO Financeiro' },
  { id: 'producao_marketing', label: 'Produção & Marketing' }
];

const PERIODOS = [
  { id: 'hoje', label: 'Hoje' }, { id: 'sem', label: 'Sem' },
  { id: 'mes', label: 'Mês' }, { id: 'tri', label: 'Tri' },
  { id: '6m', label: '6M' }, { id: 'ano', label: 'Ano' }
];

function DashboardUniversalInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Plano vem do contexto. Prioridade: query > localStorage > cookie > default
  const [plano, setPlano] = useState<string>('comercio');
  
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [empresasDisp, setEmpresasDisp] = useState<Empresa[]>([]);
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<string>('mes');
  
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGerenciarAtalhos, setShowGerenciarAtalhos] = useState(false);
  const [showGerenciarGrupos, setShowGerenciarGrupos] = useState(false);
  
  // Detecta plano no mount
  useEffect(() => {
    const queryPlano = searchParams.get('plano');
    const storedPlano = typeof window !== 'undefined' ? localStorage.getItem('psgc_plano_atual') : null;
    const plano = queryPlano || storedPlano || 'comercio';
    setPlano(plano);
    if (typeof window !== 'undefined') localStorage.setItem('psgc_plano_atual', plano);
  }, [searchParams]);
  
  // Carrega grupos 1x
  useEffect(() => {
    (async () => {
      const r = await apiFetch('/api/dashboard/grupos');
      const d = await r.json();
      setGrupos(d.grupos || []);
      setEmpresasDisp(d.empresas_disponiveis || []);
      // Seleciona grupo padrão
      const padrao = (d.grupos || []).find((g: Grupo) => g.is_padrao);
      if (padrao) setGrupoSel(padrao.id);
      else if (d.empresas_disponiveis?.length > 0) setEmpresasSel([d.empresas_disponiveis[0].id]);
    })();
  }, []);
  
  // Carrega dashboard sempre que muda seleção
  const carregar = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ plano, periodo });
    if (grupoSel) params.set('grupo_id', grupoSel);
    else if (empresasSel.length === 1) params.set('company_id', empresasSel[0]);
    else if (empresasSel.length > 1) params.set('company_ids', empresasSel.join(','));
    
    try {
      const r = await apiFetch(`/api/dashboard/universal?${params}`);
      const d = await r.json();
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [plano, periodo, grupoSel, empresasSel]);
  
  useEffect(() => { 
    if (grupoSel || empresasSel.length > 0) carregar();
  }, [plano, periodo, grupoSel, empresasSel, carregar]);
  
  const planoLabel = PLANOS.find(p => p.id === plano)?.label || plano;
  
  if (loading && !data) {
    return <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ color: '#3D2314' }}>Carregando Dashboard...</div>
    </div>;
  }
  
  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* ============ HEADER UNIVERSAL ============ */}
      <div style={{ background: 'white', borderBottom: '1px solid #E8E2D4', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#C8941A', fontWeight: 500, textTransform: 'uppercase' }}>{planoLabel}</div>
            <div style={{ fontSize: 18, color: '#3D2314', fontWeight: 500, letterSpacing: -0.3 }}>Dashboard</div>
          </div>
          
          <div style={{ flex: 1, minWidth: 250 }}>
            <SeletorGrupo 
              grupos={grupos}
              empresasDisp={empresasDisp}
              grupoSel={grupoSel}
              empresasSel={empresasSel}
              onSelecionaGrupo={(id: string) => { setGrupoSel(id); setEmpresasSel([]); }}
              onSelecionaEmpresas={(ids: string[]) => { setEmpresasSel(ids); setGrupoSel(null); }}
              onGerenciar={() => setShowGerenciarGrupos(true)}
            />
          </div>
          
          <SeletorPeriodo periodo={periodo} onChange={setPeriodo} />
        </div>
        
        {/* Atalhos editáveis */}
        <div style={{ maxWidth: 1400, margin: '12px auto 0', display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {(data?.atalhos || []).map(a => (
            <a key={a.nome} href={a.url} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
              background: '#FAF7F2', color: '#3D2314', textDecoration: 'none',
              fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', border: '1px solid #E8E2D4'
            }}>
              <span>{a.icone}</span><span>{a.nome}</span>
            </a>
          ))}
          <button onClick={() => setShowGerenciarAtalhos(true)} style={{
            padding: '7px 12px', borderRadius: 8, background: 'transparent', border: '1px dashed #C8941A',
            color: '#C8941A', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap'
          }}>+ Editar atalhos</button>
        </div>
      </div>
      
      {/* ============ CORPO ============ */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px 60px' }}>
        
        {data?.contexto && (
          <div style={{ fontSize: 13, color: '#7a6b5d', marginBottom: 20 }}>
            {data.contexto.nome} · {data.contexto.qtd_empresas} {data.contexto.qtd_empresas === 1 ? 'empresa' : 'empresas'}
            {data.contexto.qtd_empresas > 1 && <span style={{ marginLeft: 8, padding: '2px 8px', background: '#FAEEDA', color: '#854F0B', borderRadius: 10, fontSize: 11 }}>📊 Consolidado</span>}
          </div>
        )}
        
        {data && (
          <>
            <CamadaUm data={data.camada1} qtdEmpresas={data.contexto?.qtd_empresas || 1} />
            
            <div style={{ margin: '48px 0 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: '#C8941A', fontWeight: 500, textTransform: 'uppercase' }}>Raio-X</div>
              <div style={{ flex: 1, height: 1, background: '#E8E2D4' }} />
              <a href="/dashboard/analises" style={{ fontSize: 12, color: '#3D2314', textDecoration: 'none', padding: '6px 12px', border: '1px solid #3D2314', borderRadius: 6 }}>
                Ver análises completas →
              </a>
            </div>
            
            <CamadaDois data={data.camada2} />
          </>
        )}
      </div>
      
      {showGerenciarGrupos && <ModalGerenciarGrupos onClose={() => { setShowGerenciarGrupos(false); carregar(); }} empresas={empresasDisp} grupos={grupos} />}
      {showGerenciarAtalhos && <ModalGerenciarAtalhos onClose={() => { setShowGerenciarAtalhos(false); carregar(); }} plano={plano} atuais={data?.atalhos || []} />}
    </div>
  );
}

// ============ SELETOR DE GRUPO ============
function SeletorGrupo({ grupos, empresasDisp, grupoSel, empresasSel, onSelecionaGrupo, onSelecionaEmpresas, onGerenciar }: any) {
  const [open, setOpen] = useState(false);
  const nomeAtual = 
    grupoSel ? (grupos.find((g: Grupo) => g.id === grupoSel)?.nome || '') :
    empresasSel.length === 1 ? (empresasDisp.find((e: Empresa) => e.id === empresasSel[0])?.nome_fantasia || '') :
    empresasSel.length > 1 ? `${empresasSel.length} empresas selecionadas` :
    'Selecione...';
  
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '8px 14px', borderRadius: 8, border: '1px solid #E8E2D4',
        background: 'white', textAlign: 'left', fontSize: 13, color: '#3D2314',
        fontFamily: 'inherit', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span>{nomeAtual}</span>
        <span style={{ color: '#888780' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'white', border: '1px solid #E8E2D4', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(61,35,20,0.12)', zIndex: 100, maxHeight: 420, overflowY: 'auto'
        }}>
          {grupos.length > 0 && (
            <div style={{ padding: '8px 12px 4px' }}>
              <div style={{ fontSize: 10, color: '#888780', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 500, marginBottom: 4 }}>Grupos</div>
              {grupos.map((g: Grupo) => (
                <button key={g.id} onClick={() => { onSelecionaGrupo(g.id); setOpen(false); }} style={{
                  width: '100%', padding: '8px 10px', textAlign: 'left', background: grupoSel === g.id ? '#FAEEDA' : 'transparent',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#3D2314', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span>{g.icone}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{g.nome}</div>
                    <div style={{ fontSize: 11, color: '#888780' }}>{g.dashboard_grupos_empresas?.length || 0} empresas</div>
                  </div>
                  {g.is_padrao && <span style={{ fontSize: 10, color: '#C8941A' }}>★ padrão</span>}
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: '8px 12px 4px', borderTop: grupos.length > 0 ? '1px solid #F1EFE8' : 'none' }}>
            <div style={{ fontSize: 10, color: '#888780', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 500, marginBottom: 4 }}>Empresas individuais</div>
            {empresasDisp.map((e: Empresa) => {
              const sel = empresasSel.includes(e.id);
              return (
                <button key={e.id} onClick={() => {
                  onSelecionaEmpresas(sel ? empresasSel.filter((x: string) => x !== e.id) : [...empresasSel, e.id]);
                }} style={{
                  width: '100%', padding: '7px 10px', textAlign: 'left', background: sel ? '#FAEEDA' : 'transparent',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#3D2314', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span style={{ width: 14, height: 14, border: '1px solid #C8941A', borderRadius: 3, background: sel ? '#C8941A' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10 }}>
                    {sel ? '✓' : ''}
                  </span>
                  <span>{e.nome_fantasia}</span>
                </button>
              );
            })}
          </div>
          <button onClick={() => { setOpen(false); onGerenciar(); }} style={{
            width: '100%', padding: '10px 12px', background: '#FAF7F2', border: 'none', borderTop: '1px solid #F1EFE8',
            fontSize: 12, color: '#C8941A', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            borderBottomLeftRadius: 10, borderBottomRightRadius: 10
          }}>
            ⚙ Gerenciar Grupos
          </button>
        </div>
      )}
    </div>
  );
}

function SeletorPeriodo({ periodo, onChange }: { periodo: string; onChange: (p: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: '#FAF7F2', padding: 3, borderRadius: 8 }}>
      {PERIODOS.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)} style={{
          padding: '6px 12px', background: periodo === p.id ? '#3D2314' : 'transparent',
          color: periodo === p.id ? 'white' : '#3D2314', border: 'none', borderRadius: 6,
          fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit'
        }}>{p.label}</button>
      ))}
    </div>
  );
}

// ============ CAMADA 1 ============
function CamadaUm({ data, qtdEmpresas }: { data: any; qtdEmpresas: number }) {
  const cores = {
    saudavel: { border: '#639922', bg: '#EAF3DE', dot: '#639922' },
    atencao: { border: '#C8941A', bg: '#FAEEDA', dot: '#C8941A' },
    critico: { border: '#A32D2D', bg: '#FCEBEB', dot: '#A32D2D' },
    desconhecido: { border: '#888780', bg: '#F1EFE8', dot: '#888780' }
  }[data.saude.status as string] || { border: '#888780', bg: '#F1EFE8', dot: '#888780' };
  
  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  const fmtPct = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
  
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      
      {/* Card 1 — Saúde */}
      <div style={{ background: 'white', borderRadius: 14, padding: '24px 28px', borderLeft: `4px solid ${cores.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: cores.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: cores.dot }} />
          </div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#888780', fontWeight: 500, textTransform: 'uppercase' }}>Saúde</div>
        </div>
        <div style={{ fontSize: 28, color: '#3D2314', fontWeight: 500, letterSpacing: -0.5, marginBottom: 8, lineHeight: 1.25 }}>
          {data.saude.titulo}
        </div>
        <div style={{ fontSize: 15, color: '#5F5E5A', lineHeight: 1.6, marginBottom: 20 }}>{data.saude.frase}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <IndCard label="Margem Contrib." valor={`${fmtPct(data.saude.indicadores.margem_contribuicao_pct || 0)}%`} />
          <IndCard label="EBITDA %" valor={`${fmtPct(data.saude.indicadores.ebitda_pct || 0)}%`} 
                   cor={data.saude.indicadores.ebitda_pct < 0 ? '#A32D2D' : '#3D2314'} />
          <IndCard label="Receita" valor={`R$ ${fmt(data.saude.indicadores.receita || 0)}`} />
        </div>
      </div>
      
      {/* Card 2 — Ações */}
      <div style={{ background: 'white', borderRadius: 14, padding: '24px 28px', borderLeft: '4px solid #C8941A' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FAEEDA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#C8941A', transform: 'rotate(45deg)' }} />
            </div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#888780', fontWeight: 500, textTransform: 'uppercase' }}>Ações de hoje</div>
          </div>
          <div style={{ fontSize: 12, color: '#888780' }}>{data.acoes.length} pendência{data.acoes.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.acoes.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#888780', fontSize: 14 }}>
              Nada urgente. 👌
            </div>
          )}
          {data.acoes.map((a: any) => {
            const c = {
              critica: { bg: '#FCEBEB', bord: '#F7C1C1', bar: '#A32D2D', tit: '#501313', det: '#791F1F' },
              alta: { bg: '#FAEEDA', bord: '#FAC775', bar: '#C8941A', tit: '#412402', det: '#633806' },
              media: { bg: '#FAF7F2', bord: '#E8E2D4', bar: '#888780', tit: '#3D2314', det: '#5F5E5A' }
            }[a.severidade as string] || { bg: '#FAF7F2', bord: '#E8E2D4', bar: '#888780', tit: '#3D2314', det: '#5F5E5A' };
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: c.bg, borderRadius: 10, border: `1px solid ${c.bord}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 6, height: 36, background: c.bar, borderRadius: 3, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: c.tit, fontWeight: 500, marginBottom: 2 }}>{a.titulo}</div>
                    <div style={{ fontSize: 12, color: c.det, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detalhe}</div>
                  </div>
                </div>
                <a href={a.acao_url} style={{ background: '#3D2314', color: 'white', textDecoration: 'none', padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                  {a.acao_label}
                </a>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Card 3 — Futuro */}
      <div style={{ background: 'white', borderRadius: 14, padding: '24px 28px', borderLeft: '4px solid #3D2314' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EFEAE0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 10 L5 6 L8 8 L12 3" stroke="#3D2314" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
          </div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#888780', fontWeight: 500, textTransform: 'uppercase' }}>Futuro — 60 dias</div>
        </div>
        <Projecao fluxo={data.futuro.fluxo} saldo={data.futuro.saldo_projetado_60d} />
      </div>
    </div>
  );
}

function IndCard({ label, valor, cor = '#3D2314' }: { label: string; valor: string; cor?: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#FAF7F2', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: '#888780', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, color: cor, fontWeight: 500 }}>{valor}</div>
    </div>
  );
}

function Projecao({ fluxo, saldo }: { fluxo: any[]; saldo: number }) {
  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  let acc = 0;
  const pts = fluxo.map((p: any) => { acc += Number(p.saldo_dia || 0); return { data: p.data, saldo: acc }; });
  const cor = saldo >= 0 ? '#639922' : '#A32D2D';
  
  if (pts.length === 0) {
    return <div style={{ padding: 20, color: '#888780', fontSize: 14 }}>Sem dados de projeção.</div>;
  }
  
  const minS = Math.min(...pts.map(p => p.saldo), 0);
  const maxS = Math.max(...pts.map(p => p.saldo), 0);
  const range = maxS - minS || 1;
  const path = pts.map((p, i) => {
    const x = (i / Math.max(pts.length - 1, 1)) * 400;
    const y = 160 - ((p.saldo - minS) / range) * 140;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 28, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 11, color: '#888780', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Saldo 60 dias</div>
        <div style={{ fontSize: 30, color: cor, fontWeight: 500, letterSpacing: -0.8 }}>R$ {fmt(saldo)}</div>
        <div style={{ fontSize: 12, color: '#888780', marginTop: 4 }}>Projeção baseada em contas cadastradas</div>
      </div>
      <svg viewBox="0 0 400 180" style={{ width: '100%' }}>
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L 400 180 L 0 180 Z`} fill="url(#grad)" />
        <path d={path} stroke={cor} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ============ CAMADA 2 ============
function CamadaDois({ data }: { data: any }) {
  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  
  return (
    <>
      <div style={{ background: 'white', borderRadius: 14, padding: '24px 28px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#888780', fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>DRE Gerencial</div>
        <div style={{ fontSize: 18, color: '#3D2314', fontWeight: 500, marginBottom: 16 }}>Demonstração do Resultado</div>
        <div style={{ fontSize: 13 }}>
          {(data.dre_nivel2 || []).map((l: any) => {
            const isRes = l.tipo === 'resultado_final' || l.tipo === 'total';
            const isTit = l.tipo === 'titulo';
            const vPos = Number(l.valor) >= 0;
            const cor = isRes ? (vPos ? '#639922' : '#A32D2D') : '#3D2314';
            return (
              <div key={l.ordem} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', 
                padding: isRes ? '12px 0' : '7px 0',
                borderBottom: isRes ? '2px solid #3D2314' : '1px solid #F1EFE8',
                borderTop: isTit ? '2px solid #3D2314' : 'none',
                fontWeight: isRes || isTit ? 500 : 400,
                color: cor, fontSize: isRes ? 15 : 13
              }}>
                <div>{l.linha}</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {l.tipo === 'subtracao' && Number(l.valor) !== 0 ? `(${fmt(Number(l.valor_abs))})` : fmt(Number(l.valor))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TopLista titulo="Top 5 Clientes" itens={data.top_clientes || []} tipo="cliente" fmt={fmt} />
        <TopLista titulo="Top 5 Fornecedores" itens={data.top_fornecedores || []} tipo="fornecedor" fmt={fmt} />
      </div>
    </>
  );
}

function TopLista({ titulo, itens, tipo, fmt }: any) {
  return (
    <div style={{ background: 'white', borderRadius: 14, padding: '22px 26px' }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#888780', fontWeight: 500, textTransform: 'uppercase', marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 18, color: '#3D2314', fontWeight: 500, marginBottom: 14 }}>Por valor no ano</div>
      {itens.length === 0 && <div style={{ color: '#888780', fontSize: 13 }}>Sem dados.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itens.map((it: any, i: number) => (
          <div key={it.entidade_nome + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < itens.length - 1 ? '1px solid #F1EFE8' : 'none' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: it.classe_abc === 'A' ? '#C8941A' : it.classe_abc === 'B' ? '#EFEAE0' : '#F1EFE8',
              color: it.classe_abc === 'A' ? 'white' : '#3D2314',
              fontSize: 10, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>{it.classe_abc}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#3D2314', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.entidade_nome}</div>
              <div style={{ fontSize: 10, color: '#888780' }}>{it.qtd_transacoes} transações {it.qtd_empresas > 1 && `· ${it.qtd_empresas} empresas`}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: '#3D2314', fontWeight: 500 }}>R$ {fmt(Number(it.valor_total))}</div>
              <div style={{ fontSize: 10, color: '#C8941A' }}>{Number(it.participacao_pct).toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ MODAIS ============
function ModalGerenciarGrupos({ onClose, empresas, grupos }: any) {
  const [nome, setNome] = useState('');
  const [icone, setIcone] = useState('🏢');
  const [selEmpresas, setSelEmpresas] = useState<string[]>([]);
  const [isPadrao, setIsPadrao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  
  async function salvar() {
    if (!nome || selEmpresas.length === 0) { alert('Nome e empresas obrigatórios'); return; }
    setSalvando(true);
    await apiFetch('/api/dashboard/grupos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, icone, company_ids: selEmpresas, is_padrao: isPadrao })
    });
    setSalvando(false);
    onClose();
  }
  
  async function remover(id: string) {
    if (!confirm('Remover este grupo?')) return;
    await apiFetch(`/api/dashboard/grupos?id=${id}`, { method: 'DELETE' });
    onClose();
  }
  
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#FAF7F2', borderRadius: 16, padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 22, color: '#3D2314', margin: '0 0 20px', fontWeight: 500 }}>Gerenciar Grupos</h2>
        
        {grupos.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Grupos existentes</div>
            {grupos.map((g: Grupo) => (
              <div key={g.id} style={{ background: 'white', padding: '12px 14px', borderRadius: 10, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{g.icone}</span>
                  <div>
                    <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 500 }}>{g.nome} {g.is_padrao && <span style={{ fontSize: 10, color: '#C8941A' }}>★ padrão</span>}</div>
                    <div style={{ fontSize: 11, color: '#888780' }}>{g.dashboard_grupos_empresas?.length || 0} empresas</div>
                  </div>
                </div>
                <button onClick={() => remover(g.id)} style={{ background: 'transparent', border: '1px solid #F7C1C1', color: '#A32D2D', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Remover</button>
              </div>
            ))}
          </div>
        )}
        
        <div style={{ background: 'white', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Novo Grupo</div>
          <input placeholder="Nome do grupo" value={nome} onChange={e => setNome(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 7, border: '1px solid #E8E2D4', fontSize: 14, marginBottom: 10, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <input placeholder="Ícone (emoji)" value={icone} onChange={e => setIcone(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 7, border: '1px solid #E8E2D4', fontSize: 14, marginBottom: 10, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <div style={{ fontSize: 11, color: '#888780', marginBottom: 6 }}>Empresas:</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12, border: '1px solid #E8E2D4', borderRadius: 7, padding: 8 }}>
            {empresas.map((e: Empresa) => (
              <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={selEmpresas.includes(e.id)} onChange={() => {
                  setSelEmpresas(selEmpresas.includes(e.id) ? selEmpresas.filter(x => x !== e.id) : [...selEmpresas, e.id]);
                }} />
                <span>{e.nome_fantasia}</span>
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, fontSize: 13, color: '#3D2314', cursor: 'pointer' }}>
            <input type="checkbox" checked={isPadrao} onChange={e => setIsPadrao(e.target.checked)} />
            <span>Definir como grupo padrão</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={salvar} disabled={salvando} style={{ flex: 1, background: '#C8941A', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', opacity: salvando ? 0.5 : 1 }}>
              {salvando ? 'Salvando...' : 'Criar Grupo'}
            </button>
            <button onClick={onClose} style={{ background: 'transparent', color: '#3D2314', border: '1px solid #3D2314', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalGerenciarAtalhos({ onClose, plano, atuais }: any) {
  const [atalhos, setAtalhos] = useState<Atalho[]>(atuais);
  const [novo, setNovo] = useState<Atalho>({ nome: '', url: '', icone: '⭐', cor: '#C8941A', ordem: 0 });
  
  async function salvar() {
    await apiFetch('/api/dashboard/atalhos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plano, atalhos: atalhos.map((a, i) => ({ ...a, ordem: i })) })
    });
    onClose();
  }
  
  async function reset() {
    if (!confirm('Resetar para atalhos padrão?')) return;
    await apiFetch(`/api/dashboard/atalhos?plano=${plano}`, { method: 'DELETE' });
    onClose();
  }
  
  function adicionar() {
    if (!novo.nome || !novo.url) return;
    setAtalhos([...atalhos, { ...novo, ordem: atalhos.length }]);
    setNovo({ nome: '', url: '', icone: '⭐', cor: '#C8941A', ordem: 0 });
  }
  
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#FAF7F2', borderRadius: 16, padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 22, color: '#3D2314', margin: '0 0 20px', fontWeight: 500 }}>Atalhos — {plano}</h2>
        
        <div style={{ marginBottom: 20 }}>
          {atalhos.map((a: Atalho, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', padding: '10px 12px', borderRadius: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>{a.icone}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#3D2314', fontWeight: 500 }}>{a.nome}</div>
                <div style={{ fontSize: 11, color: '#888780' }}>{a.url}</div>
              </div>
              <button onClick={() => setAtalhos(atalhos.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', color: '#A32D2D', fontSize: 16, cursor: 'pointer' }}>×</button>
            </div>
          ))}
        </div>
        
        <div style={{ background: 'white', padding: 16, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Adicionar Atalho</div>
          <input placeholder="Nome" value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #E8E2D4', fontSize: 13, marginBottom: 6, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <input placeholder="URL (ex: /financeiro/pagar)" value={novo.url} onChange={e => setNovo({ ...novo, url: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #E8E2D4', fontSize: 13, marginBottom: 6, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <input placeholder="Ícone" value={novo.icone} onChange={e => setNovo({ ...novo, icone: e.target.value })} style={{ width: 80, padding: '8px 10px', borderRadius: 6, border: '1px solid #E8E2D4', fontSize: 13, marginBottom: 10, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={adicionar} style={{ background: '#C8941A', color: 'white', border: 'none', padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>+ Adicionar</button>
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={salvar} style={{ flex: 1, background: '#C8941A', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Salvar</button>
          <button onClick={reset} style={{ background: 'transparent', color: '#A32D2D', border: '1px solid #F7C1C1', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Resetar padrão</button>
          <button onClick={onClose} style={{ background: 'transparent', color: '#3D2314', border: '1px solid #3D2314', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}


export default function Page() {
  return <Suspense fallback={<div style={{padding:40,background:'#FAF7F2',minHeight:'100vh',color:'#3D2314',fontFamily:'Inter,system-ui,sans-serif'}}>Carregando Dashboard...</div>}><DashboardUniversalInner /></Suspense>;
}
