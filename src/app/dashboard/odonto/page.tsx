import Link from 'next/link';
import { CalendarDays, ClipboardList, FileText, ShieldCheck, Package, ArrowRight } from 'lucide-react';

const mods = [
  { href: '/dashboard/odonto/agenda', t: 'Agenda de Pacientes', d: 'Agenda inteligente por cadeira, com previsão de faltas.', Icon: CalendarDays },
  { href: '/dashboard/odonto/prontuario', t: 'Prontuário + Odontograma', d: 'Ficha clínica com odontograma e registro por voz.', Icon: ClipboardList },
  { href: '/dashboard/odonto/tratamento', t: 'Plano & Orçamento', d: 'Planos, orçamentos e fechamento assistido.', Icon: FileText },
  { href: '/dashboard/odonto/convenios', t: 'Convênios / TISS', d: 'Faturamento de convênios e controle de glosa.', Icon: ShieldCheck },
  { href: '/dashboard/odonto/materiais', t: 'Materiais & Próteses', d: 'Estoque clínico e controle de protético.', Icon: Package },
];

export default function Page() {
  return (
    <div className="min-h-[calc(100vh-120px)] bg-[#FAF7F2] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[#8A7765]">Clínica Odontológica</p>
        <h1 className="mt-1 text-2xl font-semibold text-[#3D2314] md:text-3xl">Sua clínica no PS Gestão</h1>
        <p className="mt-2 max-w-xl text-sm text-[#8A7765]">Gestão do processo clínico com IA. O financeiro fica na área Gestão Empresarial.</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {mods.map((m) => (
            <Link key={m.href} href={m.href} className="group rounded-2xl border border-[#E7DDCF] bg-[#FFFDFA] p-5 shadow-[0_8px_24px_rgba(61,35,20,0.05)] transition hover:border-[#C8941A]">
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#F6ECD6] text-[#C8941A]"><m.Icon size={22} strokeWidth={1.8} /></div>
                <div className="flex-1">
                  <p className="font-semibold text-[#3D2314]">{m.t}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#8A7765]">{m.d}</p>
                </div>
                <ArrowRight size={18} className="text-[#C9B9A6] transition group-hover:text-[#C8941A]" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
