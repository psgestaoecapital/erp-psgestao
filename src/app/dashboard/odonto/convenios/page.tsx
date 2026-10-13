import OdontoEmptyState from '@/components/odonto/OdontoEmptyState';
import { ShieldCheck } from 'lucide-react';

export default function Page() {
  return (
    <OdontoEmptyState
      eyebrow="Clínica Odontológica · Processo"
      title="Convênios / TISS"
      subtitle="Faturamento de convênios sem dor de cabeça."
      Icon={ShieldCheck}
      cta="Cadastrar convênio"
      features={[
        { title: 'Cadastro de convênios', desc: 'Tabelas, procedimentos e regras por operadora.' },
        { title: 'Guias TISS', desc: 'Geração e envio das guias no padrão TISS.' },
        { title: 'Controle de glosa', desc: 'Veja onde a glosa acontece e por quê — antes de perder.' },
        { title: 'Repasses', desc: 'Acompanhe o que cada convênio deve e quando paga.' },
      ]}
    />
  );
}
