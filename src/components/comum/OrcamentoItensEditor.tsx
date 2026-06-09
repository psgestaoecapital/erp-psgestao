'use client'

// FEAT-OS-ONDA1B-EDITOR-NO-OTC-v1
// Editor de itens polimorfico (produto OU servico) reutilizavel · light theme.
// Construido em cima dos autocompletes do #268 (produto) e #273 (servico) ·
// schema polimorfico do #275 (tipo_item, servico_id/codigo/descricao).
// Anti-reinvencao: 1 editor compartilhado pra OTC + outros formularios.
//
// Controlled component: pai mantem `itens` em state · onChange recebe array novo.

import { useId } from 'react'
import { Trash2 } from 'lucide-react'
import ProdutoAutocomplete, { type ProdutoSelecionado } from '@/components/comum/ProdutoAutocomplete'
import ServicoAutocomplete, { type ServicoSelecionado } from '@/components/comum/ServicoAutocomplete'

export type EditorItem = {
  id?: string
  ordem: number
  tipo_item: 'produto' | 'servico'
  produto_id?: string | null
  produto_codigo?: string | null
  produto_nome?: string | null
  produto_descricao?: string | null
  servico_id?: string | null
  servico_codigo?: string | null
  servico_descricao?: string | null
  unidade: string
  quantidade: number
  preco_unitario: number
  preco_custo?: number | null
  subtotal: number
}

interface Props {
  companyId: string
  itens: EditorItem[]
  onChange: (itens: EditorItem[]) => void
}

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  cream: '#F0ECE3',
  border: '#E0D8CC',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  purple: '#A855F7',
  purpleBg: '#F3E8FF',
  red: '#EF4444',
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 12,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: '#fff',
  color: C.espresso,
  outline: 'none',
}

function novoProduto(ordem: number): EditorItem {
  return { ordem, tipo_item: 'produto', unidade: 'un', quantidade: 1, preco_unitario: 0, subtotal: 0 }
}

function novoServico(ordem: number): EditorItem {
  return { ordem, tipo_item: 'servico', unidade: 'SV', quantidade: 1, preco_unitario: 0, subtotal: 0 }
}

function recalc(it: EditorItem): EditorItem {
  const subtotal = Math.max((Number(it.quantidade) || 0) * (Number(it.preco_unitario) || 0), 0)
  return { ...it, subtotal }
}

