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
| `api/` | API das notas partilhadas (Azure Functions + Table Storage) e testes |
| `dev/` | Emulador local do Azure Static Web Apps (só desenvolvimento) |

## Correr localmente

Só a página, com notas locais (ficam no browser de cada pessoa):

    python3 .claude/devserver.py 8765      # serve web/ sem cache

Com notas partilhadas e login simulado (3 utilizadores de teste, a mesma API do Azure):

    node dev/swa-emulator.js 8767 [pasta-com-ficheiros-qet]    # ficheiros em /testdata/…

Testes da API: `cd api && npm install && npm test`.

## Notas partilhadas com Microsoft 365

Quando a página corre no **Azure Static Web Apps**, o login é o da conta da empresa e as notas passam a ser guardadas num servidor, visíveis a todos os que abrirem o mesmo projecto. Fora do Azure (ou sem sessão) continua o modo local.

- O **nome e o email** de quem escreve vêm do login e são gravados pelo **servidor**; a página não consegue escrever uma nota em nome de outra pessoa. Cada nota guarda quem criou/quando e quem editou por último/quando.
- As notas ligam-se ao **título do projecto** + UUID dos elementos: todas as revisões do mesmo projecto partilham notas.
- Duas pessoas a editar a **mesma** nota ao mesmo tempo: ganha a última a gravar (a página sincroniza de 15 em 15 s e ao voltar ao separador).
- Qualquer pessoa autenticada pode editar e apagar notas. Notas importadas de JSON passam a ter como autor quem as importou.

### Configurar no Azure (uma vez)

1. **Storage account** (Standard LRS). Copiar a *connection string* (Access keys). A tabela `notes` é criada sozinha.
2. **Static Web App**, plano **Standard** (o Free não permite registo próprio no Entra ID). Ligar ao repositório com `app_location = web`, `api_location = api`, `output = (vazio)`. A API corre em Node 20.
3. **Entra ID → App registrations → New registration**, *single tenant* (só a vossa organização). Redirect URI (Web): `https://<o-vosso-site>.azurestaticapps.net/.auth/login/aad/callback`. Em *Authentication* activar *ID tokens*. Em *Certificates & secrets* criar um *client secret*.
4. **Static Web App → Configuration → Application settings**:

   | Nome | Valor |
   |---|---|
   | `AAD_CLIENT_ID` | Application (client) ID do registo |
   | `AAD_CLIENT_SECRET` | o secret criado |
   | `NOTES_STORAGE` | connection string do Storage |
   | `ALLOWED_DOMAINS` | `harkersolutions.com` (segunda barreira; vários separados por vírgula) |

5. Em `web/staticwebapp.config.json` substituir `SUBSTITUIR-PELO-TENANT-ID` pelo *Directory (tenant) ID* e publicar.

### Publicação automática (GitHub Actions)

O ficheiro `.github/workflows/azure-static-web-apps.yml` corre os testes da API em cada *push* e *pull request*, e publica (página + API) quando há *push* para `main` e os testes passam.

1. Pôr o projecto num repositório GitHub (a pasta ainda não é um repositório git) com o ramo `main`.
2. No Static Web App: *Overview → Manage deployment token* e copiar o token.
3. No GitHub: *Settings → Secrets and variables → Actions → New repository secret* com o nome `AZURE_STATIC_WEB_APPS_API_TOKEN`.
4. Se ao criar o Static Web App ligares o GitHub no portal, o Azure gera o seu próprio workflow e um segredo com outro nome; apaga o workflow gerado (ou troca o nome do segredo neste) para não publicar duas vezes.

Não há ambientes de pré-visualização por *pull request*: cada um teria um endereço novo e seria preciso registá-lo no Entra ID como Redirect URI.

Todas as rotas exigem sessão; sem login o Azure redireciona para a página de entrada da Microsoft. **Não foi testado num Azure real** (só com o emulador e testes automáticos), por isso a primeira publicação deve ser verificada: login, criar uma nota, abrir noutro browser com outra conta.

## Fidelidade ao QElectroTech

- Usa o **modelo de legenda embebido no projecto** (campos, variáveis `%title`, `%{obra}`, logótipos SVG/PNG, larguras em `px`/`%`) e as imagens da folha (escala e rotação em torno do centro, como no QET).
- Os tipos de letra do projecto (ex. *Space Mono*) são pedidos ao Google Fonts; sem rede usa a letra instalada ou uma genérica.
- O tamanho do texto segue o PDF exportado pelo QET (1 pt = 1 unidade do desenho). A numeração das colunas começa em 1, como nos PDF do projecto.
- Clicar num símbolo de **report** salta para o par; a localização usa a numeração efectiva da folha (ex. `032-F1`).

## Limitações conhecidas

Tabelas (lista de folhas, nomenclatura) aparecem como caixa a tracejado; a referência cruzada de contactos desenha-se como lista junto ao elemento, não no formato de cruz do QET.
