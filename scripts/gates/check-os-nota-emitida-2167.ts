// Gate (chamado #2167, Gean): na OS, a nota já emitida fica verde e abre o PDF; recusada mantém o botão (reenvio).
// Regra pura em src/lib/fiscal/notaDaOS.ts; a tela é NotaDaOS e a OS usa ela nos dois botões. Sem rede.
import { readFileSync } from 'node:fs'
import { estadoNotaOS } from '../../src/lib/fiscal/notaDaOS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const nfe = estadoNotaOS('nfe', { numero: '394', status: 'autorizada', danfe_url: 'https://api.focusnfe.com.br/danfe.pdf', motivo_rejeicao: null })
ok(nfe.fase === 'emitida' && nfe.pdf === 'https://api.focusnfe.com.br/danfe.pdf' && nfe.numero === '394', 'NF-e autorizada → verde com o PDF (DANFE)')
const nfse = estadoNotaOS('nfse', { numero: '129', status: 'autorizada', pdf_url: 'https://focusnfe.s3.sa-east-1.amazonaws.com/n.pdf', motivo_rejeicao: null })
ok(nfse.fase === 'emitida' && nfse.pdf?.endsWith('n.pdf') === true, 'NFS-e autorizada → verde com o PDF da prefeitura')
const semPdf = estadoNotaOS('nfe', { numero: '1', status: 'autorizada', danfe_url: null, motivo_rejeicao: null })
ok(semPdf.fase === 'emitida' && semPdf.pdf === null, 'autorizada sem PDF ainda → verde, "PDF sendo gerado"')
const js = estadoNotaOS('nfe', { numero: '1', status: 'autorizada', danfe_url: 'javascript:alert(1)', motivo_rejeicao: null })
ok(js.fase === 'emitida' && js.pdf === null, 'link que não é http(s) não vira href')
ok(estadoNotaOS('nfe', { numero: null, status: 'processando', motivo_rejeicao: null }).fase === 'processando', 'em processamento → não oferece emitir de novo')
const rej = estadoNotaOS('nfe', { numero: null, status: 'rejeitada', motivo_rejeicao: 'NCM inválido' })
ok(rej.fase === 'emitir' && rej.recusa === 'NCM inválido', 'recusada → mantém o botão de emitir e mostra o motivo')
const nada = estadoNotaOS('nfse', undefined)
ok(nada.fase === 'emitir' && nada.recusa === null, 'sem nota → botão de emitir normal')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(/<NotaDaOS\s+tipo="nfse"/.test(card) && /<NotaDaOS\s+tipo="nfe"/.test(card), 'a OS usa NotaDaOS para NFS-e e NF-e')
const tela = readFileSync('src/components/comum/NotaDaOS.tsx', 'utf8')
ok(/\.eq\('os_id', osId\)/.test(tela) && /estadoNotaOS\(/.test(tela), 'NotaDaOS lê a nota pelo os_id e usa a regra pura')
ok(/target="_blank"/.test(tela) && /rel="noopener noreferrer"/.test(tela), 'PDF abre em outra aba com noopener')
const mig = readFileSync('supabase/migrations/20261009233020_os_nota_emitida_ajuda.sql', 'utf8')
for (const ch of ['os.nfe.emitida', 'os.nfe.processando', 'os.nfse.emitida', 'os.nfse.processando'])
  ok(mig.includes(`'${ch}'`), `chave de ajuda ${ch} cadastrada (RD-95)`)
if (falhas) process.exit(1)
