'use client'

// E-commerce · EC0 — abertura "o que fazer hoje" (blueprint erp_documento_vertical vertical=ecommerce, seções 5 e 7).
// Sem canal conectado não há dado: cada indicador diz isso e aponta o próximo passo (estado vazio com "?", RD-95).
// Tela própria no design system PS (RD-96). As telas futuras abrem o placeholder único "em construção".

import Link from 'next/link'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { esp: '#3D2314', espM: '#6B5D4F', bg: '#FAF7F2', white: '#FFFFFF', border: '#E0D8CC', gold: '#C8941A', cream: '#F0ECE3' }
const ROTA = '/dashboard/ecommerce'

const INDICADORES = [
  { chave: 'ecommerce.inicio.pedidos_separar', rotulo: 'Pedidos a separar', vazio: 'Conecte o primeiro canal para ver os pedidos do dia.', passo: 'Canais de venda', href: '/dashboard/em-construcao/ecommerce_canais' },
  { chave: 'ecommerce.inicio.anuncios_problema', rotulo: 'Anúncios com problema', vazio: 'Sem anúncios ainda. Publique pelo catálogo único.', passo: 'Catálogo único', href: '/dashboard/em-construcao/ecommerce_catalogo' },
  { chave: 'ecommerce.inicio.perguntas', rotulo: 'Perguntas sem resposta', vazio: 'As perguntas dos compradores chegam aqui, numa caixa só.', passo: 'Pós-venda', href: '/dashboard/em-construcao/ecommerce_posvenda' },
  { chave: 'ecommerce.inicio.repasses', rotulo: 'Repasses a conciliar', vazio: 'Quando um canal depositar, você confere pedido a pedido.', passo: 'Lucro real e repasses', href: '/dashboard/em-construcao/ecommerce_lucro' },
  { chave: 'ecommerce.inicio.ruptura', rotulo: 'Ruptura prevista', vazio: 'A previsão usa o giro de vendas e o prazo do fornecedor.', passo: 'Pedidos e expedição', href: '/dashboard/em-construcao/ecommerce_pedidos' },
]

const ONDAS = [
  ['EC1', 'Catálogo único sobre os produtos da Gestão Empresarial', '/dashboard/em-construcao/ecommerce_catalogo'],
  ['EC2', 'Primeiro canal: Mercado Livre (API oficial)', '/dashboard/em-construcao/ecommerce_canais'],
  ['EC3', 'Central de pedidos, NF-e automática e expedição por QR', '/dashboard/em-construcao/ecommerce_pedidos'],
  ['EC4', 'Repasses, conciliação e lucro real por pedido, SKU e canal', '/dashboard/em-construcao/ecommerce_lucro'],
  ['EC6', 'Anúncios em massa e preço mínimo pela margem', '/dashboard/em-construcao/ecommerce_anuncios'],
  ['EC7', 'Pós-venda unificado com IA e reputação', '/dashboard/em-construcao/ecommerce_posvenda'],
] as const

export default function EcommerceInicioPage() {
  return (
    <main style={{ background: C.bg, minHeight: '100%', padding: '24px 16px 48px', color: C.esp }} data-testid="ecommerce-inicio">
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>O que fazer hoje</h1>
        <p style={{ color: C.espM, fontSize: 15, margin: '6px 0 24px', maxWidth: 640 }}>
          Seus canais de venda num lugar só, com o lucro real de cada pedido. Esta é a primeira etapa da vertical: o painel já está pronto para receber os dados dos canais.
        </p>

        <section aria-label="Indicadores do dia" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {INDICADORES.map(i => (
            <div key={i.chave} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }} data-testid={`ecommerce-ind-${i.chave.split('.').pop()}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: C.espM }}>
                {i.rotulo}<AjudaCampo chave={i.chave} rota={ROTA} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '6px 0' }}>—</div>
              <p style={{ fontSize: 13, color: C.espM, margin: '0 0 10px' }}>{i.vazio}</p>
              <Link href={i.href} style={{ fontSize: 13, fontWeight: 600, color: C.gold }}>Próximo passo: {i.passo} →</Link>
            </div>
          ))}
        </section>

        <section aria-label="Roteiro" style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>O que vem por aí</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {ONDAS.map(([onda, texto, href]) => (
              <li key={onda}>
                <Link href={href} style={{ display: 'flex', gap: 12, alignItems: 'center', background: C.cream, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', color: C.esp, textDecoration: 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, background: C.white, borderRadius: 999, padding: '2px 10px' }}>{onda}</span>
                  <span style={{ fontSize: 14 }}>{texto}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM }}>em construção</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
