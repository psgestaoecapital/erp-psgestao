// Gate (#2167 Gean): a ficha da OS mostra quando a NF-e/NFS-e já foi emitida (botão VERDE) e abre o PDF dali mesmo.
// Prova a regra de qual nota a OS mostra (autorizada > mais recente; cancelada/denegada não conta) e que os dois
// botões da OS usam o estado da nota em vez de oferecer só "Emitir"; e que a NF-e de OS rejeitada se reenvia a partir
// da lista de NF-es emitidas (abre a OS). Sem rede.
import { readFileSync } from 'node:fs'
import { escolherNotaDaOS, notaJaEmitida, type NotaDaOS } from '../../src/lib/fiscal/notaDaOS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const n = (id: string, status: string, criado_em: string): NotaDaOS => ({
  id, status, criado_em, numero: id, data_emissao: null, pdf_url: null, doc: null, razao: null, motivo_rejeicao: null,
})

ok(escolherNotaDaOS([]) === null, 'OS sem nota → null (mostra "Emitir")')
ok(escolherNotaDaOS([n('a', 'rejeitada', '2026-10-01'), n('b', 'autorizada', '2026-09-01'), n('c', 'rejeitada', '2026-10-02')])?.id === 'b',
  'autorizada vence rejeitadas mais novas (reenvio rejeitado depois da autorizada não apaga o verde)')
ok(escolherNotaDaOS([n('a', 'autorizada', '2026-10-01'), n('b', 'autorizada', '2026-10-05')])?.id === 'b', 'duas autorizadas → a mais recente')
ok(escolherNotaDaOS([n('a', 'rejeitada', '2026-10-01'), n('b', 'processando', '2026-10-05')])?.id === 'b', 'sem autorizada → a mais recente (processando)')
ok(escolherNotaDaOS([n('a', 'cancelada', '2026-10-01'), n('b', 'denegada', '2026-10-05')]) === null, 'cancelada/denegada não contam como emitida')
ok(notaJaEmitida(n('a', 'autorizada', 'x')) && notaJaEmitida(n('a', 'processando', 'x')), 'autorizada/processando trocam o botão de emitir pelo estado')
ok(!notaJaEmitida(n('a', 'rejeitada', 'x')) && !notaJaEmitida(null), 'rejeitada/sem nota seguem com o botão de emitir (reenvio pela OS)')

const comp = readFileSync('src/components/comum/NotaFiscalDaOS.tsx', 'utf8')
ok(/\.eq\('os_id', osId\)\.eq\('company_id', companyId\)/.test(comp), 'busca a nota pela OS E pela empresa')
ok(/fn_fiscal_get_storage_url/.test(comp) && /nomeArquivoNota/.test(comp), 'PDF sai do link do provedor ou do arquivo guardado, com o nome do cliente (#2957)')
ok(/data-testid=\{`os-\$\{tipo\}-emitida`\}/.test(comp), 'botão verde "abrir PDF" com data-testid os-<tipo>-emitida')

for (const [arq, tipo] of [['src/components/comum/EmitirNFeOSButton.tsx', 'nfe'], ['src/components/comum/EmitirNFSeOSButton.tsx', 'nfse']] as const) {
  const s = readFileSync(arq, 'utf8')
  ok(s.includes(`useNotaDaOS('${tipo}', osId, companyId)`), `${arq}: lê a nota da OS`)
  ok(s.includes(`<NotaDaOSStatus tipo="${tipo}"`), `${arq}: mostra o estado da nota (verde/âmbar) no lugar do "Emitir"`)
  ok(/recarregar\(\)/.test(s), `${arq}: recarrega o estado depois de emitir`)
}

// item 3 do #2167: NF-e de OS rejeitada → "Corrigir e reenviar" da lista de NF-es abre a própria OS (onde o botão vira "Reenviar")
const lista = readFileSync('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', 'utf8')
ok(/select\('finalidade, chave_referenciada, os_id'\)/.test(lista), 'NF-es emitidas: o reenvio lê a OS de origem da nota')
ok(lista.includes("router.push(`/dashboard/os?os=${nota.os_id}`)"), 'NF-es emitidas: nota de OS rejeitada abre a OS para reenviar')

if (falhas) { console.error(`check-os-nota-emitida: ${falhas} falha(s)`); process.exit(1) }
console.log('check-os-nota-emitida: ok')
