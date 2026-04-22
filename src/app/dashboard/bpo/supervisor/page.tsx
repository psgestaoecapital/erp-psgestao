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
  atrasado: '#B85042',
  urgente: '#D97706',
  hoje: '#FBBF24',
  ok: '#4A7C4A',
  verde: '#4A7C4A',
  vermelho: '#B85042',
};

type DashboardRow = {
  empresa: string;
  company_id: string;
  total_itens: number;
  urgentes: number;
  atrasados: number;
  hoje: number;
  sem_operador: number;
  concluidos_hoje: number;
};

type OperadorStats = {
  user_id: string;
  full_name: string;
  empresas_acesso: number;
  itens_pendentes: number;
  itens_atrasados: number;
  concluidos_hoje: number;
};

export default function SupervisorDashboardPage() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [operadores, setOperadores] = useState<OperadorStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    
    const [dashRes, opsRes] = await Promise.all([
      supabase.rpc('fn_supervisor_dashboard'),
      supabase.rpc('fn_operadores_stats'),
    ]);
    
    if (dashRes.data) setRows(dashRes.data);
    if (opsRes.data) setOperadores(opsRes.data);
    setLoading(false);
  }

  const totals = rows.reduce((acc, r) => ({
    total: acc.total + r.total_itens,
    urgentes: acc.urgentes + r.urgentes,
    atrasados: acc.atrasados + r.atrasados,
    hoje: acc.hoje + r.hoje,
    sem_operador: acc.sem_operador + r.sem_operador,
    concluidos: acc.concluidos + r.concluidos_hoje,
  }), { total: 0, urgentes: 0, atrasados: 0, hoje: 0, sem_operador: 0, concluidos: 0 });

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', fontFamily: 'Calibri, sans-serif' }}>
      <div style={{ backgroundColor: C.espresso, padding: '24px 32px', color: C.offwhite }}>
        <div style={{ fontSize: '11px', color: C.douradoClaro, fontWeight: 'bold', letterSpacing: '2px' }}>
          CENTRAL BPO PS GESTAO
        </div>
        <h1 style={{ fontSize: '32px', fontFamily: 'Georgia, serif', margin: '4px 0 0 0', fontWeight: 'bold' }}>
          Supervisor Dashboard
        </h1>
        <div style={{ fontSize: '13px', color: C.douradoClaro, marginTop: '4px' }}>
          {rows.length} empresas ativas - {totals.total} itens totais - {totals.concluidos} concluidos hoje
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <BigKpi label="Total" valor={totals.total} cor={C.espresso} />
          <BigKpi label="Atrasados" valor={totals.atrasados} cor={C.atrasado} />
          <BigKpi label="Urgentes" valor={totals.urgentes} cor={C.urgente} />
          <BigKpi label="Hoje" valor={totals.hoje} cor={C.hoje} />
          <BigKpi label="Sem operador" valor={totals.sem_operador} cor={C.txtMedio} />
          <BigKpi label="Concluidos hoje" valor={totals.concluidos} cor={C.ok} />
        </div>

        <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
            Visao por Empresa
          </div>
          
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: C.txtMedio }}>Carregando...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  <th style={thStyle()}>Empresa</th>
                  <th style={thStyleRight()}>Total</th>
                  <th style={thStyleRight()}>Atraso</th>
                  <th style={thStyleRight()}>Urgente</th>
                  <th style={thStyleRight()}>Hoje</th>
                  <th style={thStyleRight()}>Sem operador</th>
                  <th style={thStyleRight()}>OK Hoje</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.company_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={tdStyle()}><strong>{r.empresa}</strong></td>
                    <td style={tdStyleRight()}>{r.total_itens}</td>
                    <td style={{ ...tdStyleRight(), color: r.atrasados > 0 ? C.atrasado : C.txtClaro, fontWeight: r.atrasados > 0 ? 'bold' : 'normal' }}>
                      {r.atrasados || '-'}
                    </td>
                    <td style={{ ...tdStyleRight(), color: r.urgentes > 0 ? C.urgente : C.txtClaro, fontWeight: r.urgentes > 0 ? 'bold' : 'normal' }}>
                      {r.urgentes || '-'}
                    </td>
                    <td style={{ ...tdStyleRight(), color: r.hoje > 0 ? '#A67C00' : C.txtClaro }}>
                      {r.hoje || '-'}
                    </td>
                    <td style={{ ...tdStyleRight(), color: r.sem_operador > 0 ? C.atrasado : C.txtClaro, fontWeight: r.sem_operador > 0 ? 'bold' : 'normal' }}>
                      {r.sem_operador || '-'}
                    </td>
                    <td style={{ ...tdStyleRight(), color: C.ok }}>
                      {r.concluidos_hoje || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {operadores.length > 0 && (
          <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '20px 24px' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
              Carga de Trabalho por Operador
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {operadores.map(op => (
                <div key={op.user_id} style={{ padding: '14px', borderRadius: '8px', backgroundColor: C.offwhite, borderLeft: `4px solid ${op.itens_atrasados > 0 ? C.atrasado : C.verde}` }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: C.txt }}>{op.full_name}</div>
                  <div style={{ fontSize: '11px', color: C.txtClaro, marginTop: '2px' }}>
                    {op.empresas_acesso} empresas atribuidas
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                    <SmallStat label="Pendentes" val={op.itens_pendentes} cor={C.dourado} />
                    <SmallStat label="Atrasados" val={op.itens_atrasados} cor={op.itens_atrasados > 0 ? C.atrasado : C.txtClaro} />
                    <SmallStat label="Hoje OK" val={op.concluidos_hoje} cor={C.ok} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BigKpi({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '16px 20px', borderLeft: `4px solid ${cor}` }}>
      <div style={{ fontSize: '11px', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>
        {label}
      </div>
      <div style={{ fontSize: '32px', fontFamily: 'Georgia, serif', fontWeight: 'bold', color: cor, marginTop: '4px' }}>
        {valor}
      </div>
    </div>
  );
}

function SmallStat({ label, val, cor }: { label: string; val: number; cor: string }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: cor, fontFamily: 'Georgia, serif' }}>{val}</div>
      <div style={{ fontSize: '9px', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
    </div>
  );
}

function thStyle() { return { textAlign: 'left' as const, padding: '10px 8px', fontSize: '11px', color: C.txtMedio, fontWeight: 'bold' as const, textTransform: 'uppercase' as const, letterSpacing: '1px' }; }
function thStyleRight() { return { ...thStyle(), textAlign: 'right' as const }; }
function tdStyle() { return { padding: '10px 8px', fontSize: '13px', color: C.txt }; }
function tdStyleRight() { return { ...tdStyle(), textAlign: 'right' as const }; }
