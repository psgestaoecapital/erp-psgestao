// Gate (auditor 24/10 · gap "Despesas da viagem … com foto do comprovante"): o cupom vai para um bucket PRIVADO novo,
// separado por empresa na 1ª pasta, lido só por quem é da empresa e enviado só por quem pode gravar viagem (perfil de
// consulta não); sem UPDATE/DELETE. A tela grava o caminho no anexo_path pela fn_viagem_lancamento_salvar e abre por
// link assinado curto. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_comprovante_foto.sql'))
if (!arq) throw new Error('migration *_viagem_comprovante_foto.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')

ok(/VALUES \('viagens-comprovantes', 'viagens-comprovantes', false, 10485760,/.test(mig), 'bucket privado, até 10 MB')
ok(/FOR SELECT TO authenticated\s+USING \(bucket_id = 'viagens-comprovantes' AND \(storage\.foldername\(name\)\)\[1\] IN \(SELECT public\.get_user_company_ids\(\)::text\)\)/.test(mig), 'lê só quem é da empresa da 1ª pasta')
ok(/FOR INSERT TO authenticated[\s\S]*THEN public\.fn_viagem_pode_gravar\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\) ELSE false END/.test(mig), 'envia só quem pode gravar viagem na empresa (consulta não)')
ok(!/FOR (UPDATE|DELETE|ALL)/.test(mig) && !/\bTO\s+(anon|public)\b(?!\.)/i.test(mig), 'sem UPDATE/DELETE e nada para anon')
ok(!/CREATE OR REPLACE|ALTER TABLE|DROP (TABLE|FUNCTION|VIEW)/.test(mig), 'só aditivo: nenhuma função/view/tabela existente muda')
ok(["'projetos.viagem.lanc_comprovante'", "'projetos.viagem.ver_comprovante'"].every((c) => mig.includes(c)), '"?" (RD-95) dos campos novos no banco')

const comp = readFileSync('src/app/dashboard/projetos/viagens/Comprovante.tsx', 'utf8')
ok(comp.includes("BUCKET_COMPROVANTE = 'viagens-comprovantes'") && comp.includes('`${empresa}/${viagemId}/${crypto.randomUUID()}.${ext}`'), 'caminho <empresa>/<viagem>/<arquivo único>')
ok(comp.includes('upsert: false') && comp.includes('createSignedUrl(path, 300)') && !/getPublicUrl/.test(comp), 'não sobrescreve; abre por link assinado de 5 min')
ok(comp.includes('chave="projetos.viagem.lanc_comprovante"') && comp.includes('chave="projetos.viagem.ver_comprovante"'), 'tela: "?" nos dois campos')
const page = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
ok(page.includes("p_dados: { ...lf, anexo_path: anexo }") && page.includes(',anexo_path\').eq(\'viagem_id\''), 'lançamento grava e lê o anexo_path')
ok(page.includes('<CampoComprovante') && page.includes('<VerComprovante path={l.anexo_path} />'), 'campo no formulário e link na lista')
if (falhas) process.exit(1)
