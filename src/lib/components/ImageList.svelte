<script lang="ts">
  import { flashair } from '../flashair';
  import type { FlashAirFileEntry } from '../flashair';
  import CachedThumbnail from './CachedThumbnail.svelte';

  interface Props {
    images: FlashAirFileEntry[];
    selectedPath: string | undefined;
    onSelect: (file: FlashAirFileEntry) => void;
    newImagePaths: Set<string>;
    onAnimationDone: (path: string) => void;
  }

  let { images, selectedPath, onSelect, newImagePaths, onAnimationDone }: Props = $props();

  function handleRevealEnd(path: string) {
    onAnimationDone(path);
  }
</script>

<div class="h-full overflow-y-auto bg-base-100">
  {#if images.length === 0}
    <div class="flex items-center justify-center h-full text-base-content/50 p-4">
      <p class="text-center text-sm">No images found</p>
    </div>
  {:else}
    <ul class="flex flex-col gap-0.5 p-1">
      {#each images as file (file.path)}
        {@const thumbUrl = flashair.thumbnailUrl(file.path)}
        {@const isSelected = file.path === selectedPath}
        {@const isNew = newImagePaths.has(file.path)}
        <li
          class="image-reveal overflow-hidden {isNew ? 'image-reveal-enter' : ''}"
          onanimationend={() => handleRevealEnd(file.path)}
        >
          <button
            class="flex flex-col w-full rounded-lg p-1.5 text-left transition-colors {isSelected
              ? 'bg-primary text-primary-content'
              : 'hover:bg-base-200'}"
            onclick={() => onSelect(file)}
          >
            {#if thumbUrl}
              <CachedThumbnail path={file.path} alt={file.filename} />
            {:else}
              <div class="w-full aspect-square rounded bg-base-300 flex items-center justify-center">
                <span class="text-lg">🖼️</span>
              </div>
            {/if}
            <div class="min-w-0 w-full mt-1">
              <p class="text-xs font-medium truncate">{file.filename}</p>
              <p class="text-xs opacity-60">{file.date.toLocaleDateString()}</p>
              <p class="text-xs opacity-60">{file.date.toLocaleTimeString()}</p>
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
