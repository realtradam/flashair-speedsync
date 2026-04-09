<script lang="ts">
  import { flashair } from '../flashair';
  import type { FlashAirFileEntry } from '../flashair';

  interface Props {
    images: FlashAirFileEntry[];
    selectedPath: string | undefined;
    onSelect: (file: FlashAirFileEntry) => void;
  }

  let { images, selectedPath, onSelect }: Props = $props();
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
        <li>
          <button
            class="flex items-center gap-2 w-full rounded-lg p-1.5 text-left transition-colors {isSelected
              ? 'bg-primary text-primary-content'
              : 'hover:bg-base-200'}"
            onclick={() => onSelect(file)}
          >
            {#if thumbUrl}
              <img
                src={thumbUrl}
                alt={file.filename}
                class="w-12 h-12 rounded object-cover shrink-0"
                loading="lazy"
              />
            {:else}
              <div class="w-12 h-12 rounded bg-base-300 flex items-center justify-center shrink-0">
                <span class="text-lg">🖼️</span>
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium truncate">{file.filename}</p>
              <p class="text-xs opacity-60">{file.date.toLocaleString()}</p>
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
