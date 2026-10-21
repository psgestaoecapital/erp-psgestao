/**
 * Gate de build · chamado #2167 (complemento · Jordana · Gean, todas as mecânicas): na LISTA de OS, etiquetas da nota
 * (verde NF-e/NFS-e ✓ · azul "NF fora da OS" · amarelo "NF pendente" · vermelho rejeitada · cinza processando/anterior
 * ao controle), filtro "NF pendente", data de corte por empresa e marcação "NF fora da OS" na ficha.
 * Regra em src/lib/oficina/osNotaLista.ts; dados numa chamada agregada (fn_os_nf_situacao) para a lista não ficar lenta.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { etiquetasNF, nfPendente, passaFiltroNF, anteriorAoControle, type SituacaoNFItem } from '../../src/lib/oficina/osNotaLista'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const CORTE = '2026-10-01'
const base = (p: Partial<SituacaoNFItem>): SituacaoNFItem => ({
  os_id: 'x', data_ref: '2026-10-10', tem_valor: true, nfe: [], nfse: [], processando: false, rejeitada: false, fora: null, ...p,
})
const fora = (p: Partial<NonNullable<SituacaoNFItem['fora']>> = {}) => ({
  tipo: null, numero: null, data_nota: null, chave: null, pdf_url: null, observacao: null, nfe_id: null, nfse_id: null, marcado_em: null, ...p,
})

// Critério 1 — padrão real: OS-2026-0156 (FC Pisos na Gean) com NF-e 656 e NFS-e 132
const fc = base({ nfe: [{ id: 'n656', numero: '656' }], nfse: [{ id: 's132', numero: '132' }], data_ref: '2026-10-06' })
const eFc = etiquetasNF('entregue', fc, CORTE)
ok(eFc.map((e) => e.texto).join(' | ') === 'NF-e 656 ✓ | NFS-e 132 ✓', 'OS com NF-e 656 e NFS-e 132 → duas etiquetas verdes')
ok(eFc.every((e) => e.cor === 'verde' && e.abrir), 'etiquetas verdes abrem o PDF da nota')
ok(!nfPendente('entregue', fc, CORTE) && passaFiltroNF('emitida', 'entregue', fc, CORTE), 'OS com nota autorizada não é pendente e entra em "NF emitida"')

// Critério 2 — entregue depois do corte, com valor, sem nota → NF pendente
const pend = base({})
ok(etiquetasNF('entregue', pend, CORTE)[0]?.texto === 'NF pendente' && etiquetasNF('entregue', pend, CORTE)[0]?.cor === 'amarelo', 'entregue após 01/10 sem nota → "NF pendente" amarelo')
ok(passaFiltroNF('pendente', 'entregue', pend, CORTE), 'entra no filtro "NF pendente"')
ok(nfPendente('pronta', pend, CORTE), 'OS Pronta também entra em NF pendente')
ok(!nfPendente('em_execucao', pend, CORTE), 'OS em execução não entra em NF pendente')
ok(!nfPendente('entregue', base({ tem_valor: false }), CORTE), 'OS sem valor (sem itens) não entra em NF pendente')

// Critério 3 — "NF fora da OS", com ou sem número
const semNum = base({ fora: fora() })
const comNum = base({ fora: fora({ numero: '1234', tipo: 'nfe' }) })
ok(etiquetasNF('entregue', semNum, CORTE).map((e) => `${e.cor}:${e.texto}`).join() === 'azul:NF fora da OS', 'marcada sem número → "NF fora da OS" azul')
ok(etiquetasNF('entregue', comNum, CORTE)[0]?.texto === 'NF fora da OS · nº 1234', 'marcada com número → "NF fora da OS · nº 1234"')
ok(!passaFiltroNF('pendente', 'entregue', semNum, CORTE) && !passaFiltroNF('pendente', 'entregue', comNum, CORTE), 'marcada sai do filtro "NF pendente"')
ok(passaFiltroNF('fora', 'entregue', semNum, CORTE), 'marcada entra no filtro "NF fora da OS"')
const vinc = etiquetasNF('entregue', base({ fora: fora({ numero: '640', nfe_id: 'n640' }) }), CORTE)[0]
ok(vinc?.abrir?.tipo === 'nfe' && vinc.abrir.id === 'n640', 'vinculada a nota do sistema → o toque abre o PDF dela')
ok(etiquetasNF('entregue', base({ fora: fora({ pdf_url: 'https://exemplo/nota.pdf' }) }), CORTE)[0]?.link === 'https://exemplo/nota.pdf', 'com link do PDF → o toque abre o link')

// Critério 4 — antes do corte: "anterior ao controle", sem alerta
const antiga = base({ data_ref: '2026-09-20' })
ok(anteriorAoControle(antiga, CORTE) && !nfPendente('entregue', antiga, CORTE), 'OS de antes de 01/10 não é pendente')
ok(etiquetasNF('entregue', antiga, CORTE).map((e) => `${e.cor}:${e.texto}`).join() === 'cinza:anterior ao controle', 'OS de antes de 01/10 → "anterior ao controle" cinza')
ok(nfPendente('entregue', antiga, null), 'empresa sem data de corte controla todas as OS')

// rejeitada / processando
ok(etiquetasNF('entregue', base({ rejeitada: true }), CORTE)[0]?.cor === 'vermelho' && nfPendente('entregue', base({ rejeitada: true }), CORTE), 'só rejeitada → "NF rejeitada" vermelho e continua pendente')
ok(etiquetasNF('entregue', base({ processando: true }), CORTE)[0]?.texto === 'NF processando' && !nfPendente('entregue', base({ processando: true }), CORTE), 'processando → cinza e fora do pendente')
ok(etiquetasNF('entregue', undefined, CORTE).length === 0, 'OS sem situação (fora do controle) → sem etiqueta')

// Tela, ficha e banco
const tela = readFileSync('src/app/dashboard/os/page.tsx', 'utf8')
ok(tela.includes("supabase.rpc('fn_os_nf_situacao'"), 'lista lê a situação numa chamada agregada (rápida com 200 OS)')
ok(!/from\('erp_nfe_emitidas'\)/.test(tela), 'lista não lê notas OS a OS')
ok(tela.includes('data-testid={`os-filtro-nota-${k}`}') && tela.includes("['pendente', 'NF pendente']"), 'filtro "NF pendente" na lista')
ok(tela.includes('<OSNotaEtiquetas') && tela.includes('data-testid="os-nf-corte"'), 'lista mostra as etiquetas e a data de corte')
for (const k of ['os.filtro.nf_pendente', 'os.nf_corte']) ok(tela.includes(`chave="${k}"`), `"?" ${k} na lista (RD-95)`)
ok(readFileSync('src/components/comum/OSNotaEtiquetas.tsx', 'utf8').includes('chave="os.lista.nota_fiscal"'), '"?" nas etiquetas (RD-95)')
const ficha = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(ficha.includes('<OSNFForaDaOS'), 'ficha da OS tem o botão "NF fora da OS"')
const fora2 = readFileSync('src/components/comum/OSNFForaDaOS.tsx', 'utf8')
ok(fora2.includes("rpc('fn_os_nf_fora_marcar'") && fora2.includes("rpc('fn_os_nf_fora_desmarcar'") && fora2.includes("rpc('fn_os_nf_notas_sem_os'"), 'marcação grava só pelas funções com guarda')
const chavesFicha = ['os.nf_fora.marcar', 'os.nf_fora.tipo', 'os.nf_fora.numero', 'os.nf_fora.data', 'os.nf_fora.chave', 'os.nf_fora.pdf', 'os.nf_fora.observacao', 'os.nf_fora.vincular']
for (const k of chavesFicha) ok(fora2.includes(`chave="${k}"`), `"?" ${k} na marcação (RD-95)`)

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
for (const k of ['os.lista.nota_fiscal', 'os.filtro.nf_pendente', 'os.nf_corte', ...chavesFicha])
  ok(migs.some((t) => t.includes(`('${k}'`)), `chave ${k} cadastrada em erp_ajuda_campo por migration`)
const mig = migs.find((t) => t.includes('CREATE TABLE IF NOT EXISTS public.erp_os_nf_fora')) ?? ''
ok(/erp_os_nf_fora ENABLE ROW LEVEL SECURITY/.test(mig) && /erp_os_nf_controle ENABLE ROW LEVEL SECURITY/.test(mig), 'tabelas novas com RLS')
ok(/REVOKE ALL ON public\.erp_os_nf_fora, public\.erp_os_nf_controle FROM PUBLIC, anon, authenticated/.test(mig), 'escrita fechada (só pelas funções)')
ok((mig.match(/get_user_company_ids\(\)\) OR is_admin\(\)\)/g) ?? []).length >= 5, 'as 5 funções conferem a empresa do usuário')
ok(/DATE '2026-10-01'/.test(mig) && mig.includes('a462e13f-0f51-4c54-abe8-4474b591633b'), 'Gean com controle desde 01/10/2026')
ok(!/UPDATE\s+(public\.)?erp_nf(s)?e_emitidas/i.test(mig), 'não altera nenhuma nota emitida')

if (falhas) { console.error(`\n${falhas} falha(s) no gate da NF na lista de OS (#2167)`); process.exit(1) }
console.log('✓ #2167: lista de OS com etiquetas da NF, filtro NF pendente, NF fora da OS e data de corte')
