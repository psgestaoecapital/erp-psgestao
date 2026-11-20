// Gate EHS Arquivo morto (CEO 15/10): exclusão física bloqueada em todo o EHS, log append-only, acesso por papel.
import { readFileSync, readdirSync } from 'node:fs'

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_ehs_arquivo_morto_base.sql'))
const erros: string[] = []
if (!arq) erros.push('migration *_ehs_arquivo_morto_base.sql sumiu')
else {
  const sql = readFileSync(`${dir}/${arq}`, 'utf8')
  const exige = (re: RegExp, msg: string) => { if (!re.test(sql)) erros.push(msg) }
  exige(/BEFORE DELETE ON public\.%I/, 'trigger BEFORE DELETE em todas as tabelas EHS')
  exige(/\^\(compliance_\|epi_\|nr36_\)/, 'loop deve cobrir compliance_/epi_/nr36_')
  exige(/app\.permitir_delete_fisico/, 'bypass de manutenção (mesmo da RD-30) ausente')
  exige(/append-only/, 'ehs_arquivo_evento deve ser append-only')
  exige(/ENABLE ROW LEVEL SECURITY/, 'RLS ligada em ehs_arquivo_evento')
  exige(/fn_ehs_arquivo_pode/, 'guarda de papel SST/gestão')
  exige(/'consulta_lista'/, 'consulta da lista deve ser registrada (LGPD)')
  exige(/fn_ehs_reativar_funcionario/, 'reativação sem perder histórico')
  for (const f of ['fn_ehs_arquivar_funcionario', 'fn_ehs_reativar_funcionario', 'fn_ehs_arquivo_listar'])
    exige(new RegExp(`FUNCTION public\\.${f}[\\s\\S]*?SECURITY DEFINER SET search_path`), `${f} precisa de SECURITY DEFINER + search_path fixo`)
  exige(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon/, 'REVOKE de anon nas RPCs')
  if (/\bDELETE\s+FROM\b/i.test(sql.replace(/--.*$/gm, ''))) erros.push('a migration não pode apagar dado')
}
if (erros.length) { console.error('check-ehs-arquivo-morto FALHOU:\n' + erros.join('\n')); process.exit(1) }
console.log('check-ehs-arquivo-morto ok')
