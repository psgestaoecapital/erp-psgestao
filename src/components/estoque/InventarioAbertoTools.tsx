'use client'

// Inventário ABERTO (Estoque › Inventário › drawer): o que reduz a digitação item a item (CEO 13/10, 1º inventário real).
//   SubirPlanilhaNoInventarioModal — lê a planilha de contagem, mostra a PRÉVIA (casadas · não encontradas · fora do
//     inventário · divergências) e só então grava a coluna "Contado" do PRÓPRIO inventário, pela RPC oficial.
//   AdicionarItemInventarioModal — a contagem achou produto que não estava na lista: entra no inventário aberto.
// O estoque NÃO muda aqui; o ajuste continua sendo o "Fechar inventário".

import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  lerPlanilhaContagem, montarPreviaInventarioAberto, type LeituraContagem, type ItemInventarioAberto,
} from '@/lib/estoque/planilhaContagem'
import { C, inp, lbl, btnSec, btnPri, fmtQ, fmtR, Moldura, type ProdutoPlanilha } from './PlanilhaContagemInventario'

const ROTA = '/dashboard/commerce/estoque'
type Inv = { id: string; company_id: string; numero: string | null }

/** Grava o item (insert) com o saldo atual do produto. Devolve o id do item. */
async function inserirItem(inv: Inv, p: ProdutoPlanilha): Promise<{ id: string; produto_id: string }> {
  const { data, error } = await supabase.from('erp_inventario_itens').insert({
    inventario_id: inv.id, company_id: inv.company_id, produto_id: p.id,
    quantidade_sistema: Number(p.estoque_atual ?? 0), custo_unitario: Number(p.preco_custo_medio ?? p.preco_custo ?? 0) || 0,
  }).select('id,produto_id').single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao incluir o item')
  return data as { id: string; produto_id: string }
}

async function recontarTotalProdutos(inv: Inv) {
  const { count } = await supabase.from('erp_inventario_itens').select('id', { count: 'exact', head: true }).eq('inventario_id', inv.id)
  if (count != null) await supabase.from('erp_inventarios').update({ total_produtos: count }).eq('id', inv.id)
}

