# Visualizador QElectroTech (só leitura)

Página que abre ficheiros `.qet` no próprio browser — o ficheiro nunca é enviado nem alterado.

- Desenha as folhas (elementos, condutores, texto, formas, imagens, moldura e a legenda do projecto).
- **Referências cruzadas**: mestre ↔ contactos, reports de folha; clicar salta para o elemento (mesmo noutra folha), com botão «Voltar».
- **Notas** por projecto, folha, elemento, condutor ou ponto do desenho, com **autor e data** (criação e última edição). Exportáveis em JSON e Markdown.
- Pesquisa por etiqueta, nome, informações, nº de fio, folha e notas.
- Pensado também para tablet: ☰ (folhas, pesquisa, notas), ⓘ (detalhes) e ⤢ (ecrã inteiro) escondem as barras. Atalhos `B`, `I`, `F`; `Esc` mostra as barras.
- Ligações directas: `?file=url/do/ficheiro.qet#f=3&e=<uuid>`.

## Estrutura

| Pasta | O que é |
|---|---|
| `web/` | A página (HTML/CSS/JS sem build) e `staticwebapp.config.json` |
| `api/` | API das notas partilhadas (Azure Functions + Cosmos DB) e testes |
| `dev/` | Emulador local do Azure Static Web Apps (só desenvolvimento) |

## Correr localmente

Só a página, com notas locais (ficam no browser de cada pessoa):

    python3 .claude/devserver.py 8765      # serve web/ sem cache

Com notas partilhadas e login simulado (3 utilizadores de teste, a mesma API do Azure):

    node dev/swa-emulator.js 8767 [pasta-com-ficheiros-qet]    # ficheiros em /testdata/…

Testes da API: `cd api && npm install && npm test`.

## Notas partilhadas com Microsoft 365 (tudo no plano gratuito)

Quando a página corre no **Azure Static Web Apps**, o login é o da conta Microsoft e as notas passam a ser guardadas num servidor, visíveis a todos os que abrirem o mesmo projecto. Fora do Azure (ou sem sessão) continua o modo local.

- O **nome e o email** de quem escreve vêm do login e são gravados pelo **servidor**; a página não consegue escrever uma nota em nome de outra pessoa. Cada nota guarda quem criou/quando e quem editou por último/quando.
- As notas ligam-se ao **título do projecto** + UUID dos elementos: todas as revisões do mesmo projecto partilham notas.
- Duas pessoas a editar a **mesma** nota ao mesmo tempo: ganha a última a gravar (a página sincroniza de 15 em 15 s e ao voltar ao separador).
- Qualquer pessoa autorizada pode editar e apagar notas. Notas importadas de JSON passam a ter como autor quem as importou.

### Custo: 0 €

| Peça | Plano | Limites relevantes (segundo a documentação da Microsoft) |
|---|---|---|
| Static Web Apps | **Free** | 100 GB de tráfego/mês (acima disso o site deixa de ser servido), 250 MB por ambiente, API gerida incluída, sem SLA |
| Azure Functions (a API) | incluída no Free | 1 milhão de execuções/mês grátis |
| Cosmos DB | **Free tier** (grátis para sempre) | 1000 RU/s e 25 GB; **um por subscrição** e só se escolhe ao criar a conta |
| GitHub Actions | repositório | grátis dentro das quotas do GitHub |

Este uso (poucas notas de texto) fica uma fração mínima destes limites. Criar a conta gratuita da Azure pede um cartão (a Microsoft indica que não é cobrado); convém ficar atento ao *Cost Management* no início. **O plano Standard (pago) não é preciso:** a configuração do login próprio da organização (Entra ID) só existe nele, por isso aqui usa-se o login Microsoft pré-configurado e a restrição é feita como abaixo.

### Quem pode entrar (no plano gratuito)

