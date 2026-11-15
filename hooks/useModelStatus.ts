/**
 * Hook para verificar se o plugin nativo HandLandmarker está operacional.
 *
 * Retorna o estado do modelo (loading → ready/error) para que
 * a UI possa mostrar feedback adequado ao usuário antes de
 * iniciar o frame processor.
 */

import { useState } from 'react';
import { getPluginStatus } from '@/services/handLandmarkerPlugin';

export type ModelStatus = 'loading' | 'ready' | 'error';

export function useModelStatus() {
  // O plugin é inicializado no nível do módulo (síncrono), então o estado já é
  // conhecido no PRIMEIRO render. Antes ele começava em 'loading' e virava
  // 'ready' num efeito: a tela da câmera montava o <Camera> sem frame
  // processor e, um render depois, com ele. Para o VisionCamera isso é uma
  // troca de saídas: ele desfaz a sessão e abre a câmera de novo — a câmera
  // iniciava duas vezes a cada entrada na tela (dois `camera_initialized` no
  // log) e, por um defeito do VisionCamera que registra um ouvinte de estado a
  // cada abertura, todo evento seguinte (started/stopped/error) saía em dobro.
  const [{ status, errorMessage }] = useState<{ status: ModelStatus; errorMessage: string | null }>(() => {
    const { ready, error } = getPluginStatus();
    return ready ? { status: 'ready', errorMessage: null } : { status: 'error', errorMessage: error };
  });

  return { status, errorMessage };
}
