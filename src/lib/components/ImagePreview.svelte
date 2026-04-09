<script lang="ts">
  import { flashair } from '../flashair';
  import type { FlashAirFileEntry } from '../flashair';

  interface Props {
    file: FlashAirFileEntry | undefined;
  }

  let { file }: Props = $props();

  let thumbnailUrl = $derived(
    file !== undefined ? flashair.thumbnailUrl(file.path) : undefined,
  );

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

  $effect(() => {
    const currentFile = file;
    if (currentFile === undefined) {
      cleanup();
      return;
    }

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
    fullObjectUrl = undefined;
    progress = 0;
    downloading = false;
    loadError = undefined;
  }

  async function loadFullImage(entry: FlashAirFileEntry) {
    cleanup();

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
  let showThumbnail = $derived(fullObjectUrl === undefined && thumbnailUrl !== undefined);
</script>

<div class="h-full flex items-center justify-center bg-base-300 relative">
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
      <div class="absolute inset-x-0 top-0 z-10 p-3">
        <div class="max-w-xs mx-auto">
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
          class="max-w-full max-h-full object-contain"
        />
      {/key}
    {:else if showThumbnail}
      <img
        src={thumbnailUrl}
        alt={file.filename}
        class="max-w-full max-h-full object-contain image-rendering-pixelated"
        style="image-rendering: pixelated;"
      />
    {:else}
      <span class="loading loading-spinner loading-lg"></span>
    {/if}
  {/if}
</div>
