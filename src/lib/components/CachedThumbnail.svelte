<script lang="ts">
  import { flashair } from '../flashair';
  import { imageCache } from '../cache';
  import { autoCacheService } from '../cache';

  interface Props {
    path: string;
    alt: string;
  }

  let { path, alt }: Props = $props();

  let blobUrl = $state<string | undefined>(undefined);
  let rawBlobUrl: string | undefined;
  let cacheProgress = $state<number | undefined>(undefined);

  $effect(() => {
    const currentPath = path;
    blobUrl = undefined;

    void loadThumbnail(currentPath);

    return () => {
      if (rawBlobUrl !== undefined) {
        URL.revokeObjectURL(rawBlobUrl);
        rawBlobUrl = undefined;
      }
    };
  });

  // Subscribe to auto-cache progress updates
  $effect(() => {
    const currentPath = path;
    const unsubscribe = autoCacheService.subscribe(() => {
      cacheProgress = autoCacheService.getProgress(currentPath);
    });
    // Set initial value
    cacheProgress = autoCacheService.getProgress(currentPath);
    return unsubscribe;
  });

  async function loadThumbnail(filePath: string) {
    // Try cache first
    const cached = await imageCache.get('thumbnail', filePath);
    if (cached !== undefined) {
      const url = URL.createObjectURL(cached.blob);
      rawBlobUrl = url;
      blobUrl = url;
      return;
    }

    // Fetch from card
    const thumbUrl = flashair.thumbnailUrl(filePath);
    if (thumbUrl === undefined) return;

    try {
      const { blob, meta } = await flashair.fetchThumbnail(filePath);
      // Store in cache (fire-and-forget)
      void imageCache.put('thumbnail', filePath, blob, meta);
      const url = URL.createObjectURL(blob);
      rawBlobUrl = url;
      blobUrl = url;
    } catch {
      // Thumbnail fetch failed — show placeholder
    }
  }

  let cachePercent = $derived(
    cacheProgress !== undefined ? Math.round(cacheProgress * 100) : undefined
  );
</script>

{#if blobUrl !== undefined}
  <div class="relative w-full aspect-square">
    <img
      src={blobUrl}
      {alt}
      class="w-full aspect-square rounded object-cover"
      draggable="false"
    />
    {#if cachePercent !== undefined && cachePercent < 100}
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="radial-progress text-primary bg-base-300/60 border-2 border-base-300/60" style:--value={cachePercent} style:--size="2.5rem" style:--thickness="3px" role="progressbar">
          <span class="text-[0.6rem] font-bold text-primary-content drop-shadow">{cachePercent}%</span>
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div class="w-full aspect-square rounded bg-base-300 flex items-center justify-center">
    <span class="loading loading-spinner loading-sm"></span>
  </div>
{/if}
