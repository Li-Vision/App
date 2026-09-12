import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeTranscriptionStyles as makeStyles } from "@/styles/transcription.styles";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useAppTheme } from "@/context/ThemeContext";
import { report } from "@/services/errorReporter";

// VLibras renderiza internamente em tamanho fixo.
// NÃ£o tentamos redimensionar â€” o WebView preenche o espaÃ§o e o VLibras renderiza dentro.

const VLIBRAS_HTML = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body, html { 
  width: 100%; height: 100%; 
  background: #10141a; 
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}
    #status { 
      color: #8a92a3; font-family: sans-serif; text-align: center; 
      position: absolute; width: 100%; top: 40%; z-index: 9999; 
    }

    /* ATENCAO: o widget desta versao do VLibras vive dentro de um SHADOW DOM
       (div#vlibras-app-root). CSS declarado aqui NAO o alcanca — por isso as
       regras antigas para [vw] / .vpw-header nunca surtiram efeito, e nao
       adianta reescreve-las. O tamanho/posicao do widget e' resolvido pelo
       layout React (webviewWrapper/webviewContainer em
       styles/transcription.styles.ts). */
  </style>
</head>
<body>
  <p id="status">Carregando avatar VLibras...</p>

  <div vw class="enabled">
    <div vw-access-button class="active"></div>
    <div vw-plugin-wrapper>
      <div class="vw-plugin-top-wrapper"></div>
    </div>
  </div>

  <script src="https://vlibras.gov.br/app/vlibras-plugin.js"></script>
  <script>
    // Suprime popups do Unity/WebGL, mas REPASSA a mensagem ao app: silenciar
    // por completo escondia falhas de carregamento e o sintoma virava um
    // carregamento eterno sem pista nenhuma.
    (function() {
      window.alert = function() {};
      function send(level, msg) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'log', level: level, message: String(msg),
          }));
        } catch (e) {}
      }
      window.onerror = function(msg, src, line) {
        send('error', msg + ' @' + src + ':' + line);
        return true;
      };
      console.error = function() { send('error', Array.prototype.join.call(arguments, ' ')); };
      console.warn = function() { send('warn', Array.prototype.join.call(arguments, ' ')); };
      window.__vlibrasFail = function(reason) {
        send('error', reason);
        var el = document.getElementById('status');
        if (el) { el.style.display = 'block'; el.textContent = 'VLibras indisponivel'; }
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'failed' })); } catch (e) {}
      };
    })();

    if (!window.VLibras) {
      window.__vlibrasFail('plugin do VLibras nao carregou — script bloqueado ou servico indisponivel');
    } else {
      // SEM declaracao var: o bundle do VLibras ja declara a variavel widget globalmente e a
      // redeclaração dispara um SyntaxError que aborta este script inteiro.
      window.__liVisionWidget = new window.VLibras.Widget('https://vlibras.gov.br/app');
    }

    // Abre o player manipulando as classes internas do VLibras
    function openPlayer() {
      var accessBtn = document.querySelector('[vw-access-button]');
      var wrapper = document.querySelector('[vw-plugin-wrapper]');
      var vwEl = document.querySelector('[vw]');
      
      if (!accessBtn || !wrapper) {
        window.__vlibrasFail('estrutura do widget ausente (accessBtn=' + !!accessBtn + ', wrapper=' + !!wrapper + ')');
        return;
      }

      accessBtn.classList.add('active');
      wrapper.classList.add('active');
      if (vwEl) vwEl.classList.add('active');
      accessBtn.style.setProperty('display', 'none', 'important');
      
      // O avatar NAO vira um <canvas> nem um <iframe> nesta versao: medido em
      // runtime, o [vw-plugin-wrapper] fica permanentemente vazio e
      // document.querySelectorAll('canvas').length continua 0 indefinidamente.
      // Esperar por um elemento no DOM, portanto, nunca terminava — o widget
      // so' "aparecia" quando o timeout de 60s do lado nativo derrubava o
      // overlay, ~53s depois de o avatar ja' estar pronto.
      //
      // Quem conhece o estado real e' o proprio player: plugin.player expoe
      // isLoaded/isMounted/isBroken (medido: isLoaded=true, isMounted=true,
      // status='playing', avatar='icaro' em ~7s).
      var tries = 0;
      var waitPlayer = setInterval(function() {
        var player = (window.plugin && window.plugin.player) || null;

        if (player && player.isBroken) {
          clearInterval(waitPlayer);
          window.__vlibrasFail('o player do VLibras reportou falha (isBroken) — assets podem estar bloqueados');
          return;
        }

        if (player && player.isLoaded && player.isMounted) {
          clearInterval(waitPlayer);
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
        } else if (++tries > 90) { // ~45s
          clearInterval(waitPlayer);
          window.__vlibrasFail('o player do VLibras nao ficou pronto em 45s - assets podem estar bloqueados');
        }
      }, 500);
    }

    // NAO meça o widget para redimensionar o container: isso cria um LOOP DE
    // REALIMENTACAO. O widget se dimensiona como (altura do WebView - 7px), de
    // modo que aplicar a medida ao container encolhe o WebView, o widget
    // remede menor, e assim por diante — medido: 212 -> 205 -> 198 -> ... -> 45,
    // ate' sobrar so' a barra de controles. O container precisa de altura
    // INDEPENDENTE do widget (ver webviewContainer em transcription.styles.ts).
    //
    // NAO tente reposicionar o widget por CSS a partir daqui. Ele vive num
    // shadow root (div#vlibras-app-root) e ignora qualquer tentativa externa:
    // medido em runtime, nem folha de estilo no shadow, nem :host, nem estilo
    // INLINE com !important mudaram sua posicao. O widget tem tamanho proprio
    // (260x373), entao quem se adapta e' o layout React — o container usa essas
    // medidas e o wrapper o centraliza (ver webviewWrapper/webviewContainer em
    // styles/transcription.styles.ts). Resultado medido: sobra L8 R8 T23 B24.

    var readyTries = 0;
    var checkReady = setInterval(function() {
      var accessBtn = document.querySelector('[vw-access-button]');
      // NAO basta o accessBtn existir: ele faz parte do HTML ESTATICO desta
      // pagina, entao o seletor o encontra ja' na primeira iteracao (~500ms),
      // muito antes de o bundle do VLibras inicializar e registrar os proprios
      // listeners de clique. Disparar os eventos nesse instante os manda para
      // um elemento ainda sem handler: o clique se perde em silencio, o player
      // nunca abre e a tela fica em "VLibras indisponivel" ate' um toque
      // MANUAL — que funciona justamente porque a essa altura o widget ja'
      // terminou de carregar. Era esse o sintoma: manual abria, automatico nao.
      //
      // Quem sinaliza que o widget assumiu o controle e' window.plugin, criado
      // pelo bundle na inicializacao. Esperar por ele alinha o disparo
      // automatico ao momento em que um toque manual passaria a funcionar.
      var pluginPronto = !!window.plugin;

      if (accessBtn && pluginPronto) {
        clearInterval(checkReady);
        document.getElementById('status').style.display = 'none';
        // Alguns builds do widget só reagem a um evento de ponteiro completo;
        // o .click() sozinho deixava o player fechado, exigindo toque manual.
        try {
          ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function(type) {
            accessBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
        } catch (e) {
          accessBtn.click();
        }
        setTimeout(openPlayer, 1000);
      } else if (++readyTries > 90) { // ~45s
        clearInterval(checkReady);
        window.__vlibrasFail('widget do VLibras nao inicializou em 45s (accessBtn=' + !!accessBtn + ', plugin=' + pluginPronto + ')');
      }
    }, 500);

    function translateText(text) {
      try {
        // O metodo de traducao fica em window.plugin.translate, NAO em
        // plugin.player.translate. Medido em runtime: as funcoes do player sao
        // play/playStatic/send/stop/... e nenhuma delas e' translate; a unica
        // funcao do plugin e' justamente translate. (A chave 'translate' que
        // aparece listada no player e' propriedade de dados, nao metodo.)
        var p = window.plugin || {};
        if (typeof p.translate !== 'function') {
          window.__vlibrasFail('player do VLibras indisponivel para traducao');
          return;
        }
        p.translate(text);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'translating', text: text }));
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message }));
      }
    }
  </script>
