<script lang="ts">
  import { flashair } from './lib/flashair';
  import type { FlashAirFileEntry } from './lib/flashair';
  import { imageCache } from './lib/cache';
  import { autoCacheService } from './lib/cache';
  import ImageList from './lib/components/ImageList.svelte';
  import ImagePreview from './lib/components/ImagePreview.svelte';

  let images = $state<FlashAirFileEntry[]>([]);
  let selectedFile = $state<FlashAirFileEntry | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let isDark = $state(false);
  let deleting = $state(false);
  let showDeleteConfirm = $state(false);

  $effect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'black' : 'cmyk');
  });

  async function loadAllImages() {
    loading = true;
    error = undefined;
    autoCacheService.stop();
    try {
      images = await flashair.listAllImages('/DCIM');
      if (images.length > 0 && selectedFile === undefined) {
        selectedFile = images[0];
      }
      if (images.length > 0) {
        autoCacheService.start(images);
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

  function requestDelete() {
    if (selectedFile === undefined) return;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    showDeleteConfirm = false;
    if (selectedFile === undefined) return;

    const fileToDelete = selectedFile;
    deleting = true;
    try {
      await flashair.deleteFile(fileToDelete.path);
      // Remove from cache and auto-cache queue
      void imageCache.delete('thumbnail', fileToDelete.path);
      void imageCache.delete('full', fileToDelete.path);
      autoCacheService.removeImage(fileToDelete.path);
      // Remove from list and select next image
      const idx = images.findIndex((f) => f.path === fileToDelete.path);
      images = images.filter((f) => f.path !== fileToDelete.path);
      if (images.length === 0) {
        selectedFile = undefined;
      } else if (idx >= images.length) {
        selectedFile = images[images.length - 1];
      } else {
        selectedFile = images[idx];
      }
    } catch (e) {
      error = `Delete failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      deleting = false;
    }
  }

  function cancelDelete() {
    showDeleteConfirm = false;
  }

  async function clearAllCache() {
    autoCacheService.stop();
    await imageCache.clear();
    // Restart auto-caching from scratch
    if (images.length > 0) {
      autoCacheService.start(images);
    }
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
  <!-- Delete -->
  <button class="btn btn-lg btn-circle btn-error" onclick={() => requestDelete()} disabled={selectedFile === undefined || deleting}>
    {#if deleting}
      <span class="loading loading-spinner loading-sm"></span>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
      </svg>
    {/if}
  </button>
  <!-- Clear Cache -->
  <button class="btn btn-lg btn-circle btn-warning" onclick={() => void clearAllCache()}>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
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

<!-- Delete confirmation modal -->
{#if showDeleteConfirm && selectedFile !== undefined}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="text-lg font-bold">Delete photo?</h3>
      <p class="py-4">This will permanently delete <strong>{selectedFile.filename}</strong> from the SD card.</p>
      <div class="modal-action">
        <button class="btn" onclick={() => cancelDelete()}>Cancel</button>
        <button class="btn btn-error" onclick={() => void confirmDelete()}>Delete</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => cancelDelete()}>close</button>
    </form>
  </dialog>
{/if}
