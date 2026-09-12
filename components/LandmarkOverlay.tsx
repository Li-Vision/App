/**
 * Overlay de landmarks (mãos + corpo + rosto) desenhado sobre o preview da câmera.
 *
 * Extraído de `app/screens/cam/index.tsx`, onde a lógica vivia inline. As telas
 * de coleta (collect-static / collect-dynamic) desenhavam sua própria versão
 * reduzida — só a PRIMEIRA mão, sem esqueleto, sem pose e sem rosto —, o que
 * fazia o modo Holístico parecer quebrado nelas. Centralizar aqui garante que
 * as três telas mostrem exatamente os mesmos canais.
 *
 * O componente é puramente visual: recebe os pontos JÁ transformados
 * (`transformPoint`) e o mapeador de coordenadas (`makeCoverMapper`), e não
 * conhece câmera, WebSocket nem coleta.
 */

import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { PoseLandmarkIndex } from "@/services/handLandmarkerPlugin";
import { boneStyle, CoverMapper, TPoint, TPosePoint } from "@/services/holisticFeatures";

const SKELETON_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

// Esqueleto de pose (MediaPipe Pose, 33 pontos) — só ombros, cotovelos e
// pulsos. Quadris ficam de fora: numa câmera frontal de celular em uso normal
// de Libras (tronco superior próximo à câmera) eles quase nunca entram no
// enquadramento, então exigi-los deixava a pose inteira sem desenhar.
const POSE_CONNECTIONS: [number, number][] = [
  [PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.RIGHT_SHOULDER],
  [PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_ELBOW],
  [PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.LEFT_WRIST],
  [PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_ELBOW],
  [PoseLandmarkIndex.RIGHT_ELBOW, PoseLandmarkIndex.RIGHT_WRIST],
];

const POSE_DOT_INDICES: number[] = [
  PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.RIGHT_SHOULDER,
  PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.RIGHT_ELBOW,
  PoseLandmarkIndex.LEFT_WRIST, PoseLandmarkIndex.RIGHT_WRIST,
];

// Subconjunto ESPARSO do rosto. Cada ponto aqui é uma View recriada a cada
// atualização: o conjunto anterior (60 pontos) sozinho respondia por ~38% das
// Views do overlay e pesava mais na thread de UI do que a inferência dos três
// modelos. Mantém-se o contorno reconhecível — olhos, boca e oval — com menos
// de um terço dos pontos.
export const FACE_POINT_INDICES: number[] = [
  10, 297, 284, 389, 454, 361, 397, 379, 400, 152, // metade direita do oval
  176, 150, 172, 132, 234, 162, 54, 67,            // metade esquerda do oval
  33, 159, 133,   // olho esquerdo (canto, pálpebra, canto)
  362, 386, 263,  // olho direito
  61, 0, 291, 17, // boca (cantos, superior, inferior)
];

/** Paleta por mão: a segunda mão recebe outra cor para não se confundir com a primeira. */
const HAND_COLORS = [
  { tip: "#00e5ff", bone: "rgba(0, 229, 255, 0.4)", dot: "rgba(255,255,255,0.7)", wrist: "#ff6b6b" },
  { tip: "#b388ff", bone: "rgba(179, 136, 255, 0.4)", dot: "rgba(220,200,255,0.7)", wrist: "#ff9800" },
];

const FINGERTIPS = [4, 8, 12, 16, 20];

export type LandmarkOverlayProps = {
  /** Mãos já transformadas — uma entrada por mão detectada (até 2). */
  hands: TPoint[][];
  /** Pose já transformada e validada (33 pontos), ou vazio. */
  pose?: TPosePoint[];
  /** Rosto já transformado — array ESPARSO indexado por FACE_POINT_INDICES. */
  face?: TPoint[];
  /** Mapeador normalizado→pixels que compensa o crop "cover" do preview. */
  cover: CoverMapper;
  /**
   * Cor única para todos os pontos das mãos. Usada pela coleta dinâmica para
   * pintar o overlay de vermelho durante a gravação; sem ela, vale a paleta
   * por mão.
   */
  handColorOverride?: string;
};

