# Regras fixas da comparação

O sistema aplica estas regras depois da tua resposta, e elas ganham sempre. Ter as regras em conta poupa decisões que vão ser corrigidas.

1. Campos sem evidência, ou com evidência igual ao valor guardado depois de normalizada, ficam em `manter` sem chegar a ti.
2. Se o valor proposto, normalizado, for igual ao guardado, a decisão passa a `manter`.
3. Um valor inválido para o campo (CAE sem 5 dígitos, estado fora da lista) passa a `rever`, sem valor.
4. `propor` precisa da fonte de maior prioridade do campo, ou de duas fontes diferentes que concordem; caso contrário passa a `rever`.
5. No estado, `CLOSED_PERMANENTLY` do Google Maps sozinho nunca dá `propor`: passa a `rever`.
6. Evidência só de outros sites (`web`) nunca dá `propor`: passa a `rever`.
7. O URL e o excerto da decisão têm de ser de uma das evidências. Se não forem, usa-se a evidência de maior prioridade com esse valor; se nenhuma tiver esse valor, um `propor` passa a `rever`.

## Normalização

- **Morada:** maiúsculas, acentos e pontuação ignorados; abreviaturas expandidas (Av. → Avenida, R. → Rua, Lg. → Largo, Pç. → Praça, Trav. → Travessa, Ed. → Edifício, Prof. → Professor, Dr. → Doutor, Eng. → Engenheiro, D. → Dom); "n.º" ignorado. Duas moradas são iguais quando o código postal e os números coincidem (se ambas os tiverem) e todas as palavras da mais curta estão na outra: mais detalhe (freguesia, piso) é a mesma morada, uma palavra diferente (outro nome de rua) não.
- **Website:** compara-se o domínio, sem protocolo, `www` nem caminho.
- **CAE:** os 5 dígitos.
- **Estado:** `OPERATIONAL` e "Activa" contam como Ativa.
