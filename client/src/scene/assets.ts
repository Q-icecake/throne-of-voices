import { backLayerSvg, frontLayerSvg, midLayerSvg } from './court.ts';
import backgroundUrl from '../assets/court-background.svg';
import foregroundUrl from '../assets/court-foreground.svg';
import zhangHongUrl from '../assets/zhang-hong.svg';

/**
 * Art slots. Each slot renders the temporary SVG unless an image URL is configured.
 * To swap in painted art later, put a 1920×1080 transparent PNG/WebP under client/public-art/
 * (or any path Vite serves) and set its URL here. The SVG stays as the fallback if loading fails.
 *
 * Never point a slot at references/: those CK3 screenshots are design reference only.
 */
export type SlotId = 'court.background' | 'court.figures' | 'court.foreground' | 'character.zhangHong';

export interface SlotConfig {
  /** Optional image override; court layers use 16:9, the character uses 220:400. */
  image: string | null;
  /** Temporary art; also the fallback when the image is missing or fails to load. */
  fallback: () => string;
  status: 'temporary-svg';
}

export const ART_SLOTS: Record<SlotId, SlotConfig> = {
  'court.background': { image: backgroundUrl, fallback: backLayerSvg, status: 'temporary-svg' },
  'court.figures': { image: null, fallback: midLayerSvg, status: 'temporary-svg' },
  'court.foreground': { image: foregroundUrl, fallback: frontLayerSvg, status: 'temporary-svg' },
  // The original figure underneath remains available until the new art loads.
  'character.zhangHong': { image: zhangHongUrl, fallback: () => '', status: 'temporary-svg' },
};

export function mountSlot(container: HTMLElement, id: SlotId): void {
  const slot = ART_SLOTS[id];
  container.dataset.slot = id;
  container.insertAdjacentHTML('afterbegin', slot.fallback());
  if (id === 'court.figures') {
    const character = document.createElement('div');
    character.className = 'character-art';
    container.append(character);
    mountSlot(character, 'character.zhangHong');
  }
  if (!slot.image) return;
  const image = new Image();
  image.className = 'slot-image';
  image.alt = '';
  image.decoding = 'async';
  image.addEventListener('load', () => container.classList.add('has-image'));
  image.addEventListener('error', () => { image.remove(); container.classList.remove('has-image'); });
  image.src = slot.image;
  container.prepend(image);
}