O login pré-configurado deixa qualquer conta Microsoft autenticar-se, não só a vossa organização. A restrição faz-se em duas camadas, ambas aplicadas **no servidor**:

1. `ALLOWED_DOMAINS=harkersolutions.com`: a API recusa (403) contas cujo email não seja desse domínio, por isso contas pessoais ou de outras empresas não leem nem escrevem notas.
2. *(opcional, mais restrito)* `REQUIRED_ROLE=equipa`: só passa quem foi convidado com esse papel (Static Web App → *Role management* → *Invite*, até 25 pessoas no plano gratuito; o convite vale 168 h). Para esconder também a própria página, trocar em `web/staticwebapp.config.json` os `allowedRoles` de `"/*"` para `["equipa"]`.

Limitação a ter presente: sem o login próprio da organização não há verificação do *tenant* no token. A camada 1 confia no email que o Azure entrega; se precisarem de garantia mais forte, usem a camada 2 (convites) ou o plano pago.

### Configurar no Azure (uma vez)

1. **Cosmos DB**: *Create → Azure Cosmos DB for NoSQL*. **Marcar «Apply Free Tier Discount»** (não se pode ligar depois). Capacidade: *Provisioned throughput*. Em *Keys* copiar a *Primary connection string*. A base `qetnotes` e o contentor `notes` (partição `/project`) são criados pela API; se preferirem criá-los à mão, usar **400 RU/s manual** (dentro dos 1000 gratuitos).
2. **Static Web App**, plano **Free**. Ligar ao repositório com `app_location = web`, `api_location = api`, `output = (vazio)`.
3. **Static Web App → Environment variables / Configuration** (definições da aplicação):

   | Nome | Valor |
   |---|---|
   | `COSMOS_CONNECTION` | connection string do Cosmos DB |
   | `ALLOWED_DOMAINS` | `harkersolutions.com` (vários, separados por vírgula) |
   | `REQUIRED_ROLE` | *(opcional)* `equipa` |

### Publicação automática (GitHub Actions)

O ficheiro `.github/workflows/azure-static-web-apps.yml` corre os testes da API em cada *push* e *pull request*, e publica (página + API) quando há *push* para `main` e os testes passam.

1. No Static Web App: *Overview → Manage deployment token* e copiar o token.
2. No GitHub: *Settings → Secrets and variables → Actions → New repository secret* com o nome `AZURE_STATIC_WEB_APPS_API_TOKEN`.
3. Se ao criar o Static Web App ligares o GitHub no portal, o Azure gera o seu próprio workflow e um segredo com outro nome; apaga o workflow gerado (ou troca o nome do segredo neste) para não publicar duas vezes.

Sem o segredo, os testes correm mas o passo «Publicar» falha. Não há ambientes de pré-visualização por *pull request*.

Todas as rotas exigem sessão; sem login o Azure redireciona para a entrada da Microsoft. **Não foi testado num Azure real** (só com o emulador e testes automáticos): na primeira publicação, verificar o login, criar uma nota e abri-la noutro browser com outra conta.

## Fidelidade ao QElectroTech

- Usa o **modelo de legenda embebido no projecto** (campos, variáveis `%title`, `%{obra}`, logótipos SVG/PNG, larguras em `px`/`%`) e as imagens da folha (escala e rotação em torno do centro, como no QET).
- Os tipos de letra do projecto (ex. *Space Mono*) são pedidos ao Google Fonts; sem rede usa a letra instalada ou uma genérica.
- O tamanho do texto segue o PDF exportado pelo QET (1 pt = 1 unidade do desenho). A numeração das colunas começa em 1, como nos PDF do projecto.
- Clicar num símbolo de **report** salta para o par; a localização usa a numeração efectiva da folha (ex. `032-F1`).

## Limitações conhecidas

Tabelas (lista de folhas, nomenclatura) aparecem como caixa a tracejado; a referência cruzada de contactos desenha-se como lista junto ao elemento, não no formato de cruz do QET.
