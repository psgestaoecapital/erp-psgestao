// src/app/(auth)/admin/psgc/linhas-negocio/page.tsx
// Cadastro e gestão de Linhas de Negócio da empresa

'use client';
import { authFetch } from '@/lib/authFetch';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface LN {
  id: string;
  name: string;
  type: string;
  ln_number: number;
  keywords: { id: string; keyword: string; prioridade: number }[];
}

function LinhasNegocioInner() {
  const [lns, setLns] = useState<LN[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novoTipo, setNovoTipo] = useState('servico');
  const [novasKeywords, setNovasKeywords] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const searchParams = useSearchParams();
  const companyId = searchParams.get('company_id') || '';

  async function carregar() {
    if (!companyId) { setLoading(false); return; }
    const res = await authFetch(`/api/psgc/linha-negocio?company_id=${companyId}`);
    const d = await res.json();
    setLns(d.linhas_negocio || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [companyId]);

  async function cadastrar() {
    if (!novoNome.trim()) { alert('Informe um nome'); return; }
    setSalvando(true);
    try {
      const keywordsList = novasKeywords
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
      
      const res = await authFetch('/api/psgc/linha-negocio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          nome: novoNome.trim(),
          tipo: novoTipo,
          keywords: keywordsList
        })
      });
      
      if (res.ok) {
        setNovoNome(''); setNovasKeywords(''); setShowForm(false);
        await carregar();
      } else {
        const err = await res.json();
        alert('Erro: ' + (err.error || 'desconhecido'));
      }
    } finally {
      setSalvando(false);
    }
  }

  if (loading) return <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh' }}>Carregando...</div>;
  if (!companyId) return <div style={{ padding: 40, background: '#FAF7F2', minHeight: '100vh' }}>Selecione uma empresa.</div>;

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        
        <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: '#C8941A', fontWeight: 500, textTransform: 'uppercase' }}>Admin PSGC</div>
            <h1 style={{ fontSize: 28, color: '#3D2314', margin: '4px 0 0', fontWeight: 500, letterSpacing: -0.5 }}>Linhas de Negócio</h1>
            <div style={{ fontSize: 13, color: '#7a6b5d', marginTop: 4 }}>
              Divida o negócio em linhas pra ver DRE Divisional
            </div>
          </div>
          <button 
            onClick={() => setShowForm(!showForm)}
            style={{
              background: '#3D2314', color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            {showForm ? 'Cancelar' : '+ Nova LN'}
          </button>
        </div>

        {showForm && (
          <div style={{ background: 'white', borderRadius: 14, padding: 24, marginBottom: 20, border: '1px solid #E8E2D4' }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>Nome da linha</label>
                <input 
                  value={novoNome} 
                  onChange={e => setNovoNome(e.target.value)}
                  placeholder="Ex: Gesso Oeste, Oficina Mecânica, Planejamento..."
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid #E8E2D4', fontSize: 14, color: '#3D2314',
                    fontFamily: 'inherit', background: 'white'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>Tipo</label>
                <select 
                  value={novoTipo}
                  onChange={e => setNovoTipo(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid #E8E2D4', fontSize: 14, color: '#3D2314',
                    fontFamily: 'inherit', background: 'white'
                  }}
                >
                  <option value="servico">Serviço</option>
                  <option value="produto">Produto</option>
                  <option value="misto">Misto</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                  Palavras-chave (separadas por vírgula)
                </label>
                <input 
                  value={novasKeywords} 
                  onChange={e => setNovasKeywords(e.target.value)}
                  placeholder="Ex: gesso, drywall oeste, mao de obra gesso"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid #E8E2D4', fontSize: 14, color: '#3D2314',
                    fontFamily: 'inherit', background: 'white'
                  }}
                />
                <div style={{ fontSize: 11, color: '#888780', marginTop: 6 }}>
                  O motor usa essas palavras pra classificar lançamentos automaticamente.
                </div>
              </div>
              <button 
                onClick={cadastrar}
                disabled={salvando}
                style={{
                  background: '#C8941A', color: 'white', border: 'none',
                  padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: salvando ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  opacity: salvando ? 0.6 : 1, justifySelf: 'start'
                }}
              >
                {salvando ? 'Salvando...' : 'Cadastrar LN'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 12 }}>
          {lns.length === 0 && !showForm && (
            <div style={{ background: 'white', borderRadius: 14, padding: 40, textAlign: 'center', color: '#888780' }}>
              Nenhuma linha de negócio cadastrada ainda.
              <br /><br />
              <span style={{ fontSize: 13 }}>
                Cadastrar LNs permite que o sistema segmente a DRE por área do seu negócio, 
                mostrando qual linha dá lucro e qual dá prejuízo.
              </span>
            </div>
          )}
          {lns.map(ln => (
            <div key={ln.id} style={{
              background: 'white', borderRadius: 12, padding: '18px 20px',
              border: '1px solid #E8E2D4'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 16, color: '#3D2314', fontWeight: 500 }}>{ln.name}</div>
                  <div style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
                    #{ln.ln_number} · {ln.type}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#C8941A', fontWeight: 500 }}>
                  {ln.keywords.length} {ln.keywords.length === 1 ? 'palavra-chave' : 'palavras-chave'}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ln.keywords.map(k => (
                  <span key={k.id} style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 20,
                    background: '#FAEEDA', color: '#854F0B', border: '1px solid #FAC775'
                  }}>{k.keyword}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

export default function Page() { return <Suspense fallback={<div style={{padding:40,background:"#FAF7F2",minHeight:"100vh",color:"#3D2314"}}>Carregando...</div>}><LinhasNegocioInner /></Suspense>; }
