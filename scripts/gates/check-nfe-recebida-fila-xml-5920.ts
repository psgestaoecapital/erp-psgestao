// Gate (#5920): a rotina de baixar XML de NF-e recebida só enfileira empresas com Focus ATIVO (evita que
// notas sem token — ex.: DEMO — façam starvation da fila) e a tela mostra "Subir XML" desde a 1ª falha.
// Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// edge worker
const edge = readFileSync('supabase/functions/nfe-baixar-xml-pendentes/index.ts', 'utf8')
const ef = edge.replace(/\s+/g, ' ')
ok(ef.includes("from(\"erp_fiscal_provider_config\")") && ef.includes('.eq("provider", "focusnfe")') && ef.includes('.eq("ativo", true)'), 'edge: lê empresas com Focus ativo')
ok(ef.includes('.in("company_id", comFocus)'), 'edge: fila só das empresas com Focus (sem starvation da DEMO/sem-token)')
ok(ef.includes('nenhuma_empresa_com_focus'), 'edge: curto-circuita quando não há empresa com Focus')
ok(edge.includes('.lt("xml_tentativas", TETO_TENTATIVAS)'), 'edge: respeita o teto de tentativas')

// tela
const tela = readFileSync('src/app/dashboard/compras/documentos-recebidos/page.tsx', 'utf8')
const tf = tela.replace(/\s+/g, ' ')
ok(tf.includes("n.status === 'aguardando_xml' ?"), 'tela: ramo de aguardando XML')
ok(tf.includes('(n.xml_tentativas ?? 0) >= 1 && ( <UploadXmlRecebidaButton'), 'tela: "Subir XML" desde a 1ª falha (xml_tentativas >= 1)')

if (falhas) process.exit(1)
console.log('check-nfe-recebida-fila-xml-5920 OK')