</body>
</html>
`;

export default function TranscriptionTabScreen() {
    const { colors, scheme } = useAppTheme();
    const styles = useMemo(() => makeStyles(colors, scheme), [colors, scheme]);
    const webViewRef = useRef<WebView>(null);
    const [text, setText] = useState("");
    const [isReady, setIsReady] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [lastTranslated, setLastTranslated] = useState("");
    const { t } = useTranslation();

    // Ver GlobalVLibras: se o script do plugin não baixar, nenhum código de
    // dentro do WebView roda — este temporizador do lado nativo é a única
    // salvaguarda contra o carregamento infinito.
    useEffect(() => {
        if (isReady) return;
        const timer = setTimeout(() => {
            setIsReady(true);
            report("VLibras", "nao respondeu em 60s — verifique a conexao ou tente novamente", {
                detail: "Nenhuma mensagem recebida do WebView na tela de transcricao.",
            });
        }, 60000);
        return () => clearTimeout(timer);
    }, [isReady]);

    const handleTranslate = () => {
        if (!text.trim() || !webViewRef.current) return;

        const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
        webViewRef.current.injectJavaScript(`translateText('${escaped}'); true;`);
        setIsTranslating(true);
        setLastTranslated(text.trim());
    };

    const handleMessage = (event: any) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === "ready") {
                setIsReady(true);
            } else if (data.type === "failed") {
                // Para o indicador: o WebView já sabe que não vai carregar.
                setIsReady(true);
            } else if (data.type === "log") {
                report("VLibras", data.message, {
                    severity: data.level === "warn" ? "warning" : "error",
                });
            } else if (data.type === "translating") {
                setIsTranslating(false);
            } else if (data.type === "error") {
                report("VLibras", data.message);
                setIsTranslating(false);
            }
        } catch (e) {
            console.log("WebView message parse error:", e);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <MaterialIcons name="translate" size={24} color={colors.primary} />
                <Text style={styles.title}>{t('transcription.title')}</Text>
            </View>

            {/* Input Area */}
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.inputArea}
            >
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        value={text}
                        onChangeText={setText}
                        placeholder={t('transcription.placeholder')}
                        placeholderTextColor={colors.text.secondary}
                        multiline
                        maxLength={500}
                    />
                    <View style={styles.inputFooter}>
                        <Text style={styles.charCount}>{text.length}/500</Text>
                        <TouchableOpacity
                            style={[
                                styles.translateBtn,
                                (!text.trim() || !isReady) && styles.translateBtnDisabled,
                            ]}
                            onPress={handleTranslate}
                            disabled={!text.trim() || !isReady}
                            activeOpacity={0.7}
                        >
                            {isTranslating ? (
                                <ActivityIndicator size="small" color={scheme === "dark" ? "#ffffff" : "#081018"} />
                            ) : (
                                <>
                                    <MaterialIcons name="sign-language" size={18} color={scheme === "dark" ? "#ffffff" : "#081018"} />
                                    <Text style={styles.translateBtnText}>{t('transcription.translate')}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>

            {/* Wrapper com flex:1 + justifyContent center: centraliza
                verticalmente o container de altura fixa do VLibras. */}
            <View style={styles.webviewWrapper}>
            <View style={styles.webviewContainer}>
                {!isReady && (
                    // pointerEvents="none": o overlay é apenas indicador, nunca
                    // deve interceptar toques destinados ao widget.
                    <View style={styles.loadingOverlay} pointerEvents="none">
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>{t('transcription.loading')}</Text>
                    </View>
                )}
                <WebView
                    ref={webViewRef}
                    // Ver GlobalVLibras.tsx: sem `baseUrl` o HTML inline roda
                    // em about:blank e o script do VLibras é bloqueado como
                    // cross-origin, deixando o widget preso no carregamento.
                    source={{ html: VLIBRAS_HTML, baseUrl: "https://vlibras.gov.br" }}
                    originWhitelist={["https://*", "http://*", "about:*"]}
                    style={styles.webview}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    mixedContentMode="always"
                    onError={(e) => console.warn("[VLibras] erro no WebView:", e.nativeEvent?.description)}
                    onHttpError={(e) => console.warn("[VLibras] HTTP", e.nativeEvent?.statusCode, e.nativeEvent?.url)}
                    onMessage={handleMessage}
                    scrollEnabled={false}
                    bounces={false}
                    overScrollMode="never"
                    setBuiltInZoomControls={false}
                    allowsInlineMediaPlayback={true}
                    mediaPlaybackRequiresUserAction={false}
                />

                {lastTranslated && isReady && (
                    <View style={styles.subtitleBar}>
                        <MaterialIcons name="closed-caption" size={16} color="#00e5ff" />
                        <Text style={styles.subtitleText} numberOfLines={2}>
                            {lastTranslated}
                        </Text>
                    </View>
                )}
            </View>
            </View>

            {/* Info Footer */}
            <View style={styles.footer}>
                <MaterialIcons name="info-outline" size={14} color={colors.text.secondary} />
                <Text style={styles.footerText}>
                    {t('transcription.footer')}
                </Text>
            </View>
        </SafeAreaView>
    );
}