export function SubirPlanilhaNoInventarioModal({ inventario, itens, produtos, onClose, onGravado, flashErr }: {
  inventario: Inv; itens: ItemInventarioAberto[]; produtos: ProdutoPlanilha[]
  onClose: () => void; onGravado: (n: number) => void | Promise<void>; flashErr: (m: string) => void
}) {
  const [arquivo, setArquivo] = useState('')
  const [lendo, setLendo] = useState(false)
  const [leitura, setLeitura] = useState<LeituraContagem | null>(null)
  const [adicionarFora, setAdicionarFora] = useState(true)
  const [gravando, setGravando] = useState('')
  const previa = useMemo(() => (leitura ? montarPreviaInventarioAberto(leitura, itens, produtos) : null), [leitura, itens, produtos])

  async function ler(f: File) {
    setLendo(true); setLeitura(null); setArquivo(f.name)
    try { setLeitura(await lerPlanilhaContagem(await f.arrayBuffer())) }
    catch (e) { flashErr('Não foi possível ler a planilha: ' + ((e as Error)?.message ?? 'arquivo inválido')) }
    finally { setLendo(false) }
  }

  const total = previa ? previa.linhas.length + (adicionarFora ? previa.foraDoInventario.length : 0) : 0
  const sobrescrevem = previa?.linhas.filter((l) => l.sobrescreve).length ?? 0

  async function gravar() {
    if (!previa || total === 0) return
    setGravando('Gravando…')
    try {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
      const fila: { item_id: string; q: number }[] = previa.linhas.map((l) => ({ item_id: l.item_id, q: l.contado }))
      if (adicionarFora && previa.foraDoInventario.length) {
        const porId = new Map(produtos.map((p) => [p.id, p]))
        for (const f of previa.foraDoInventario) {
          const p = porId.get(f.produto_id)
          if (!p) continue
          fila.push({ item_id: (await inserirItem(inventario, p)).id, q: f.contado })
        }
        await recontarTotalProdutos(inventario)
      }
      let feitos = 0
      const erros: string[] = []
      const resto = [...fila]
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let it = resto.shift(); it; it = resto.shift()) {
          const { error } = await supabase.rpc('fn_inventario_registrar_contagem', { p_item_id: it.item_id, p_quantidade_contada: it.q, p_usuario: user?.email ?? null })
          if (error) erros.push(error.message)
          feitos++; setGravando(`Registrando contagens… ${feitos}/${fila.length}`)
        }
      }))
      if (erros.length) throw new Error(`${erros.length} contagem(ns) não gravaram (${erros[0]}). O inventário segue aberto, sem ajustar o estoque.`)
      // mesma correção da subida em inventário novo: uma última gravação, sozinha, refaz os totais vendo tudo
      const ultimo = fila.at(-1)
      if (ultimo) {
        const { error } = await supabase.rpc('fn_inventario_registrar_contagem', { p_item_id: ultimo.item_id, p_quantidade_contada: ultimo.q, p_usuario: user?.email ?? null })
        if (error) throw new Error(`Os totais do inventário não fecharam (${error.message}).`)
      }
      await onGravado(fila.length)
    } catch (e) {
      flashErr((e as Error)?.message ?? 'Erro ao gravar a contagem')
    } finally {
      setGravando('')
    }
  }

  const bloco = (titulo: string, qtd: number, cor: string, itensErro: { linha: number; mensagem: string }[], testid: string) => qtd > 0 && (
    <div data-testid={testid} style={{ padding: 10, background: C.amberBg, borderRadius: 8, fontSize: 12, color: cor }}>
      <strong>{qtd} {titulo}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {itensErro.slice(0, 8).map((e, i) => <li key={i}>{e.linha ? `Linha ${e.linha}: ` : ''}{e.mensagem}</li>)}
        {itensErro.length > 8 && <li>… e mais {itensErro.length - 8}.</li>}
      </ul>
    </div>
  )

  return (
    <Moldura titulo={`📤 Subir planilha de contagem · ${inventario.numero ?? ''}`} largura={820} onClose={onClose} bloqueado={!!gravando}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>Planilha de contagem (.xlsx) <AjudaCampo chave="estoque.inventario.subir_planilha" rota={ROTA} /></label>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid="inv-planilha-arquivo"
            disabled={lendo || !!gravando} style={{ ...inp, padding: 6 }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = '' }} />
        </div>
        {lendo && <div style={{ fontSize: 12, color: C.espressoM }}>Lendo a planilha…</div>}
        {previa && (
          <>
            <div data-testid="inv-previa-resumo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {([
                ['Casadas', previa.linhas.length, C.green],
                ['Não encontradas', previa.naoEncontradas.length, C.red],
                ['Fora do inventário', previa.foraDoInventario.length, C.amber],
                ['Divergências', previa.divergencias.length, C.red],
              ] as const).map(([t, v, cor]) => (
                <div key={t} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 700 }}>{t}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: cor }}>{v}</div>
                </div>
              ))}
            </div>
            {bloco('linha(s) não encontrada(s)', previa.naoEncontradas.length, C.red, previa.naoEncontradas, 'inv-previa-nao-encontradas')}
            {bloco('linha(s) com id e código que não batem (não entram)', previa.divergencias.length, C.red, previa.divergencias, 'inv-previa-divergencias')}
            {bloco('linha(s) inválida(s)', previa.invalidas.length, C.red, previa.invalidas, 'inv-previa-invalidas')}
            {previa.foraDoInventario.length > 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                <input type="checkbox" checked={adicionarFora} onChange={(e) => setAdicionarFora(e.target.checked)} data-testid="inv-adicionar-fora" />
                <span>Adicionar ao inventário os {previa.foraDoInventario.length} produto(s) contados que não estavam na lista
                  <AjudaCampo chave="estoque.inventario.adicionar_fora" rota={ROTA} /></span>
              </label>
            )}
            {sobrescrevem > 0 && <div style={{ fontSize: 12, color: C.goldD }}>{sobrescrevem} item(ns) já tinham outra quantidade contada; a da planilha substitui.</div>}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '36vh' }}>
              <table data-testid="inv-previa" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                <thead style={{ background: C.cream, position: 'sticky', top: 0 }}>
                  <tr>{['Produto', 'Sistema', 'Contado', 'Diferença', 'Valor'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: i ? 'right' : 'left', fontSize: 10, textTransform: 'uppercase', color: C.espressoM }}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {previa.linhas.map((l) => {
                    const cor = l.diferenca > 0 ? C.green : l.diferenca < 0 ? C.red : C.espressoL
                    return (
                      <tr key={l.item_id} data-testid="inv-previa-linha" style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <td style={{ padding: '6px 10px' }}>{l.descricao} <span style={{ fontFamily: 'monospace', fontSize: 10, color: C.espressoM }}>{l.codigo}</span></td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtQ(l.sistema)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtQ(l.contado)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: cor }}>{l.diferenca > 0 ? '+' : ''}{fmtQ(l.diferenca)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: cor }}>{fmtR(l.valor_diferenca)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 10, background: C.amberBg, borderRadius: 8, fontSize: 12, color: C.goldD }}>
              Nada foi gravado ainda. Confirmar preenche a coluna <strong>Contado</strong> deste inventário; o estoque só muda em <strong>Fechar inventário</strong>.
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          {gravando && <span style={{ fontSize: 12, color: C.espressoM, marginRight: 'auto' }}>{gravando}</span>}
          <button type="button" onClick={onClose} disabled={!!gravando} style={btnSec}>Cancelar</button>
          <button type="button" onClick={gravar} disabled={!previa || total === 0 || !!gravando} data-testid="inv-planilha-gravar" style={btnPri(!!previa && total > 0 && !gravando)}>
            <Upload size={14} /> Gravar {total} contagem(ns)
          </button>
        </div>
      </div>
    </Moldura>
  )
}

