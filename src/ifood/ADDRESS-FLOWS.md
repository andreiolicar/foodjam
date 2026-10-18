# IF-05 — dois fluxos de endereço e decisão pendente com Ana Paula

**MVP deve suportar os dois fluxos.** O fluxo salvo tem capacidades de leitura
preparadas; o fluxo digitado ainda não tem execução implementada/homologada.
Esta revisão não cadastra endereços nem habilita createAddress.

## Fluxo A: endereço salvo

`catalog.listSavedAddresses()` consulta listAddresses e retorna `{ id, formatted }`
para apresentação privada ao organizador. Copia formattedAddress do mesmo
registro que contém addressId e coordinates; exige campos essenciais e IDs
únicos. Não decide pela primeira opção, quantidade, alias ou histórico de uso.

O Core/composição apresenta opções e exige confirmação explícita, mesmo se só
houver uma opção. Somente então entrega o endereço às consultas. O adaptador
relê e verifica ID/texto/coordenadas por chamada, sem validar texto livre.
AgentHints/descrição da ferramenta não podem dispensar a confirmação exigida
pela equipe. Não existe flag de confirmação controlável por LLM neste módulo.

## O que o createAddress descoberto documenta

Fonte: inputSchema/descrição/annotations no discovery privado das 23 ferramentas;
nenhuma execução. Não confundir documentação de retorno com saída comprovada.

| Campo de entrada | Tipo | Obrigatoriedade |
| --- | --- | --- |
| address | string livre | Schema required vazio; descrição exige texto na geocodificação e normalmente confirmação |
| candidateId | string | Descrição exige para confirmar/persistir candidato anterior; pode confirmar só por esse ID |
| alias | string | Opcional; descrição restringe apelidos às categorias CASA/TRABALHO |
| complement | string | Opcional no schema; região pode exigir segundo a descrição |
| neighborhood | string | Pode ser exigido quando geocodificação não fornece bairro |
| reference | string | Opcional no schema; região pode exigir segundo a descrição |

Não há entrada obrigatória de coordenadas, endereço estruturado ou ID externo de
localização. O serviço recebe texto livre e documenta geocodificação interna.
A identidade do consumidor vem da autenticação; não enviar accountId.

A descrição documenta fluxo em duas etapas: address sozinho retorna
matchConfidence (SINGLE/MULTIPLE), candidates[] e candidateId; depois a escolha
confirmada com candidateId permite persistência e addressId permanente. Também
documenta atalho de criação direta quando endereço/complemento/bairro permitem,
e createdDirectly true nesse cenário. MISSING_REQUIRED_ADDRESS_FIELDS é citado
para campos de entrega faltantes. **Não há outputSchema**; nenhuma dessas
estruturas/garantias de normalização foi validada por execução nesta IF-05.

Annotations: readOnlyHint false, destructiveHint true, idempotentHint false.
A política local já bloqueia createAddress e permanece assim. Não presumir
que enviar só address é uma leitura isenta de efeitos: a operação globalmente
geocodifica e salva, a semântica depende do payload e não existe garantia técnica
de dry-run descoberta. Não adicionar complement para aproveitar atalho automático.

## Fluxo B: endereço digitado

A capacidade de geocodificar parece viável pela documentação do MCP, mas está
acoplada a uma ferramenta de escrita. Não se identificou no catálogo coletado
uma operação separada de validação/geocodificação somente leitura. Não se fez
busca externa nem se inventou provedor alternativo.

A descrição sugere que candidatos possam ser apresentados antes da persistência,
mas não comprova consulta independente/sem escrita, uso desses candidatos nas
buscas nem geocodificação somente leitura. Para testar será preciso decisão e
consentimento explícito; não cabe à rotina automática validateAddress(text).

Mesmo que uma busca aceite apenas userLocation, o transporte de coordenadas não
comprova que uma localização digitada foi validada, que pertence ao destino
confirmado ou que pode ser usada sem cadastro até o pedido. Nenhum endereço
manual sem comprovação é liberado pelo adaptador atual.

## Proposta mínima para decisão conjunta (não implementada)

A CatalogPort atual pede validateAddress(text) como leitura, retornando sucesso
normalizado ou erro de endereço; não modela consentimento, candidatos, confirmação
ou persistência. Embutir createAddress nela faria uma leitura aparente escrever.

Recomendação para Ana Paula: manter searchStores/getMenu como leituras e separar
a aquisição do endereço do catálogo. Acrescentar ao fluxo do Core **uma entrada
para propor um DeliveryAddress comprovado**, reutilizando a confirmação atual
do organizador, em vez de sempre obter a opção por validateAddress(text).
Nome sugerido para discussão: `proporEndereco(sessionId, actorId, address)`;
sem implementação nem mudança no contrato nesta branch.

A composição/controlador de endereço passa a:

1. No fluxo salvo, apresentar listSavedAddresses e enviar a opção escolhida ao
   Core para confirmação; nenhuma geocodificação ou escrita.
2. No fluxo digitado, receber texto e obter consentimento específico antes de
   qualquer futura chamada createAddress. O texto não é consentimento.
3. Se o time autorizar testar essa operação, apresentar candidatos retornados e
   pedir confirmação de localização. Nunca inferir candidateId nem escolher por
   confiança SINGLE automaticamente.
4. Exigir autorização explícita para persistir o candidato; separar claramente
   consentimento de geocodificação da confirmação de cadastro, e não criar por
   atalho. A operação precisará de allowlist/flag própria e proteção de repetição
   em tarefa futura, após revisão do contrato e teste autorizado.
5. Só oferecer ao Core o ID/texto/localização comprovados; o Core confirma o
   destino para as buscas, invalida retratos ao trocar e mantém autorização.

Alternativa a decidir: obter uma garantia/endpoint oficial de geocodificação sem
escrita e manter validateAddress com essa implementação. Não existe evidência
suficiente para implementá-la agora. Não propor serviço externo sem autorização.

Faltam decisões sobre onde ficam estados de consentimento/candidatos, proteção
contra cadastro duplicado após timeout e referência ao destino no pedido. Tudo
isso é separado da compra; autorizar cadastro não autoriza submitOrder.

## Gate atual

GetStore continua extensão; sua inclusão na CatalogPort depende da Ana Paula.
ValidateAddress continua ausente, não falsificado por comparação textual, regex
ou ID recebido. Nenhuma mudança em Core/Telegram/src/index.ts e nenhum cadastro
foram realizados. IF-05 permanece aberta até homologação real do catálogo.
