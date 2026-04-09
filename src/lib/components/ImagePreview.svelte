<script lang="ts">
  import { flashair } from '../flashair';
  import type { FlashAirFileEntry } from '../flashair';

  interface Props {
    file: FlashAirFileEntry | undefined;
  }

  let { file }: Props = $props();

  let imageUrl = $derived(file !== undefined ? flashair.fileUrl(file.path) : undefined);
  let imageLoaded = $state(false);

  $effect(() => {
    if (imageUrl !== undefined) {
      imageLoaded = false;
    }
  });
</script>

<div class="h-full flex items-center justify-center bg-base-300 relative">
  {#if file === undefined || imageUrl === undefined}
    <div class="text-base-content/40 text-center p-8">
      <p class="text-lg">Select a photo to preview</p>
    </div>
  {:else}
    {#key file.path}
      {#if !imageLoaded}
        <span class="loading loading-spinner loading-lg absolute"></span>
      {/if}
      <img
        src={imageUrl}
        alt={file.filename}
        class="max-w-full max-h-full object-contain"
        class:opacity-0={!imageLoaded}
        onload={() => { imageLoaded = true; }}
      />
    {/key}
  {/if}
</div>
