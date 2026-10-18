# Quantidades e pendências da primeira homologação de carrinho

## Correção localizada

A coleta guardava somente nomes em `wishes` e a descoberta construía cada escolha
com `quantity: 1`. A preparação comercial já consolidava corretamente as quantidades
da proposta; não foi a origem da perda.

`wishQuantities` acompanha a ordem de `wishes`, opcional para compatibilidade com
sessões anteriores. O Core extrai contagens da mensagem original, valida inteiros
de 1 a 10 e conserva a associação desejo/participante na descoberta e alternativas.
Ausência de contagem mantém a unidade padrão; contagem ambígua, inválida ou saída
do modelo com número incorporado ao nome pede esclarecimento, sem gravar uma
preferência incorreta. Mudança explícita substitui a contagem anterior. Atualização
somente de restrição conserva a quantidade comprovada do mesmo desejo.

O cenário controlado com coxinha ×1, croissant ×1 e pão de queijo ×2 mantém essas
quantidades na proposta, nos cards e em `createCart.items`. Duas pessoas com o
mesmo produto mantêm associações individuais e agregam 1+1=2 ou 2+1=3 no payload.
Os testes utilizam transportes controlados e journal em memória.

## Endereço: pendência preservada

O journal real conserva a identidade do carrinho, mas não o payload de `getCart`.
Não foi encontrado registro bruto da resposta desta criação nos diagnósticos
disponíveis. Evidências históricas de outros carrinhos não provam o formato deste.

Em `cart-observation.ts`, `address_binding_unconfirmed` significa ausência do ID
no contexto ou em `deliveryAddress.addressId`. A preparação exige ID no contexto;
portanto a pendência observada é compatível com ausência desse campo na resposta,
mas isso é uma inferência do caminho de código, não comprovação do payload atual.
Um ID presente e diferente geraria `address_binding_mismatch`. Não foi comprovado
campo equivalente documentado. Enviar `addressId` na criação ou comparar textos
de endereço não basta para confirmar o vínculo retornado. O bloqueio permanece.

## Benefícios e total: pendência preservada

Com os agregados relatados: R$ 35,99 + R$ 0,00 + R$ 0,99 − R$ 22,98 − R$ 0,00
= R$ 14,00, enquanto o total remoto é R$ 18,99. A diferença é R$ 4,99.
Isso explica o guardrail `total_decomposition_mismatch`; não comprova que o benefício
seja um desconto integral aplicável a essa decomposição. Faltam a resposta bruta
deste carrinho e uma definição comercial comprovada de `benefitsTotalAmount`,
incluindo possível sobreposição e composição dos agregados.

Nenhum sinal, fórmula, valor ou tolerância foi ajustado. Os agregados e o total
remoto continuam preservados; a revisão comercial permanece bloqueada onde falta
evidência. O teste aritmético usa uma linha hipotética, declarada no próprio teste,
e não inventa preços individuais para a evidência real.

## Limites operacionais

Sem chamadas reais MCP, IA ou Telegram durante a correção. Nenhuma edição ou
reconciliação automática do carrinho existente, alteração do journal, pagamento,
configuração de entrega/endereço ou envio de pedido. O commit é exclusivamente
local; integração e troca de instância dependem de uma etapa posterior autorizada.