export default function OrcamentoItensEditor({ companyId, itens, onChange }: Props) {
  const tid = useId()

  function atualizar(idx: number, patch: Partial<EditorItem>) {
    const arr = [...itens]
    arr[idx] = recalc({ ...arr[idx], ...patch })
    onChange(arr)
  }

  function selecionarProduto(idx: number, p: ProdutoSelecionado) {
    atualizar(idx, {
      tipo_item: 'produto',
      produto_id: p.id,
      produto_codigo: p.codigo,
      produto_nome: p.nome,
      unidade: p.unidade || 'un',
      preco_unitario: 0, // produto nao traz preco_venda no autocomplete · usuario digita
      preco_custo: p.preco_custo_medio ?? p.preco_custo ?? null,
    })
  }

  function limparProduto(idx: number) {
    atualizar(idx, {
      produto_id: null, produto_codigo: null, produto_nome: null,
    })
  }

  function selecionarServico(idx: number, s: ServicoSelecionado) {
    atualizar(idx, {
      tipo_item: 'servico',
      servico_id: s.id,
      servico_codigo: s.codigo,
      servico_descricao: s.descricao_resumida,
      unidade: 'SV',
      preco_unitario: Number(s.valor_unitario ?? 0),
    })
  }

  function limparServico(idx: number) {
    atualizar(idx, {
      servico_id: null, servico_codigo: null, servico_descricao: null,
    })
  }

  function addProduto() {
    onChange([...itens, novoProduto(itens.length + 1)])
  }

  function addServico() {
    onChange([...itens, novoServico(itens.length + 1)])
  }

  function remover(idx: number) {
    onChange(itens.filter((_, i) => i !== idx).map((it, i) => ({ ...it, ordem: i + 1 })))
  }

  const subtotalProdutos = itens.filter((i) => i.tipo_item === 'produto').reduce((s, i) => s + (i.subtotal || 0), 0)
  const subtotalServicos = itens.filter((i) => i.tipo_item === 'servico').reduce((s, i) => s + (i.subtotal || 0), 0)
  const total = subtotalProdutos + subtotalServicos
  const fmtBRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`${tid}-editor`}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={addProduto}
          data-testid="orc-add-produto"
          style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            border: `1px solid ${C.gold}`, borderRadius: 6,
            background: C.goldBg, color: C.goldD, cursor: 'pointer',
          }}
        >
          + Produto
        </button>
        <button
          type="button"
          onClick={addServico}
          data-testid="orc-add-servico"
          style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            border: `1px solid ${C.purple}`, borderRadius: 6,
            background: C.purpleBg, color: C.purple, cursor: 'pointer',
          }}
        >
          + Serviço
        </button>
      </div>

      {itens.length === 0 ? (
        <p style={{ fontSize: 11, color: C.espressoM, fontStyle: 'italic', margin: '4px 0' }}>
          Nenhum item · adicione um produto ou serviço.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itens.map((it, i) => (
            <div
              key={i}
              data-testid={`orc-item-row-${i}`}
              style={{
                background: '#fff',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 8,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: it.tipo_item === 'servico' ? C.purple : C.goldD,
                  padding: '2px 6px', borderRadius: 4,
                  background: it.tipo_item === 'servico' ? C.purpleBg : C.goldBg,
                }}>
                  {it.tipo_item === 'servico' ? 'SRV' : 'PRD'} #{it.ordem}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => remover(i)}
                  data-testid={`orc-item-remover-${i}`}
                  style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: 2 }}
                  aria-label="Remover"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {it.tipo_item === 'produto' ? (
                <ProdutoAutocomplete
                  companyId={companyId}
                  selecionado={it.produto_id ? {
                    id: it.produto_id,
                    codigo: it.produto_codigo ?? null,
                    nome: it.produto_nome ?? '',
                    unidade: it.unidade,
                    preco_custo: it.preco_custo ?? null,
                  } : null}
                  onSelect={(p) => selecionarProduto(i, p)}
                  onClear={() => limparProduto(i)}
                  testId={`orc-produto-${i}`}
                />
              ) : (
                <ServicoAutocomplete
                  companyId={companyId}
                  selecionado={it.servico_id ? {
                    id: it.servico_id,
                    codigo: it.servico_codigo ?? null,
                    descricao_resumida: it.servico_descricao || '',
                    valor_unitario: it.preco_unitario,
                  } : null}
                  onSelect={(s) => selecionarServico(i, s)}
                  onClear={() => limparServico(i)}
                  testId={`orc-servico-${i}`}
                />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 1.2fr', gap: 6 }}>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Qtd</span>
                  <input
                    type="number" step="0.001"
                    value={it.quantidade || ''}
                    onChange={(e) => atualizar(i, { quantidade: parseFloat(e.target.value) || 0 })}
                    style={{ ...inp, textAlign: 'right' }}
                    data-testid={`orc-qtd-${i}`}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Un</span>
                  <input
                    value={it.unidade}
                    onChange={(e) => atualizar(i, { unidade: e.target.value })}
                    style={{ ...inp, textAlign: 'center' }}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Preço un. (R$)</span>
                  <input
                    type="number" step="0.01"
                    value={it.preco_unitario || ''}
                    onChange={(e) => atualizar(i, { preco_unitario: parseFloat(e.target.value) || 0 })}
                    style={{ ...inp, textAlign: 'right' }}
                    data-testid={`orc-preco-${i}`}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Subtotal</span>
                  <div style={{
                    padding: '8px 10px', fontSize: 12, fontWeight: 600,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    background: C.cream, color: C.espresso, textAlign: 'right',
                  }}>
                    {fmtBRL(it.subtotal)}
                  </div>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {itens.length > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 10px', background: C.cream, borderRadius: 6,
          fontSize: 11, color: C.espressoM,
        }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <span>Produtos: <strong style={{ color: C.goldD }}>{fmtBRL(subtotalProdutos)}</strong></span>
            <span>Serviços: <strong style={{ color: C.purple }}>{fmtBRL(subtotalServicos)}</strong></span>
          </div>
          <strong style={{ fontSize: 14, color: C.gold }}>{fmtBRL(total)}</strong>
        </div>
      )}
    </div>
  )
}
