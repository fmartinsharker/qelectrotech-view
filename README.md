# QElectroTech View (só leitura)

Página que abre ficheiros `.qet` no próprio browser — o ficheiro nunca é enviado nem alterado.

- Desenha as folhas (elementos, condutores, texto, formas, imagens, moldura e a legenda do projecto).
- **Referências cruzadas**: mestre ↔ contactos, reports de folha; clicar salta para o elemento (mesmo noutra folha), com botão «Voltar».
- **Notas** por projecto, folha, elemento, condutor ou ponto do desenho, com **autor e data** (criação e última edição), partilhadas em tempo real. Exportáveis em JSON e Markdown.
- Pesquisa por etiqueta, nome, informações, nº de fio, folha e notas.
- Pensado também para tablet: ☰ (folhas, pesquisa, notas), ⓘ (detalhes) e ⤢ (ecrã inteiro) escondem as barras. Atalhos `B`, `I`, `F`; `Esc` mostra as barras.
- Ligações directas: `?file=url/do/ficheiro.qet#f=3&e=<uuid>`.

## Estrutura

| Ficheiro / pasta | O que é |
|---|---|
| `web/` | A página (HTML/CSS/JS sem build) |
| `web/js/firebase-config.js` | Configuração do Firebase (a preencher) |
| `firestore.rules` | Regras de segurança das notas (autor e datas impostos pelo servidor) |
| `firebase.json` | Hosting, regras e emuladores |
| `test/` | Testes das regras de segurança |

## Correr localmente

Só a página, com notas locais (ficam no browser de cada pessoa):

    python3 .claude/devserver.py 8765      # serve web/ sem cache

Com notas partilhadas simuladas (emuladores do Firebase, sem conta nem internet; precisa de Java 21+):

    npm install
    npm run emulators                       # Auth + Firestore locais
    python3 .claude/devserver.py 8766       # noutro terminal

e abrir `http://localhost:8766/?emulator&as=ana` (ou `as=rui`, `as=francisco`). Testes das regras de segurança: `npm test`.

## Notas partilhadas com Microsoft 365 (tudo gratuito, sem cartão)

Com o Firebase configurado, a página exige login com a conta Microsoft 365 e as notas passam a ser guardadas no Firestore, visíveis a toda a equipa **em tempo real**. Sem configuração (ou fora do Firebase) continua o modo local.

- O **email** de quem escreve vem do login e as **datas** são as do servidor: as regras (`firestore.rules`) recusam notas com outro autor ou datas falsas, e impedem mudar quem criou uma nota. O **nome** mostrado é o da conta e serve só para apresentação; o que identifica é o email.
- As notas ligam-se ao **título do projecto** + UUID dos elementos: todas as revisões do mesmo projecto partilham notas.
- Duas pessoas a editar a **mesma** nota ao mesmo tempo: ganha a última a gravar.
- Qualquer pessoa da empresa pode editar e apagar qualquer nota.

### Custo: 0 €, sem cartão

Plano **Spark** do Firebase (a página de preços indica «No payment method needed»). Limites por projecto, segundo a documentação: Firestore 1 GiB, 50 mil leituras e 20 mil escritas por dia; Hosting 10 GB e 360 MB de tráfego por dia. Este uso fica muito abaixo. As Cloud Functions não existem no Spark, e não são precisas. O registo da aplicação no Entra ID não precisa de subscrição Azure.

### Configurar (uma vez)

1. **Firebase**: em https://console.firebase.google.com (conta Google) *Add project* (sem Analytics). Fica no plano Spark.
2. **Firestore**: *Build → Firestore Database → Create database* (modo produção, região europeia).
3. **Entra ID** (portal Microsoft Entra, com permissão para registar aplicações): *App registrations → New registration*.
   - *Supported account types*: **Accounts in this organizational directory only (single tenant)**. É este o controlo que limita o login à empresa; **não escolher** contas pessoais nem «any organization».
   - *Redirect URI* (Web): `https://qelectrotechview.web.app/__/auth/handler` (o mesmo endereço da página; acrescentar também o `https://<id-do-projecto>.firebaseapp.com/__/auth/handler` não faz mal)
   - *Certificates & secrets → New client secret*: copiar o **Value** (expira; anotar a data para renovar).
   - Na página *Overview* copiar o *Application (client) ID* e o *Directory (tenant) ID*.
4. **Firebase → Authentication → Sign-in method → Microsoft**: activar e colar o *Application (client) ID* e o *client secret*.
5. **Firebase → Project settings → Your apps → Web app (</>)**: copiar o `firebaseConfig` para `web/js/firebase-config.js` e preencher `microsoftTenant` com o *Directory (tenant) ID*.
6. Se o domínio de email não for `harkersolutions.com`, mudar a expressão em `allowed()` no `firestore.rules` e `emailDomain` no `firebase-config.js`.
7. **Publicar** (Hosting e regras):

       npm install -g firebase-tools
       firebase login
       firebase deploy --only firestore:rules,hosting --project harker-solutions

   A página fica em `https://qelectrotechview.web.app` (site de Hosting `qelectrotechview`, definido em `firebase.json`).

**Não foi testado contra um projecto Firebase real** (só com os emuladores): na primeira publicação, verificar o login Microsoft, criar uma nota e abri-la noutro browser com outra conta. Dois pontos por confirmar na consola: que o login Microsoft está disponível no plano Spark, e se o email vindo da Microsoft chega marcado como verificado. Por isso a restrição principal é o registo «single tenant» do passo 3, e a regra do domínio é uma segunda barreira.

## Fidelidade ao QElectroTech

- Usa o **modelo de legenda embebido no projecto** (campos, variáveis `%title`, `%{obra}`, logótipos SVG/PNG, larguras em `px`/`%`) e as imagens da folha (escala e rotação em torno do centro, como no QET).
- Os tipos de letra do projecto (ex. *Space Mono*) são pedidos ao Google Fonts; sem rede usa a letra instalada ou uma genérica.
- O tamanho do texto segue o PDF exportado pelo QET (1 pt = 1 unidade do desenho). A numeração das colunas começa em 1, como nos PDF do projecto.
- Clicar num símbolo de **report** salta para o par; a localização usa a numeração efectiva da folha (ex. `032-F1`).

## Limitações conhecidas

Tabelas (lista de folhas, nomenclatura) aparecem como caixa a tracejado; a referência cruzada de contactos desenha-se como lista junto ao elemento, não no formato de cruz do QET.
