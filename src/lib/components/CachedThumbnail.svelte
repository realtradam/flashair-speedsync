<script lang="ts">
  import { flashair } from '../flashair';
  import { imageCache } from '../cache';

  interface Props {
    path: string;
    alt: string;
  }

  let { path, alt }: Props = $props();

  let blobUrl = $state<string | undefined>(undefined);
  let rawBlobUrl: string | undefined;

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
</script>

{#if blobUrl !== undefined}
  <img
    src={blobUrl}
    {alt}
    class="w-full aspect-square rounded object-cover"
    draggable="false"
  />
{:else}
  <div class="w-full aspect-square rounded bg-base-300 flex items-center justify-center">
    <span class="loading loading-spinner loading-sm"></span>
  </div>
{/if}
