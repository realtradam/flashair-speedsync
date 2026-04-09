<script lang="ts">
  import { flashair } from './lib/flashair';
  import type { FlashAirFileEntry } from './lib/flashair';
  import ImageList from './lib/components/ImageList.svelte';
  import ImagePreview from './lib/components/ImagePreview.svelte';

  let images = $state<FlashAirFileEntry[]>([]);
  let selectedFile = $state<FlashAirFileEntry | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let isDark = $state(false);

  $effect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'black' : 'cmyk');
  });

  async function loadAllImages() {
    loading = true;
    error = undefined;
    try {
      images = await flashair.listAllImages('/DCIM');
      if (images.length > 0 && selectedFile === undefined) {
        selectedFile = images[0];
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      images = [];
    } finally {
      loading = false;
    }
  }

  function selectImage(file: FlashAirFileEntry) {
    selectedFile = file;
  }
</script>

<div class="flex h-screen bg-base-200">
  <!-- Left: Image preview -->
  <div class="flex-1 min-w-0 h-full overflow-hidden">
    {#if loading}
      <div class="flex items-center justify-center h-full">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if error}
      <div class="flex items-center justify-center h-full p-4">
        <div role="alert" class="alert alert-error max-w-md">
          <span>{error}</span>
          <button class="btn btn-sm" onclick={() => loadAllImages()}>Retry</button>
        </div>
      </div>
    {:else if images.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/60 p-8">
        <div class="text-center">
          <p>No photos found. Connect to FlashAir WiFi and tap the refresh button.</p>
          <button class="btn btn-primary mt-4" onclick={() => loadAllImages()}>Load Photos</button>
        </div>
      </div>
    {:else}
      <ImagePreview file={selectedFile} />
    {/if}
  </div>

  <!-- Right: Image list -->
<div class="w-36 lg:w-40 shrink-0 border-l border-base-300 flex flex-col">
    <div class="px-3 py-2 bg-base-100 border-b border-base-300 shrink-0">
      <span class="text-sm font-semibold">Photos ({images.length})</span>
    </div>
    <div class="flex-1 min-h-0">
      <ImageList {images} selectedPath={selectedFile?.path} onSelect={selectImage} />
    </div>
  </div>
</div>

<!-- FAB Flower: bottom-right -->
<div class="fab fab-flower">
  <div tabindex="0" class="btn btn-lg btn-circle btn-primary">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  </div>
  <div class="fab-close">
    <span class="btn btn-circle btn-lg btn-secondary">✕</span>
  </div>
  <!-- Dark mode toggle -->
  <button class="btn btn-lg btn-circle btn-secondary" onclick={() => (isDark = !isDark)}>
    {#if isDark}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
      </svg>
    {/if}
  </button>
  <!-- Refresh -->
  <button class="btn btn-lg btn-circle btn-secondary" onclick={() => loadAllImages()}>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 1 12.57-5.55L19.5 8.87" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 4.5v4.37h-4.37" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12a7.5 7.5 0 0 1-12.57 5.55L4.5 15.13" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5v-4.37h4.37" />
    </svg>
  </button>
</div>
