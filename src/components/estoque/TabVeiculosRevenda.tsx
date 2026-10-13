'use client'

// #147 (Alliance) · GE → Estoque → Veículos: o estoque de veículos do PÁTIO da Revenda, lido na fonte
// (fn_veic_estoque_ge — sem cópia em erp_produtos). Custo = aquisição + custos lançados (o mesmo da ficha do carro).
// Consignado aparece, mas não soma no valor do estoque (o carro não é da loja).
import Link from 'next/link'

export type VeiculoEstoque = {
  id: string; marca: string | null; modelo: string | null; versao: string | null; placa: string | null
  ano_modelo: number | null; situacao: string; consignado: boolean; custo: number | null
  preco_venda: number | null; dias: number | null
}
export type EstoqueVeiculos = {
  ok: boolean; tem_revenda: boolean; itens: VeiculoEstoque[]
  totais: { qtd: number; qtd_proprios: number; qtd_consignados: number; valor_custo: number; valor_anunciado: number; sem_custo: number }
}

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', goldBg: '#FDF7E8', amber: '#C88A1A', amberBg: '#FFF8E1',
}
const SIT: Record<string, string> = {
  em_preparacao: 'em preparação', disponivel: 'disponível', reservado: 'reservado', consignado: 'consignado', devolvido: 'devolvido',
}
const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function TabVeiculosRevenda({ dados }: { dados: EstoqueVeiculos }) {
  const t = dados.totais
  const kpi = (label: string, valor: string, testid?: string) => (
    <div style={{ flex: '1 1 160px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: C.espressoM }}>{label}</div>
      <div data-testid={testid} style={{ fontSize: 17, fontWeight: 800, color: C.espresso }}>{valor}</div>
    </div>
  )
  return (
    <div data-testid="estoque-veiculos">
      <div style={{ fontSize: 12, color: C.espressoM, marginBottom: 10 }}>
        Veículos no pátio da Revenda (em preparação, disponíveis, reservados, consignados e devolvidos). O cadastro é o do
        pátio — para alterar, abra a ficha do veículo.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {kpi('Veículos próprios em estoque', String(t.qtd_proprios), 'estoque-veiculos-qtd')}
        {kpi('Valor em estoque (custo)', brl(t.valor_custo), 'estoque-veiculos-custo')}
        {kpi('Valor anunciado (próprios)', brl(t.valor_anunciado))}
        {t.qtd_consignados > 0 && kpi('Consignados (não somam)', String(t.qtd_consignados))}
      </div>
      {t.sem_custo > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, color: C.espresso, fontSize: 12 }}>
          ⚠️ {t.sem_custo} veículo(s) sem valor de aquisição — ficam fora do valor em estoque. Informe na ficha do veículo.
        </div>
      )}
      {dados.itens.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Nenhum veículo no estoque do pátio.</div>
      ) : (
        <div style={{ overflowX: 'auto', background: C.white, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
            <thead>
              <tr style={{ background: C.cream, color: C.espressoM, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Veículo</th>
                <th style={{ padding: '8px 10px' }}>Placa</th>
                <th style={{ padding: '8px 10px' }}>Situação</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Dias</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Custo</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Anunciado</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((v) => (
                <tr key={v.id} data-testid="estoque-veiculo-linha" style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 10px' }}>
                    <Link href={`/dashboard/revenda/veiculo/${v.id}`} style={{ color: C.espresso, fontWeight: 700, textDecoration: 'none' }}>
                      {[v.marca, v.modelo, v.versao].filter(Boolean).join(' ') || 'Veículo'}{v.ano_modelo ? ` · ${v.ano_modelo}` : ''}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{v.placa ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {SIT[v.situacao] ?? v.situacao.replace('_', ' ')}
                    {v.consignado && v.situacao !== 'consignado' && <span style={{ color: C.espressoL }}> · consignado</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{v.dias ?? '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{v.consignado ? <span style={{ color: C.espressoL }}>não é da loja</span> : brl(v.custo)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{brl(v.preco_venda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