function LandmarkOverlayBase({
  hands,
  pose = [],
  face = [],
  cover,
  handColorOverride,
}: LandmarkOverlayProps) {
  if (hands.length === 0 && pose.length === 0 && face.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {hands.map((hand, handIdx) => {
        if (!hand || hand.length !== 21) return null;
        const palette = HAND_COLORS[handIdx % HAND_COLORS.length];
        const boneColor = handColorOverride ?? palette.bone;

        return (
          <View key={`hand-${handIdx}`}>
            {hand.map((lm, idx) => {
              const isTip = FINGERTIPS.includes(idx);
              const isWrist = idx === 0;
              const color = handColorOverride
                ?? (isWrist ? palette.wrist : isTip ? palette.tip : palette.dot);
              return (
                <View
                  key={`h${handIdx}-lm${idx}`}
                  style={{
                    position: "absolute",
                    left: cover.toX(lm.x) - 5,
                    top: cover.toY(lm.y) - 5,
                    backgroundColor: color,
                    width: isTip || isWrist ? 10 : 7,
                    height: isTip || isWrist ? 10 : 7,
                    borderRadius: isTip || isWrist ? 5 : 3.5,
                  }}
                />
              );
            })}

            {SKELETON_CONNECTIONS.map(([a, b], idx) => {
              if (a >= hand.length || b >= hand.length) return null;
              const { angle, ...box } = boneStyle(
                cover.toX(hand[a].x), cover.toY(hand[a].y),
                cover.toX(hand[b].x), cover.toY(hand[b].y),
                1.5,
              );
              return (
                <View
                  key={`h${handIdx}-bone-${idx}`}
                  style={{
                    position: "absolute",
                    ...box,
                    backgroundColor: boneColor,
                    transform: [{ rotate: `${angle}deg` }],
                  }}
                />
              );
            })}
          </View>
        );
      })}

      {/* Pose (corpo) — só no modo Holístico */}
      {pose.length > 0 &&
        POSE_CONNECTIONS.map(([a, b], idx) => {
          if (!pose[a] || !pose[b]) return null;
          // `?? 1`: visibility ausente = desconhecida, não invisível. O
          // frame já passou pelo filtro geométrico em isPosePlausible().
          if ((pose[a].visibility ?? 1) < 0.3 || (pose[b].visibility ?? 1) < 0.3) return null;
          const { angle, ...box } = boneStyle(
            cover.toX(pose[a].x), cover.toY(pose[a].y),
            cover.toX(pose[b].x), cover.toY(pose[b].y),
            2,
          );
          return (
            <View
              key={`pose-bone-${idx}`}
              style={{
                position: "absolute",
                ...box,
                backgroundColor: "rgba(76, 175, 80, 0.6)",
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}
      {pose.length > 0 &&
        POSE_DOT_INDICES.map((idx) => {
          const lm = pose[idx];
          if (!lm || (lm.visibility ?? 1) < 0.3) return null;
          return (
            <View
              key={`pose-dot-${idx}`}
              style={{
                position: "absolute",
                left: cover.toX(lm.x) - 4,
                top: cover.toY(lm.y) - 4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: "#4caf50",
              }}
            />
          );
        })}

      {/* Rosto — subconjunto leve de pontos, só no modo Holístico */}
      {face.length > 0 &&
        FACE_POINT_INDICES.map((idx) => {
          const lm = face[idx];
          if (!lm) return null;
          return (
            <View
              key={`face-dot-${idx}`}
              style={{
                position: "absolute",
                left: cover.toX(lm.x) - 1.5,
                top: cover.toY(lm.y) - 1.5,
                width: 3,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: "rgba(255, 214, 0, 0.8)",
              }}
            />
          );
        })}
    </View>
  );
}

export const LandmarkOverlay = memo(LandmarkOverlayBase);
export default LandmarkOverlay;
