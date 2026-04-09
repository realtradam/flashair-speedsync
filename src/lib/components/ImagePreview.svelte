<script lang="ts">
  import { flashair } from '../flashair';
  import type { FlashAirFileEntry } from '../flashair';

  interface Props {
    file: FlashAirFileEntry | undefined;
  }

  let { file }: Props = $props();

  let thumbnailBlobUrl = $state<string | undefined>(undefined);
  let imageAspectRatio = $state<string>('3 / 2');

  let fullObjectUrl = $state<string | undefined>(undefined);
  let progress = $state(0);
  let downloading = $state(false);
  let loadError = $state<string | undefined>(undefined);

  let currentAbort: AbortController | undefined;

  /**
   * Plain (non-reactive) mirror of fullObjectUrl so we can revoke it
   * without reading the $state variable inside $effect (which would
   * add it as a tracked dependency and cause an infinite loop).
   */
  let rawObjectUrl: string | undefined;
  let rawThumbnailUrl: string | undefined;

  // --- Zoom & pan state ---
  let zoomLevel = $state(1); // user zoom: 1 = fit, >1 = zoomed in
  let panX = $state(0);
  let panY = $state(0);
  let containerEl: HTMLDivElement | undefined;
  let containerW = $state(0);
  let containerH = $state(0);

  // Touch tracking for pinch-to-zoom and pan
  let lastTouchDist = 0;
  let lastTouchMidX = 0;
  let lastTouchMidY = 0;
  let isPinching = false;
  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;

  const MIN_ZOOM = 1;
  // Allow zooming up to 3× beyond native 1:1 pixel density.
  // The effective CSS scale = baseScale * zoomLevel; zoomLevel=1 always means
  // "fit".  MAX_ZOOM is recomputed per-image in clampZoom().
  const ZOOM_PAST_NATIVE = 3;

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
  }

  function clampPan() {
    if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
      return;
    }
    if (containerW === 0 || containerH === 0) return;
    // The rendered image size at the current zoom level.
    const renderedW = imgNaturalW > 0 ? imgNaturalW * baseScale * zoomLevel : containerW * zoomLevel;
    const renderedH = imgNaturalH > 0 ? imgNaturalH * baseScale * zoomLevel : containerH * zoomLevel;
    const maxPanX = Math.max(0, (renderedW - containerW) / 2);
    const maxPanY = Math.max(0, (renderedH - containerH) / 2);
    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const maxZoom = baseScale > 0 ? ZOOM_PAST_NATIVE / baseScale : 10;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(maxZoom, zoomLevel * delta));

    if (containerEl !== undefined) {
      const rect = containerEl.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      const factor = newZoom / zoomLevel;
      panX = cursorX - factor * (cursorX - panX);
      panY = cursorY - factor * (cursorY - panY);
    }

    zoomLevel = newZoom;
    clampPan();
  }

  function touchDist(t1: Touch, t2: Touch): number {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinching = true;
      isPanning = false;
      const t0 = e.touches[0] as Touch;
      const t1 = e.touches[1] as Touch;
      lastTouchDist = touchDist(t0, t1);
      lastTouchMidX = (t0.clientX + t1.clientX) / 2;
      lastTouchMidY = (t0.clientY + t1.clientY) / 2;
    } else if (e.touches.length === 1 && zoomLevel > 1) {
      isPanning = true;
      isPinching = false;
      const t = e.touches[0] as Touch;
      lastPanX = t.clientX;
      lastPanY = t.clientY;
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0] as Touch;
      const t1 = e.touches[1] as Touch;
      const dist = touchDist(t0, t1);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      const maxZoom = baseScale > 0 ? ZOOM_PAST_NATIVE / baseScale : 10;
      const factor = dist / lastTouchDist;
      const newZoom = Math.max(MIN_ZOOM, Math.min(maxZoom, zoomLevel * factor));

      if (containerEl !== undefined) {
        const rect = containerEl.getBoundingClientRect();
        const cx = midX - rect.left - rect.width / 2;
        const cy = midY - rect.top - rect.height / 2;
        const sf = newZoom / zoomLevel;
        panX = cx - sf * (cx - panX) + (midX - lastTouchMidX);
        panY = cy - sf * (cy - panY) + (midY - lastTouchMidY);
      }

      zoomLevel = newZoom;
      clampPan();

      lastTouchDist = dist;
      lastTouchMidX = midX;
      lastTouchMidY = midY;
    } else if (isPanning && e.touches.length === 1 && zoomLevel > 1) {
      e.preventDefault();
      const t = e.touches[0] as Touch;
      panX += t.clientX - lastPanX;
      panY += t.clientY - lastPanY;
      clampPan();
      lastPanX = t.clientX;
      lastPanY = t.clientY;
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) {
      isPinching = false;
    }
    if (e.touches.length === 0) {
      isPanning = false;
    }
    if (e.touches.length === 1 && zoomLevel > 1) {
      isPanning = true;
      const t = e.touches[0] as Touch;
      lastPanX = t.clientX;
      lastPanY = t.clientY;
    }
  }

  // Native image dimensions (set once the full-res img element loads)
  let imgNaturalW = $state(0);
  let imgNaturalH = $state(0);

  function handleImageLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    imgNaturalW = img.naturalWidth;
    imgNaturalH = img.naturalHeight;
  }

  /**
   * The scale factor that makes the native-size image "fit" inside the
   * container (same logic as object-contain).  When imgNatural* are not
   * yet known we fall back to 1 so nothing explodes.
   */
  let baseScale = $derived(
    imgNaturalW > 0 && imgNaturalH > 0 && containerW > 0 && containerH > 0
      ? Math.min(containerW / imgNaturalW, containerH / imgNaturalH)
      : 1
  );

  // Track container size via ResizeObserver
  $effect(() => {
    const el = containerEl;
    if (el === undefined) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        containerW = entry.contentRect.width;
        containerH = entry.contentRect.height;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Bind touch listeners with { passive: false } so we can preventDefault
  $effect(() => {
    const el = containerEl;
    if (el === undefined) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  });

  $effect(() => {
    const currentFile = file;
    if (currentFile === undefined) {
      cleanup();
      return;
    }

    // Reset zoom on file change
    resetZoom();

    // Clear stale state synchronously before async loads
    if (rawThumbnailUrl !== undefined) {
      URL.revokeObjectURL(rawThumbnailUrl);
      rawThumbnailUrl = undefined;
    }
    thumbnailBlobUrl = undefined;
    imageAspectRatio = '3 / 2';

    loadThumbnail(currentFile);
    loadFullImage(currentFile);

    return () => {
      if (currentAbort !== undefined) {
        currentAbort.abort();
        currentAbort = undefined;
      }
    };
  });

  function cleanup() {
    if (rawObjectUrl !== undefined) {
      URL.revokeObjectURL(rawObjectUrl);
      rawObjectUrl = undefined;
    }
    if (rawThumbnailUrl !== undefined) {
      URL.revokeObjectURL(rawThumbnailUrl);
      rawThumbnailUrl = undefined;
    }
    fullObjectUrl = undefined;
    thumbnailBlobUrl = undefined;
    imageAspectRatio = '3 / 2';
    progress = 0;
    downloading = false;
    loadError = undefined;
    resetZoom();
  }

  async function loadThumbnail(entry: FlashAirFileEntry) {
    const url = flashair.thumbnailUrl(entry.path);
    if (url === undefined) return;

    try {
      const { blob, meta } = await flashair.fetchThumbnail(entry.path);
      const blobUrl = URL.createObjectURL(blob);
      rawThumbnailUrl = blobUrl;
      thumbnailBlobUrl = blobUrl;

      if (meta.width !== undefined && meta.height !== undefined && meta.width > 0 && meta.height > 0) {
        imageAspectRatio = `${String(meta.width)} / ${String(meta.height)}`;
      }
    } catch {
      // Thumbnail fetch failed — not critical, full image will load
    }
  }

  async function loadFullImage(entry: FlashAirFileEntry) {
    if (rawObjectUrl !== undefined) {
      URL.revokeObjectURL(rawObjectUrl);
      rawObjectUrl = undefined;
    }
    fullObjectUrl = undefined;
    progress = 0;
    loadError = undefined;

    if (currentAbort !== undefined) {
      currentAbort.abort();
    }
    const abort = new AbortController();
    currentAbort = abort;

    downloading = true;
    progress = 0;
    loadError = undefined;

    const url = flashair.fileUrl(entry.path);
    const totalBytes = entry.size;

    try {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (reader === undefined) {
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        rawObjectUrl = objectUrl;
        fullObjectUrl = objectUrl;
        progress = 1;
        downloading = false;
        return;
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        progress = totalBytes > 0 ? received / totalBytes : 0;
      }

      if (abort.signal.aborted) return;

      const blob = new Blob(chunks);
      const objectUrl = URL.createObjectURL(blob);
      rawObjectUrl = objectUrl;
      fullObjectUrl = objectUrl;
      progress = 1;
    } catch (e) {
      if (abort.signal.aborted) return;
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      if (!abort.signal.aborted) {
        downloading = false;
      }
    }
  }

  let progressPercent = $derived(Math.round(progress * 100));
  let showThumbnail = $derived(fullObjectUrl === undefined && thumbnailBlobUrl !== undefined);
  let imageTransform = $derived(
    `translate(${String(panX)}px, ${String(panY)}px) scale(${String(baseScale * zoomLevel)})`
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="h-full flex items-center justify-center bg-base-300 relative overflow-hidden touch-none"
  bind:this={containerEl}
  onwheel={handleWheel}
>
  {#if file === undefined}
    <div class="text-base-content/40 text-center p-8">
      <p class="text-lg">Select a photo to preview</p>
    </div>
  {:else if loadError !== undefined}
    <div class="text-center p-8">
      <p class="text-error mb-2">Failed to load image</p>
      <p class="text-sm text-base-content/60">{loadError}</p>
    </div>
  {:else}
    {#if downloading && progress < 1}
      <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
        <div class="bg-base-100 rounded-box p-6 shadow-xl max-w-xs w-full mx-4">
          <div class="flex items-center gap-2">
            <progress class="progress progress-primary flex-1" value={progressPercent} max="100"></progress>
            <span class="text-xs font-mono text-base-content/70 w-10 text-right">{progressPercent}%</span>
          </div>
        </div>
      </div>
    {/if}
    {#if fullObjectUrl !== undefined}
      {#key fullObjectUrl}
        <img
          src={fullObjectUrl}
          alt={file.filename}
          class="will-change-transform shrink-0"
          style:width={imgNaturalW > 0 ? `${String(imgNaturalW)}px` : 'auto'}
          style:height={imgNaturalH > 0 ? `${String(imgNaturalH)}px` : 'auto'}
          style:max-width="none"
          style:transform={imageTransform}
          style:transform-origin="center center"
          draggable="false"
          onload={handleImageLoad}
        />
      {/key}
    {:else if showThumbnail}
      <div
        class="w-full max-h-full overflow-hidden"
        style:aspect-ratio={imageAspectRatio}
      >
        <img
          src={thumbnailBlobUrl}
          alt={file.filename}
          class="w-full h-full object-cover blur-lg"
          draggable="false"
        />
      </div>
    {:else}
      <span class="loading loading-spinner loading-lg"></span>
    {/if}
  {/if}
</div>
