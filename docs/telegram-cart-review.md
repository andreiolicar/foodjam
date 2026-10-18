# Carrinho MCP para revisão no Telegram

Base: `e7a037746a72149c8e3366ac99331b14ed423363` (inclui o polimento da disponibilidade).
Implementação local; nenhum carrinho real foi criado nesta entrega.

## Corte vertical

`/iniciar → endereço salvo confirmado → preferências → /montar → proposta → 🛒 Preparar carrinho → getCart → revisão`.

O resumo coletivo e os cards individuais continuam iguais. Quando a preparação
está habilitada, o resumo informa que o botão altera a conta iFood sem autorizar
entrega, pagamento ou compra. Somente o organizador pode acioná-lo no resumo
vigente. O callback é respondido antes da operação remota.

Reutiliza `createPreparationAuthority`, `prepareCommercialProposal`,
`createIfoodCommercialPreparation`, o cliente OAuth/transporte existente e o
journal privado durável. Não existe um segundo caminho de recomendação ou checkout.

A criação envia `createCart` com os itens consolidados por produto **daquela loja**.
Esse formato está presente no inputSchema registrado na inspeção privada 09 e no
preparador existente. O catálogo de ferramentas da conexão continua sendo a fonte
vigente: os argumentos reais são validados antes da reserva/envio. Não se usa
`addItemToCart` quando `createCart(items)` já inclui os produtos; isso evitaria uma
escrita redundante e potencial duplicação. Esquema incompatível ou método ausente
produz pendência, sem inventar argumentos. Cada loja recebe seu próprio carrinho.

Exemplo controlado: Andrei, coxinha ×1; Ana Paula e Allan, pão de queijo ×1 cada.
Uma loja recebe duas linhas: coxinha ×1 e pão de queijo ×2. A revisão conserva as
três associações individuais e usa os preços de `getCart`, inclusive quando mudam.
Duas lojas são apresentadas separadamente; não há total consolidado inventado.

## Habilitação posterior, após autorização de publicação/homologação

A capacidade permanece **desligada por padrão**. Para futura operação controlada:

- `FOODJAM_CART_PREPARATION_ENABLED=true`;
- `FOODJAM_CART_JOURNAL_DIR`: diretório absoluto, privado (0700), fora do repositório;
- `FOODJAM_CART_MONEY_UNIT=BRL` somente para o perfil BRL explicitamente homologado;
  `cents` exige sua própria evidência. Sem unidade, valores não são convertidos e
  a revisão registra a pendência.

Não se alteraram os arquivos privados ou a instância ativa. Publicação, cutover e
qualquer mutação externa exigem a autorização específica da próxima etapa. Não
executar dois bots, CLIs de preparação ou outros escritores compartilhando o
journal: a serialização por sessão pertence à instância única do controlador.

## Autorização e incerteza

O Core captura proposta, pessoas e endereço confirmado. Guarda a identidade e o
fingerprint antes da rede. Repetições da mesma preparação usam o resultado da
mesma tentativa; uma operação em andamento não é repetida. A ação “Atualizar
revisão do carrinho” executa somente leitura de ID já registrado.

A porta relê conta, endereço, loja aberta e produtos, incluindo opções obrigatórias.
A autoridade opaca vincula conta/sessão/proposta/loja/endereço/quantidades. A vigência
é revalidada antes da reserva e do envio; mudança/cancelamento interrompe os passos
seguintes. Uma escrita já enviada não pode ser desfeita por cancelar a proposta.
Seu retorno fica no registro privado e não reapresenta uma proposta obsoleta.

A reserva é sincronizada em disco **antes** de `createCart`. O cartId real é salvo
antes da leitura. O escopo privado por conta/chat detecta qualquer reserva ainda
sem ID, inclusive de outra loja/proposta e após reinício. Não apagar, expirar nem
trocar o journal para contornar esse estado. Exige reconciliação privada, sem retry
cego. A espera do controlador é limitada a 30 segundos; timeout não prova que o
servidor recusou a escrita. Se o ID chegar tarde, ele é preservado e uma ação
explícita de leitura pode reconciliá-lo. Leituras falhas não liberam outra criação.

A revisão é vinculada ao resumo atual e removida com ele. Callback antigo não
prepara nem revisa a nova proposta. Envio Telegram ambíguo não libera cópia;
rejeição explícita permite tentativa posterior de apresentação, sem recriar carrinho.

## Revisão comercial e pendências

`getCart` precisa corresponder ao ID retornado, loja, produtos e quantidades.
`itemId` nunca é substituído por `cartItemId`. A revisão mostra somente nomes da
proposta e números validados do carrinho, sem endereço, IDs, conta ou pagamento.
Preços preliminares não são usados como preço comercial nem como fallback.

Endereço ausente/divergente, dados comerciais incompletos, unidade desconhecida,
subtotal/frete/taxas divergentes ou total não reconciliado permanecem bloqueados.
Benefícios e total remoto são preservados; não se inventa fórmula ou desconto para
fazê-los coincidir. Falha parcial nunca é anunciada como sucesso completo.

Nenhum método de entrega é selecionado; `getCartDeliveryMethods`/`setCartDelivery`
não são necessários para criar e revisar este corte. Entrega, mínimos, restrições
e disponibilidade para compra continuam pendentes de conferência. Opções
obrigatórias desconhecidas bloqueiam a preparação. A seleção de entrega exigirá
uma ação/autorização específica posterior.

Pagamento segue desabilitado. Não há `createAddress`, `setCartPayment`, `submitOrder`
ou executor de compra neste fluxo. O antigo botão de confirmação continua bloqueado.

## Verificação

Fixtures/transportes controlados, sem rede externa. RED → GREEN reproduziu ausência
da ação, rejeição de permissões/revisões, repetição, incerteza, troca de proposta,
reinício, outra loja e rejeição explícita de apresentação. A composição real
`criarAplicacaoReal` é exercitada com respostas MCP/IA/Telegram controladas.
As verificações completas, quantidade final e SHA constam no relatório de entrega.
