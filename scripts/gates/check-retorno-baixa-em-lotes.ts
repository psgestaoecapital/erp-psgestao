// Gate (#4909, Gean): a baixa pelo RETORNO de pagamentos estourava o limite de 8 s do banco (10 pagamentos numa
// transação, ~0,5–1,5 s cada) e não baixava nada. A tela confirma em lotes pequenos e soma os resultados.
// Estático, sem rede: prova o fatiamento, a soma e a mensagem clara, e confere que a tela usa os lotes.
import { readFileSync } from 'node:fs'
import { fatiarRetorno, somarRespostasRetorno, mensagemErroRetorno, TAMANHO_LOTE_RETORNO, type RespostaRetorno } from '../../src/lib/financeiro/retornoLotes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// 1) fatiamento: 10 e 100 pagamentos, nenhum lote acima do teto, nada perdido nem repetido, ordem mantida
for (const n of [10, 55, 100]) {
  const itens = Array.from({ length: n }, (_, i) => ({ codigo_barras: String(1000 + i), i }))
  const lotes = fatiarRetorno(itens)
  ok(lotes.every((l) => l.length >= 1 && l.length <= TAMANHO_LOTE_RETORNO), `${n} pagamentos: todo lote tem 1..${TAMANHO_LOTE_RETORNO}`)
  ok(lotes.flat().map((x) => x.i).join() === itens.map((x) => x.i).join(), `${n} pagamentos: nenhum perdido/repetido, ordem mantida`)
}
ok(TAMANHO_LOTE_RETORNO <= 4, 'lote pequeno (pior caso medido ~1,5 s por baixa × lote < 8 s)')
// mesmo código de barras (com ou sem pontuação) fica no mesmo lote
const dup = fatiarRetorno([{ codigo_barras: '111' }, { codigo_barras: '222' }, { codigo_barras: '333' }, { codigo_barras: '1.1-1' }, { codigo_barras: '' }])
ok(dup.some((l) => l.filter((x) => x.codigo_barras.replace(/\D/g, '') === '111').length === 2), 'linhas com o mesmo código de barras ficam no mesmo lote')
ok(dup.flat().length === 5, 'linha sem código de barras não some')

// 2) soma das respostas no formato da RPC
const r = (pagos: number, ja: number, erros = 0, erro?: string): RespostaRetorno => ({
  ok: true, confirmado: true, erro,
  casados: Array.from({ length: pagos }, () => ({})), ja_pagos: Array.from({ length: ja }, () => ({})),
  resumo: { total: pagos + ja + erros, pagos, agendados: 0, rejeitados: 0, ja_pagos: ja, erros, nao_casados: 0, nao_reconhecidos: 0 },
})
const msg = mensagemErroRetorno('canceling statement due to statement timeout')
const s = somarRespostasRetorno([r(3, 0), r(2, 1), r(0, 0, 1, msg), r(0, 0, 1, msg)])
ok(s.ok === true && s.confirmado === true, 'soma: ok e confirmado')
ok(s.resumo?.total === 8 && s.resumo?.pagos === 5 && s.resumo?.ja_pagos === 1 && s.resumo?.erros === 2, 'soma: resumo somado (8 total, 5 pagos, 1 já baixado, 2 c/ erro)')
ok(s.qtd_casados === 5 && (s.casados ?? []).length === 5, 'soma: listas concatenadas')
ok(s.erro === msg, 'soma: mensagem de erro repetida aparece uma vez só')
ok(somarRespostasRetorno<RespostaRetorno>([]).ok === false, 'soma vazia não é sucesso')

// 3) mensagem compreensível no lugar do texto técnico do banco
ok(!/statement timeout/i.test(msg) && /já baixado/.test(msg), 'timeout vira mensagem clara (reimportar não duplica)')
ok(mensagemErroRetorno('outro erro') === 'outro erro', 'erro de negócio da RPC passa como está')

// 4) a tela confirma em lotes (não manda o arquivo inteiro numa chamada só)
const src = readFileSync('src/app/dashboard/financeiro/remessa-pagamento/page.tsx', 'utf8')
const conf = src.slice(src.indexOf('async function confirmarImportar'), src.indexOf('// ── Gestão da remessa'))
ok(/fatiarRetorno\(itens\)/.test(conf), 'confirmar percorre fatiarRetorno(itens)')
ok(/p_itens: lote, p_confirmar: true/.test(conf) && !/p_itens: itensDoRet\(impRet\), p_confirmar: true/.test(conf), 'cada chamada de confirmação leva só um lote')
ok(/somarRespostasRetorno\(resps\)/.test(conf), 'resultado dos lotes é somado')
ok(/mensagemErroRetorno\(/.test(conf), 'erro mostrado com mensagem clara')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
