import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export default function TermosPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <BackLink />
        <div>
          <h1 className="text-xl font-semibold text-o2-navy">Termos de Uso e Política de Privacidade</h1>
          <p className="mt-1 text-sm text-gray-500">Workspace O2 — O2 Seguros</p>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-gray-700">
          <p>
            Este Workspace O2 ("Ferramenta") é oferecido pela O2 Seguros
            ("O2", "nós") para uso por imobiliárias e administradoras de locação parceiras
            ("Usuário", "você"), com a finalidade de auxiliar na montagem de contratos de
            locação que incluam corretamente as cláusulas de garantia locatícia exigidas por
            cada seguradora e produto.
          </p>

          <h2 className="font-semibold text-o2-navy">1. Cadastro e conta</h2>
          <p>
            Cada conta representa uma imobiliária/administradora e é de uso restrito dessa
            empresa. Você é responsável por manter a confidencialidade da sua senha e por toda
            atividade realizada na sua conta.
          </p>

          <h2 className="font-semibold text-o2-navy">2. Dados pessoais tratados</h2>
          <p>
            Para gerar os contratos, a Ferramenta armazena dados da sua conta (nome da
            imobiliária, CNPJ, CRECI, endereço, telefone, e-mail) e dados inseridos por você
            sobre locadores e locatários (nome, CPF, RG, estado civil, profissão, endereço),
            que são <strong>dados pessoais de terceiros</strong> tratados em seu nome, na forma
            da Lei nº 13.709/2018 (LGPD).
          </p>
          <p>
            Você declara ter a base legal e o consentimento necessários dos locadores e
            locatários para inserir esses dados na Ferramenta, e se responsabiliza pela
            exatidão das informações fornecidas.
          </p>
          <p>
            Se você usar a funcionalidade <strong>Auditar contrato</strong>, o texto do
            contrato que você colar ou enviar (que pode conter dados pessoais de locadores e
            locatários, como nome, CPF e RG) é processado por um provedor de inteligência
            artificial (Anthropic, responsável pelo modelo Claude) exclusivamente para gerar o
            relatório de auditoria solicitado por você, e não é usado para treinar modelos de
            IA de terceiros.
          </p>

          <h2 className="font-semibold text-o2-navy">3. Isolamento e segurança dos dados</h2>
          <p>
            Os dados de cada conta (imobiliária, contratos gerados) são isolados e visíveis
            apenas para essa própria conta. A biblioteca de cláusulas de garantia é mantida
            centralmente pela O2 e compartilhada entre todas as contas, sem dados pessoais.
          </p>

          <h2 className="font-semibold text-o2-navy">4. Finalidade e uso dos dados</h2>
          <p>
            Os dados são usados exclusivamente para gerar os contratos e as auditorias
            solicitadas por você, e para manter o histórico da sua conta. Não vendemos nem
            compartilhamos esses dados com terceiros fora do necessário para a operação da
            Ferramenta (ex.: provedores de hospedagem, banco de dados e, no caso da auditoria
            de contratos, o provedor de inteligência artificial citado no item 2).
          </p>

          <h2 className="font-semibold text-o2-navy">5. Seus direitos (e dos titulares dos dados inseridos)</h2>
          <p>
            Nos termos da LGPD, é possível solicitar confirmação, acesso, correção,
            anonimização ou eliminação de dados pessoais tratados na Ferramenta. Solicitações
            podem ser feitas pelo e-mail{" "}
            <a href="mailto:comercial@o2seguros.com.br" className="text-o2-navy underline">
              comercial@o2seguros.com.br
            </a>
            .
          </p>

          <h2 className="font-semibold text-o2-navy">6. Limitação de responsabilidade</h2>
          <p>
            A Ferramenta monta o texto do contrato combinando o texto-base fornecido pela sua
            imobiliária com as cláusulas de garantia mantidas pela O2. É responsabilidade da
            imobiliária revisar o contrato final antes de utilizá-lo, incluindo a exatidão dos
            dados da locação e a adequação ao caso concreto.
          </p>

          <h2 className="font-semibold text-o2-navy">7. Alterações</h2>
          <p>
            Estes termos podem ser atualizados; alterações relevantes serão comunicadas aos
            usuários cadastrados.
          </p>

          <p className="pt-4 text-xs text-gray-400">
            Última atualização: julho de 2026. Dúvidas: comercial@o2seguros.com.br.
          </p>
        </div>

        <Link href="/signup" className="inline-block text-sm text-o2-navy underline">
          ← Voltar para o cadastro
        </Link>
      </main>
    </>
  );
}