export function AdicionarItemInventarioModal({ inventario, itensExistentes, produtos, onClose, onAdicionado, flashErr }: {
  inventario: Inv; itensExistentes: Set<string>; produtos: ProdutoPlanilha[]
  onClose: () => void; onAdicionado: () => void | Promise<void>; flashErr: (m: string) => void
}) {
  const [busca, setBusca] = useState('')
  const [salvando, setSalvando] = useState(false)
  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (t.length < 2) return []
    return produtos.filter((p) => !itensExistentes.has(p.id) && (p.nome.toLowerCase().includes(t) || (p.codigo ?? '').toLowerCase().includes(t) || (p.codigo_barras ?? '').includes(t))).slice(0, 30)
  }, [busca, produtos, itensExistentes])

  async function adicionar(p: ProdutoPlanilha) {
    setSalvando(true)
    try { await inserirItem(inventario, p); await recontarTotalProdutos(inventario); await onAdicionado() }
    catch (e) { flashErr((e as Error)?.message ?? 'Erro ao incluir o item') }
    finally { setSalvando(false) }
  }

  return (
    <Moldura titulo="➕ Adicionar produto ao inventário" largura={560} onClose={onClose} bloqueado={salvando}>
      <label style={lbl}>Buscar por nome, código ou código de barras <AjudaCampo chave="estoque.inventario.adicionar_item" rota={ROTA} /></label>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} autoFocus data-testid="inv-add-busca" placeholder="Digite 2 letras ou mais" />
      <div style={{ marginTop: 10, maxHeight: '45vh', overflow: 'auto' }}>
        {busca.trim().length >= 2 && achados.length === 0 && <div style={{ fontSize: 12, color: C.espressoM }}>Nenhum produto ativo fora deste inventário com esse termo.</div>}
        {achados.map((p) => (
          <button key={p.id} type="button" disabled={salvando} onClick={() => void adicionar(p)} data-testid="inv-add-item"
            style={{ ...btnSec, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}>
            <strong>{p.nome}</strong> <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{p.codigo}</span> · saldo {fmtQ(Number(p.estoque_atual ?? 0))} {p.unidade}
          </button>
        ))}
      </div>
    </Moldura>
  )
}
