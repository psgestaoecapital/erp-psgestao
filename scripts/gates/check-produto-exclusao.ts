// Gate (chamado #3856 · botão excluir produto): exclusão LÓGICA com bloqueio por vínculo. Roda no build. Sem rede nem banco.
// Regras puras pela função da lib (contador falso) + travas do código da rota e da tela.
import { readFileSync } from 'node:fs'
import { listarVinculosProduto, mensagemBloqueio, ALVOS_VINCULO_PRODUTO, type AlvoVinculo } from '../../src/lib/produtos/vinculosProduto'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

async function main() {
  // 1) sem nenhum uso → lista vazia (a exclusão é liberada)
  const zero = await listarVinculosProduto(async () => 0)
  ok(zero.length === 0, 'sem vínculo em nenhum alvo → nenhum bloqueio')

  // 2) com uso em alguns alvos → só os que têm registro, na ordem da lista
  const usos: Record<string, number> = { erp_pedidos_itens: 2, erp_estoque_movimentacoes: 5, erp_nfe_emitidas: 1 }
  const com = await listarVinculosProduto(async (a: AlvoVinculo) => usos[a.tabela] ?? 0)
  ok(com.length === 3, 'três alvos com uso → três vínculos')
  // pedidos (2) vem antes de NF-e emitida (1), que vem antes de estoque (5), na ordem da lista
  ok(com.map((v) => v.total).join(',') === '2,1,5', 'vínculos mantêm a ordem da lista de alvos')
  ok(com.some((v) => v.rotulo === 'Notas fiscais emitidas (NF-e e NFC-e)' && v.total === 1), 'NF-e emitida (itens em JSON) conta como vínculo')

  // 3) a mensagem diz o alvo e o total, e aponta a saída (inativar), sem prometer exclusão
  const msg = mensagemBloqueio(com)
  ok(msg.includes('Pedidos de venda (2)') && msg.includes('Movimentações de estoque (5)'), 'mensagem de bloqueio cita cada alvo e o total')
  ok(msg.includes('Inative o produto'), 'mensagem de bloqueio orienta a inativar')

  // 4) o contador é chamado uma vez por alvo (sem varredura por linha)
  let chamadas = 0
  await listarVinculosProduto(async () => { chamadas++; return 0 })
  ok(chamadas === ALVOS_VINCULO_PRODUTO.length, 'uma contagem por alvo, nada por linha')

  // 5) histórico de preço e de-para de fornecedor NÃO bloqueiam (a inativação preserva esses dados)
  const tabelas = new Set(ALVOS_VINCULO_PRODUTO.map((a) => a.tabela))
  ok(!tabelas.has('erp_preco_historico') && !tabelas.has('erp_produto_depara_fornecedor'), 'histórico de preço e de-para de fornecedor fora do bloqueio')

  // 6) rota: exclusão é UPDATE de ativo, nunca DELETE na tabela de produtos; fail-closed na contagem; guarda de empresa
  const rota = readFileSync('src/app/api/cadastros/produtos/route.ts', 'utf8')
  ok(!/from\('erp_produtos'\)\s*\.delete\(/.test(rota), 'rota não apaga erp_produtos (soft delete)')
  ok(/\.update\(\{ ativo: false \}\)/.test(rota), 'exclusão grava ativo = false')
  ok(/export const DELETE = exigirLogin/.test(rota) && /export const GET = exigirLogin/.test(rota), 'GET e DELETE protegidos por exigirLogin')
  ok((rota.match(/exigirEmpresas\(u, \[/g) ?? []).length >= 4, 'GET e DELETE conferem a empresa do usuário')
  ok(/if \(error\) throw new Error\(`Não foi possível verificar vínculos/.test(rota), 'erro na contagem propaga (fail-closed)')
  ok(/status: 409/.test(rota), 'produto com vínculo responde 409 com o motivo')

  // 7) tela e modal: lixeira nas duas visões, modal ligado, "?" no modal
  const tela = readFileSync('src/app/dashboard/cadastros/produtos/page.tsx', 'utf8')
  ok(tela.includes('data-testid="produto-excluir"') && tela.includes('data-testid="produto-excluir-mobile"'), 'lixeira na coluna AÇÕES (tabela e celular)')
  ok(tela.includes('<ExcluirProdutoModal') && tela.includes('carregar(true)'), 'modal ligado e lista recarrega após excluir')
  const modal = readFileSync('src/components/cadastros/ExcluirProdutoModal.tsx', 'utf8')
  ok(modal.includes('<AjudaCampo chave="cadastros.produtos.excluir"'), 'modal tem o "?" da exclusão (RD-95)')
  ok(modal.includes("method: 'DELETE'") && modal.includes('info.vinculos.length > 0'), 'modal chama DELETE e checa o bloqueio antes da confirmação')

  if (falhas) { console.error(`\n${falhas} falha(s) — check-produto-exclusao`); process.exit(1) }
  console.log('\ncheck-produto-exclusao: ok')
}

main().catch((e) => { console.error(e); process.exit(1) })
