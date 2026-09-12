import React from 'react';
import { Text as RNText, TextProps } from 'react-native';
import { VLibrasController } from './GlobalVLibras';

type Props = TextProps & {
  /**
   * Marca este texto como tradutivel: segurar (long press) o envia ao VLibras.
   *
   * Desligado por padrao DE PROPOSITO. Todas as telas importam este componente
   * como `Text`, entao ligar a traducao para todo mundo transformava o rotulo
   * de cada botao num alvo de toque que roubava o gesto do proprio botao.
   * Use em textos de conteudo (titulos, descricoes, enunciados), nunca em
   * rotulos dentro de TouchableOpacity/Pressable.
   */
  translatable?: boolean;
};

export default function TranslatableText({
  children,
  onPress,
  onLongPress,
  translatable = false,
  ...props
}: Props) {
  // Extrai texto de children aninhado: um <Text> pode conter strings, numeros
  // e outros elementos (ex.: {count} entre trechos). Percorrer a arvore evita
  // o caso silencioso em que children nao e' string nem array de strings e a
  // traducao simplesmente nao acontecia.
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).filter(Boolean).join(' ');
    if (React.isValidElement(node)) {
      return extractText((node.props as { children?: React.ReactNode }).children);
    }
    return '';
  };

  const translate = () => {
    const text = extractText(children).trim();
    if (text) VLibrasController.translate(text);
  };

  // Um <Text> com onPress OU onLongPress vira um ALVO DE TOQUE proprio e fica
  // ACIMA do TouchableOpacity que o contem: os dois disputam o mesmo gesto e o
  // texto ganha. Como todas as telas importam este componente como `Text`, o
  // rotulo de cada botao roubava o toque do proprio botao — o sintoma era
  // "preciso clicar varias vezes para uma funcionar" (so' funcionava ao
  // acertar a borda do botao, fora da caixa do texto). Basta o onLongPress
  // para reproduzir o problema: sua presenca faz o texto segurar o gesto por
  // ~500ms antes de decidir, engolindo o toque rapido.
  //
  // Por isso NADA e' anexado por conta propria: um <Text> comum volta a ser
  // inerte ao toque e o gesto chega ao botao. A traducao passa a ser explicita
  // — quem quer um texto tradutivel usa `translatable`, e ai' o texto ja' nao
  // esta' dentro de um botao.
  const isTouchTarget = translatable || !!onPress || !!onLongPress;

  return (
    <RNText
      {...props}
      onPress={onPress}
      onLongPress={
        isTouchTarget
          ? (event) => {
              onLongPress?.(event);
              if (translatable) translate();
            }
          : undefined
      }
    >
      {children}
    </RNText>
  );
}
